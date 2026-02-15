import * as lark from '@larksuiteoapi/node-sdk';
import { v4 as uuidv4 } from 'uuid';
import { BindingManager } from '../binding/BindingManager';
import { ConnectionHub } from '../websocket/ConnectionHub';
import { MessageType } from '../types';
import { JsonStore } from '../storage/JsonStore';

/**
 * Feishu Long Connection Handler configuration
 */
export interface FeishuLongConnHandlerConfig {
  appId: string;
  appSecret: string;
  store: JsonStore;
}

/**
 * Feishu Long Connection Handler
 * Uses Feishu SDK's WSClient for WebSocket long connection
 */
export class FeishuLongConnHandler {
  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private bindingManager: BindingManager;
  private connectionHub: ConnectionHub | null = null;
  private appId: string;
  private appSecret: string;

  constructor(config: FeishuLongConnHandlerConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.bindingManager = new BindingManager(config.store);

    // Initialize Feishu SDK client for API calls
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });
  }

  /**
   * Set ConnectionHub (called from RouterServer)
   */
  setConnectionHub(hub: ConnectionHub): void {
    this.connectionHub = hub;
  }

  /**
   * Handle message event
   */
  private async handleMessageEvent(data: any): Promise<void> {
    try {
      const message = data.message;
      const sender = data.sender;

      // Skip non-text messages
      if (message.message_type !== 'text') {
        return;
      }

      const openId = sender.sender_id.open_id;
      const messageId = message.message_id;
      const content = this.parseMessageContent(message);

      console.log(`Received message from ${openId}: ${content}`);

      // Check if it's a command
      if (this.isCommand(content)) {
        await this.handleCommand(openId, messageId, content);
      } else {
        await this.handleRegularCommand(openId, messageId, content);
      }
    } catch (error) {
      console.error('Error in handleMessageEvent:', error);
    }
  }

  /**
   * Parse message content
   */
  private parseMessageContent(message: any): string {
    try {
      const content = JSON.parse(message.content);
      return (content.text || '').trim();
    } catch (error) {
      return '';
    }
  }

  /**
   * Check if it's a command
   */
  private isCommand(content: string): boolean {
    return content.startsWith('/');
  }

  /**
   * Handle command
   */
  private async handleCommand(openId: string, messageId: string, content: string): Promise<void> {
    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/bind':
        if (parts.length >= 2) {
          await this.handleBindCommand(openId, messageId, parts[1]);
        } else {
          await this.replyToMessage(messageId, 'Please provide binding code, format: /bind ABC-123-XYZ');
        }
        break;

      case '/status':
        await this.handleStatusCommand(openId, messageId);
        break;

      case '/unbind':
        await this.handleUnbindCommand(openId, messageId);
        break;

      case '/help':
        await this.handleHelpCommand(openId, messageId);
        break;

      default:
        await this.replyToMessage(messageId, 'Unknown command, send /help to see help');
    }
  }

  /**
   * Handle bind command
   */
  private async handleBindCommand(openId: string, messageId: string, code: string): Promise<void> {
    try {
      // Verify binding code
      const bindingCode = await this.bindingManager.verifyBindingCode(code);
      if (!bindingCode) {
        await this.replyToMessage(messageId, '❌ Binding code is invalid or expired, please generate a new one');
        return;
      }

      // Bind user
      const deviceName = 'Device'; // Will be updated by client later
      await this.bindingManager.bindUser(openId, bindingCode.deviceId, deviceName);

      await this.replyToMessage(
        messageId,
        `✅ Binding successful!\n\nDevice ID: ${bindingCode.deviceId}\n\nYou can now control your device through Feishu.`
      );
    } catch (error) {
      console.error('Error binding user:', error);
      await this.replyToMessage(messageId, '❌ Binding failed, please try again later');
    }
  }

  /**
   * Handle status command
   */
  private async handleStatusCommand(openId: string, messageId: string): Promise<void> {
    try {
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.replyToMessage(
          messageId,
          '❌ You have not bound a device yet, please send /bind <binding-code> to bind first'
        );
        return;
      }

      const isOnline = this.connectionHub?.isDeviceOnline(binding.deviceId) || false;
      const status = isOnline ? '🟢 Online' : '🔴 Offline';

      const message = `📊 Device Status\n\nDevice Name: ${binding.deviceName}\nDevice ID: ${binding.deviceId}\nStatus: ${status}\nBinding Time: ${new Date(binding.boundAt).toLocaleString('en-US')}`;

      await this.replyToMessage(messageId, message);
    } catch (error) {
      console.error('Error handling status command:', error);
      await this.replyToMessage(messageId, '❌ Status query failed, please try again later');
    }
  }

  /**
   * Handle unbind command
   */
  private async handleUnbindCommand(openId: string, messageId: string): Promise<void> {
    try {
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.replyToMessage(messageId, '❌ You have not bound a device yet');
        return;
      }

      await this.bindingManager.unbindUser(openId);
      await this.replyToMessage(
        messageId,
        `✅ Device ${binding.deviceName} has been unbound`
      );
    } catch (error) {
      console.error('Error handling unbind command:', error);
      await this.replyToMessage(messageId, '❌ Unbinding failed, please try again later');
    }
  }

  /**
   * Handle help command
   */
  private async handleHelpCommand(openId: string, messageId: string): Promise<void> {
    const helpMessage = `📖 Feishu Remote Control Help

Available commands:
/bind <binding-code> - Bind your device
/status - View device status
/unbind - Unbind device
/help - Show help information

Regular messages will be sent directly to your device for execution.

Examples:
• "List files in current directory"
• "Run tests"
• "View recent git commits"`;

    await this.replyToMessage(messageId, helpMessage);
  }

  /**
   * Handle regular command (non-slash commands)
   */
  private async handleRegularCommand(openId: string, messageId: string, content: string): Promise<void> {
    try {
      // Find user binding
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.replyToMessage(
          messageId,
          '❌ You have not bound a device yet, please send /bind <binding-code> to bind first'
        );
        return;
      }

      // Check if ConnectionHub is available
      if (!this.connectionHub) {
        await this.replyToMessage(messageId, '❌ Server error: ConnectionHub not initialized');
        return;
      }

      // Check if device is online
      if (!this.connectionHub.isDeviceOnline(binding.deviceId)) {
        await this.replyToMessage(
          messageId,
          `❌ Device ${binding.deviceName} is currently offline, please ensure the device is started and connected to the server`
        );
        return;
      }

      // Send command to device
      const success = await this.connectionHub.sendToDevice(binding.deviceId, {
        type: MessageType.COMMAND,
        messageId: uuidv4(),
        timestamp: Date.now(),
        data: {
          openId,
          content
        }
      });

      if (!success) {
        await this.replyToMessage(messageId, '❌ Command sending failed, please try again later');
      } else {
        // Acknowledge receipt
        await this.replyToMessage(messageId, '📤 Command sent to device...');
      }
    } catch (error) {
      console.error('Error handling regular command:', error);
      await this.replyToMessage(messageId, '❌ Error processing command, please try again later');
    }
  }

  /**
   * Reply to a message
   */
  private async replyToMessage(messageId: string, text: string): Promise<void> {
    try {
      await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    } catch (error: any) {
      console.error('Failed to reply to message:', error?.message || error);
    }
  }

  /**
   * Send message to user
   */
  async sendMessage(openId: string, text: string): Promise<boolean> {
    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      return true;
    } catch (error: any) {
      console.error('Failed to send message:', error?.message || error);
      return false;
    }
  }

  /**
   * Start the Feishu WebSocket long connection
   */
  async start(): Promise<void> {
    try {
      console.log('Starting Feishu WebSocket long connection...');

      // Create WSClient with event dispatcher
      this.wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        loggerLevel: lark.LoggerLevel.info,
      });

      // Start WebSocket client with event handler
      await this.wsClient.start({
        eventDispatcher: new lark.EventDispatcher({}).register({
          'im.message.receive_v1': async (data: any) => {
            await this.handleMessageEvent(data);
          }
        })
      });

      console.log('✅ Feishu WebSocket long connection established');
      console.log('   Listening for messages from Feishu...');
    } catch (error) {
      console.error('Failed to start Feishu WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Stop the Feishu connection
   */
  async stop(): Promise<void> {
    try {
      console.log('Stopping Feishu WebSocket connection...');

      // Close WebSocket connection
      if (this.wsClient) {
        // The SDK doesn't provide a stop method, but closing the instance should work
        this.wsClient = null;
      }

      await this.bindingManager.close();
      console.log('✅ Feishu WebSocket connection stopped');
    } catch (error) {
      console.error('Error stopping Feishu WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Get BindingManager instance
   */
  getBindingManager(): BindingManager {
    return this.bindingManager;
  }
}
