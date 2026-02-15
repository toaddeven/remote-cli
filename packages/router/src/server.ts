import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { ConfigManager } from './config/ConfigManager';
import { JsonStore } from './storage/JsonStore';
import { FeishuLongConnHandler } from './feishu/FeishuLongConnHandler';
import { ConnectionHub } from './websocket/ConnectionHub';
import { BindingManager } from './binding/BindingManager';
import { MessageType } from './types';

/**
 * Router Server
 * Handles Feishu WebSocket long connection, local WebSocket connections, and message routing
 */
export class RouterServer {
  private app: Koa;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private config: ConfigManager;
  private store: JsonStore;
  private feishuLongConnHandler: FeishuLongConnHandler;
  private connectionHub: ConnectionHub;
  private bindingManager: BindingManager;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: ConfigManager, store: JsonStore) {
    this.config = config;
    this.store = store;
    this.app = new Koa();
    this.connectionHub = new ConnectionHub();
    this.bindingManager = new BindingManager(store);

    // Initialize FeishuLongConnHandler (WebSocket mode)
    this.feishuLongConnHandler = new FeishuLongConnHandler({
      appId: config.get('feishu', 'appId'),
      appSecret: config.get('feishu', 'appSecret'),
      store: this.store
    });

    // Share ConnectionHub with Feishu handler
    this.feishuLongConnHandler.setConnectionHub(this.connectionHub);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Koa middleware
   */
  private setupMiddleware(): void {
    this.app.use(bodyParser());

    // Error handling
    this.app.use(async (ctx, next) => {
      try {
        await next();
      } catch (error: any) {
        console.error('Request error:', error);
        ctx.status = error.status || 500;
        ctx.body = {
          success: false,
          error: error.message || 'Internal server error'
        };
      }
    });

    // Request logging
    this.app.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      console.log(`${ctx.method} ${ctx.url} - ${ctx.status} (${ms}ms)`);
    });
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    const router = new Router();

    // Health check endpoint
    router.get('/health', (ctx) => {
      const stats = this.connectionHub.getConnectionStats();
      ctx.body = {
        status: 'ok',
        timestamp: Date.now(),
        connections: stats.totalConnections,
        devices: stats.deviceIds
      };
    });

    // Binding code request endpoint
    router.post('/api/bind/request', async (ctx) => {
      const { deviceId, deviceName, platform } = ctx.request.body as {
        deviceId: string;
        deviceName?: string;
        platform?: string;
      };

      // Validate required fields
      if (!deviceId) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'deviceId is required'
        };
        return;
      }

      try {
        // Generate binding code
        const bindingCode = await this.bindingManager.generateBindingCode(
          deviceId,
          deviceName || 'Unknown Device'
        );

        ctx.body = {
          success: true,
          bindingCode: bindingCode.code,
          expiresAt: bindingCode.expiresAt,
          expiresIn: Math.floor((bindingCode.expiresAt - Date.now()) / 1000) // seconds
        };
      } catch (error: any) {
        console.error('Failed to generate binding code:', error);
        ctx.status = 500;
        ctx.body = {
          success: false,
          error: error.message || 'Failed to generate binding code'
        };
      }
    });

    this.app.use(router.routes());
    this.app.use(router.allowedMethods());
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocket(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('New WebSocket connection from:', req.socket.remoteAddress);

      let deviceId: string | null = null;
      let heartbeatTimeout: NodeJS.Timeout | null = null;

      // Reset heartbeat timeout
      const resetHeartbeat = () => {
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);

        // If no heartbeat received within 2x interval, consider connection dead
        const interval = this.config.get('websocket', 'heartbeatInterval');
        heartbeatTimeout = setTimeout(() => {
          console.log('Heartbeat timeout for device:', deviceId);
          ws.close();
        }, interval * 2);
      };

      resetHeartbeat();

      // Handle incoming messages
      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // Update heartbeat on any message
          resetHeartbeat();

          switch (message.type) {
            case MessageType.BINDING_REQUEST:
              // Device sends binding request with deviceId
              deviceId = message.data.deviceId;
              if (deviceId) {
                this.connectionHub.registerConnection(deviceId, ws);
                console.log('Device registered:', deviceId);

                // Send confirmation
                ws.send(JSON.stringify({
                  type: MessageType.BINDING_CONFIRM,
                  messageId: message.messageId,
                  timestamp: Date.now(),
                  data: { success: true }
                }));
              }
              break;

            case MessageType.HEARTBEAT:
              // Respond to heartbeat
              ws.send(JSON.stringify({
                type: MessageType.HEARTBEAT,
                messageId: message.messageId,
                timestamp: Date.now(),
                data: {}
              }));
              break;

            case MessageType.RESPONSE:
              // Device sends response to command - forward to Feishu via long connection
              if (message.data.openId) {
                if (message.data.success) {
                  await this.feishuLongConnHandler.sendMessage(
                    message.data.openId,
                    message.data.output || '✅ Command completed successfully'
                  );
                } else {
                  await this.feishuLongConnHandler.sendMessage(
                    message.data.openId,
                    `❌ Command failed:\n${message.data.error || 'Unknown error'}`
                  );
                }
              }
              break;

            default:
              console.log('Unknown message type:', message.type);
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      });

      // Handle connection close
      ws.on('close', () => {
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        if (deviceId) {
          this.connectionHub.unregisterConnection(deviceId);
          console.log('Device disconnected:', deviceId);
        }
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });

    console.log('WebSocket server listening on /ws');
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const port = this.config.get('server', 'port');
    const host = this.config.get('server', 'host');

    // Create HTTP server
    this.httpServer = this.app.listen(port, host);

    // Setup WebSocket server
    this.setupWebSocket(this.httpServer);

    // Start Feishu WebSocket long connection
    try {
      await this.feishuLongConnHandler.start();
    } catch (error) {
      console.error('⚠️  Failed to start Feishu long connection:', error);
      console.log('   Server will continue without Feishu integration');
    }

    // Start periodic cleanup of stale connections
    const heartbeatInterval = this.config.get('websocket', 'heartbeatInterval');
    this.cleanupInterval = setInterval(() => {
      // Cleanup connections that haven't sent heartbeat in 3x interval
      this.connectionHub.cleanupStaleConnections(heartbeatInterval * 3);
    }, heartbeatInterval);

    console.log(`\n🚀 Router server started successfully!`);
    console.log(`   HTTP: http://${host}:${port}`);
    console.log(`   WebSocket: ws://${host}:${port}/ws`);
    console.log(`   Environment: ${this.config.get('server', 'nodeEnv')}`);
    console.log(`\n✅ Ready to receive connections from local clients\n`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    console.log('Stopping router server...');

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Stop Feishu long connection
    try {
      await this.feishuLongConnHandler.stop();
    } catch (error) {
      console.error('Error stopping Feishu long connection:', error);
    }

    // Close all WebSocket connections
    this.connectionHub.closeAllConnections();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    console.log('✅ Router server stopped');
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return this.connectionHub.getConnectionStats();
  }
}
