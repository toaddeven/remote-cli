import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { ConfigManager } from './config/ConfigManager';
import { JsonStore } from './storage/JsonStore';
import { FeishuHandler } from './webhook/FeishuHandler';
import { ConnectionHub } from './websocket/ConnectionHub';
import { MessageType } from './types';

/**
 * Router Server
 * Handles Feishu webhooks, WebSocket connections, and message routing
 */
export class RouterServer {
  private app: Koa;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private config: ConfigManager;
  private store: JsonStore;
  private feishuHandler: FeishuHandler;
  private connectionHub: ConnectionHub;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: ConfigManager, store: JsonStore) {
    this.config = config;
    this.store = store;
    this.app = new Koa();
    this.connectionHub = new ConnectionHub();

    // Initialize FeishuHandler
    this.feishuHandler = new FeishuHandler({
      appId: config.get('feishu', 'appId'),
      appSecret: config.get('feishu', 'appSecret'),
      encryptKey: config.get('feishu', 'encryptKey') || '',
      store: this.store
    });

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

    // Feishu webhook endpoint
    router.post('/webhook/feishu', async (ctx) => {
      const event = ctx.request.body;

      // Handle webhook
      const result = await this.feishuHandler.handleWebhook(event);

      ctx.body = result;
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
              // Device sends response to command - forward to Feishu
              if (message.data.openId) {
                const feishuClient = this.feishuHandler['feishuClient'];
                if (message.data.success) {
                  await feishuClient.sendTextMessage(
                    message.data.openId,
                    message.data.output || '✅ Command completed successfully'
                  );
                } else {
                  await feishuClient.sendTextMessage(
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

    // Give FeishuHandler access to ConnectionHub
    const originalHandler = this.feishuHandler;
    (originalHandler as any).connectionHub = this.connectionHub;

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

    // Flush data to disk
    await this.feishuHandler.close();

    console.log('✅ Router server stopped');
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return this.connectionHub.getConnectionStats();
  }
}
