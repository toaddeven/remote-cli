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
  // Track streaming messages: messageId -> { openId, feishuMessageId, buffer, hasUpdated }
  private streamingMessages: Map<string, { openId: string; feishuMessageId: string | null; buffer: string; hasUpdated: boolean }> = new Map();

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

    // Register callback for streaming message start
    this.feishuLongConnHandler.setOnStartStreaming((messageId: string, openId: string, feishuMessageId: string | null) => {
      console.log(`[RouterServer] Registering streaming session: msgId=${messageId}, feishuMsgId=${feishuMessageId}`);
      // Register this message as a streaming message so chunks and response update the same card
      // hasUpdated starts as false to ensure first content is immediately shown
      this.streamingMessages.set(messageId, { openId, feishuMessageId, buffer: '', hasUpdated: false });
      console.log(`[RouterServer] Total streaming sessions: ${this.streamingMessages.size}`);
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

        // If no heartbeat received within 3x interval, consider connection dead
        const interval = this.config.get('websocket', 'heartbeatInterval');
        heartbeatTimeout = setTimeout(() => {
          console.log('Heartbeat timeout for device:', deviceId);
          ws.close();
        }, interval * 3);
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
              const responseOpenId = message.openId || message.data?.openId;
              const responseMessageId = message.messageId;
              const sessionAbbr = message.sessionAbbr || message.data?.sessionAbbr;
              if (responseMessageId && responseOpenId) {
                // Check if this was a streaming message (stream chunks were sent)
                if (this.streamingMessages.has(responseMessageId)) {
                  await this.finalizeStreamingMessage(
                    responseMessageId,
                    message.success ?? message.data?.success,
                    message.output || message.data?.output,
                    message.error || message.data?.error,
                    sessionAbbr
                  );
                } else {
                  // No streaming session found - session should have been created when command was sent
                  // This might happen if there was an error. Just send the result as plain text.
                  const output = message.output || message.data?.output;
                  const success = message.success ?? message.data?.success;
                  const errorMsg = message.error || message.data?.error;

                  if (success) {
                    await this.feishuLongConnHandler.sendMessage(
                      responseOpenId,
                      output || '✅ Command completed successfully'
                    );
                  } else {
                    await this.feishuLongConnHandler.sendMessage(
                      responseOpenId,
                      `❌ Command failed:\n${errorMsg || 'Unknown error'}`
                    );
                  }
                }
              }
              break;

            case 'stream':
              // Handle streaming output from device
              if (message.messageId && message.openId) {
                await this.handleStreamingChunk(message.messageId, message.openId, message.chunk || '');
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

  // Track last update time for each streaming message to enable time-based updates
  private lastStreamUpdateTime: Map<string, number> = new Map();
  private readonly STREAM_UPDATE_INTERVAL_MS = 500; // Update at least every 500ms
  private readonly STREAM_UPDATE_MIN_LENGTH = 10;   // Update every 10 characters

  /**
   * Handle streaming chunk from device
   */
  private async handleStreamingChunk(messageId: string, openId: string, chunk: string): Promise<void> {
    console.log(`[RouterServer] Received stream chunk for ${messageId}, chunk length: ${chunk.length}`);
    const streamData = this.streamingMessages.get(messageId);

    // If no streaming session exists, ignore the chunk
    // The session should have been created when the command was sent
    if (!streamData) {
      console.log(`[RouterServer] No streaming session found for ${messageId}, ignoring chunk`);
      console.log(`[RouterServer] Known sessions: ${Array.from(this.streamingMessages.keys()).join(', ')}`);
      return;
    }

    // Accumulate chunk
    streamData.buffer += chunk;

    // Determine if we should update the card now
    const now = Date.now();
    const lastUpdate = this.lastStreamUpdateTime.get(messageId) || 0;
    const timeSinceLastUpdate = now - lastUpdate;
    const bufferLength = streamData.buffer.length;

    // Update if:
    // 1. We have a feishuMessageId
    // 2. Either:
    //    a. It's the first content (hasUpdated is false) - show immediately
    //    b. We've accumulated enough characters since last update
    //    c. Enough time has passed since last update
    const shouldUpdate = streamData.feishuMessageId && (
      !streamData.hasUpdated || // First content - always show immediately
      (bufferLength % this.STREAM_UPDATE_MIN_LENGTH === 0) || // Every N characters
      (timeSinceLastUpdate >= this.STREAM_UPDATE_INTERVAL_MS) // Time-based
    );

    if (shouldUpdate && streamData.feishuMessageId) {
      await this.feishuLongConnHandler.updateStreamingMessage(
        streamData.feishuMessageId,
        streamData.buffer
      );
      this.lastStreamUpdateTime.set(messageId, now);
      streamData.hasUpdated = true; // Mark as updated
    }
  }

  /**
   * Finalize streaming message
   */
  private async finalizeStreamingMessage(messageId: string, success: boolean, output?: string, error?: string, sessionAbbr?: string): Promise<void> {
    const streamData = this.streamingMessages.get(messageId);
    if (!streamData) return;

    const { feishuMessageId, openId } = streamData;

    if (feishuMessageId) {
      if (success) {
        // Use accumulated buffer if available, otherwise fall back to output parameter
        // Buffer contains all streamed content, which is more accurate for long-running tasks
        const finalContent = streamData.buffer || output || '✅ Completed';
        await this.feishuLongConnHandler.finalizeStreamingMessage(
          feishuMessageId,
          finalContent,
          sessionAbbr
        );
      } else {
        // Update card with error message
        const errorContent = streamData.buffer
          ? `${streamData.buffer}\n\n❌ Error: ${error || 'Command failed'}`
          : `❌ Command failed:\n${error || 'Unknown error'}`;
        await this.feishuLongConnHandler.finalizeStreamingMessage(
          feishuMessageId,
          errorContent,
          undefined
        );
      }
    }

    // Clean up
    this.streamingMessages.delete(messageId);
    this.lastStreamUpdateTime.delete(messageId);
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
