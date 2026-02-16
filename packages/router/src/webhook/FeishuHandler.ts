import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { BindingManager } from '../binding/BindingManager';
import { ConnectionHub } from '../websocket/ConnectionHub';
import { FeishuClient } from '../feishu/FeishuClient';
import { MessageType } from '../types';
import { JsonStore } from '../storage/JsonStore';

/**
 * Feishu Webhook Handler configuration
 */
export interface FeishuHandlerConfig {
  appId: string;
  appSecret: string;
  encryptKey: string;
  store: JsonStore;
}

/**
 * Feishu Webhook Handler
 * Responsible for receiving Feishu event callbacks, parsing messages, and routing commands
 */
export class FeishuHandler {
  private appId: string;
  private appSecret: string;
  private encryptKey: string;
  private bindingManager: BindingManager;
  private connectionHub: ConnectionHub;
  private feishuClient: FeishuClient;

  constructor(config: FeishuHandlerConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.encryptKey = config.encryptKey;

    this.bindingManager = new BindingManager(config.store);
    this.connectionHub = new ConnectionHub();
    this.feishuClient = new FeishuClient(config.appId, config.appSecret);
  }

  /**
   * Verify Feishu signature
   * @param timestamp Timestamp
   * @param nonce Random number
   * @param body Request body
   * @param signature Signature
   * @returns Whether it is valid
   */
  verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    // Check if timestamp is within 5 minutes
    const currentTimestamp = Date.now();
    const requestTimestamp = parseInt(timestamp);
    if (currentTimestamp - requestTimestamp > 5 * 60 * 1000) {
      return false;
    }

    // Calculate signature
    const str = timestamp + nonce + this.encryptKey + body;
    const expectedSignature = crypto.createHmac('sha256', this.encryptKey).update(str).digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Handle Feishu Webhook callback
   * @param event Feishu event
   * @returns Processing result
   */
  async handleWebhook(event: any): Promise<any> {
    try {
      // Handle URL verification challenge
      if (event.type === 'url_verification') {
        return { challenge: event.challenge };
      }

      // Handle message event
      if (event.header?.event_type === 'im.message.receive_v1') {
        const openId = event.event.sender.sender_id.open_id;
        const messageId = event.event.message.message_id;
        const content = this.parseMessageContent(event.event.message);

        // Check if it's a command
        if (this.isCommand(content)) {
          await this.handleCommand(openId, messageId, content);
        } else {
          await this.handleRegularCommand(openId, messageId, content);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error handling webhook:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Handle command
   * @param openId User open_id
   * @param messageId Message ID
   * @param content Message content
   */
  async handleCommand(openId: string, messageId: string, content: string): Promise<void> {
    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/bind':
        if (parts.length >= 2) {
          await this.handleBindCommand(openId, messageId, parts[1]);
        } else {
          await this.feishuClient.replyToMessage(messageId, 'Please provide binding code, format: /bind ABC-123-XYZ');
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
        await this.feishuClient.replyToMessage(messageId, 'Unknown command, send /help to see help');
    }
  }

  /**
   * Handle bind command
   * @param openId User open_id
   * @param messageId Message ID
   * @param code Binding code
   */
  async handleBindCommand(openId: string, messageId: string, code: string): Promise<void> {
    try {
      // Verify binding code
      const bindingCode = await this.bindingManager.verifyBindingCode(code);
      if (!bindingCode) {
        await this.feishuClient.replyToMessage(messageId, '❌ Invalid binding code. Please check and try again, or generate a new binding code.');
        return;
      }

      // Bind user
      const deviceName = 'MacBook-Pro'; // Should actually be obtained from client
      await this.bindingManager.bindUser(openId, bindingCode.deviceId, deviceName);

      await this.feishuClient.replyToMessage(
        messageId,
        `✅ Binding successful!\n\nDevice: ${deviceName}\nDevice ID: ${bindingCode.deviceId}\n\nYou can now control your device through Feishu.`
      );
    } catch (error) {
      console.error('Error binding user:', error);
      await this.feishuClient.replyToMessage(messageId, '❌ Binding Failed. Please try again later.');
    }
  }

  /**
   * Handle regular command
   * @param openId User open_id
   * @param messageId Message ID
   * @param content Message content
   */
  async handleRegularCommand(openId: string, messageId: string, content: string): Promise<void> {
    try {
      // Find user binding
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.feishuClient.replyToMessage(
          messageId,
          '❌ You have not bound a device yet, please send /bind <binding-code> to bind first'
        );
        return;
      }

      // Check if device is online
      if (!this.connectionHub.isDeviceOnline(binding.deviceId)) {
        await this.feishuClient.replyToMessage(
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
        await this.feishuClient.replyToMessage(messageId, '❌ Failed to send command. Please try again later.');
      }
    } catch (error) {
      console.error('Error handling regular command:', error);
      await this.feishuClient.replyToMessage(messageId, '❌ Error processing command, please try again later');
    }
  }

  /**
   * Handle status query command
   * @param openId User open_id
   * @param messageId Message ID
   */
  async handleStatusCommand(openId: string, messageId: string): Promise<void> {
    try {
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.feishuClient.replyToMessage(
          messageId,
          '❌ You have not bound a device yet, please send /bind <binding-code> to bind first'
        );
        return;
      }

      const isOnline = this.connectionHub.isDeviceOnline(binding.deviceId);
      const status = isOnline ? '🟢 Online' : '🔴 Offline';

      const message = `📊 Device Status\n\nDevice Name: ${binding.deviceName}\nDevice ID: ${binding.deviceId}\nStatus: ${isOnline ? '🟢 online' : '🔴 offline'}\nBinding Time: ${new Date(binding.boundAt).toLocaleString('en-US')}`;

      await this.feishuClient.replyToMessage(messageId, message);
    } catch (error) {
      console.error('Error handling status command:', error);
      await this.feishuClient.replyToMessage(messageId, '❌ Status query failed, please try again later');
    }
  }

  /**
   * Handle unbind command
   * @param openId User open_id
   * @param messageId Message ID
   */
  async handleUnbindCommand(openId: string, messageId: string): Promise<void> {
    try {
      const binding = await this.bindingManager.getUserBinding(openId);
      if (!binding) {
        await this.feishuClient.replyToMessage(messageId, '❌ You have not bound a device yet');
        return;
      }

      await this.bindingManager.unbindUser(openId);
      await this.feishuClient.replyToMessage(
        messageId,
        `✅ Unbind successful. Device ${binding.deviceName} has been unbound.`
      );
    } catch (error) {
      console.error('Error handling unbind command:', error);
      await this.feishuClient.replyToMessage(messageId, '❌ Unbinding failed, please try again later');
    }
  }

  /**
   * Handle help command
   * @param openId User open_id
   * @param messageId Message ID
   */
  async handleHelpCommand(openId: string, messageId: string): Promise<void> {
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

    await this.feishuClient.replyToMessage(messageId, helpMessage);
  }

  /**
   * Parse message content
   * @param message Feishu message object
   * @returns Message text content
   */
  parseMessageContent(message: any): string {
    try {
      if (message.message_type !== 'text') {
        return '';
      }

      const content = JSON.parse(message.content);
      return (content.text || '').trim();
    } catch (error) {
      return '';
    }
  }

  /**
   * Check if it's a command
   * @param content Message content
   * @returns Whether it is a command
   */
  isCommand(content: string): boolean {
    return content.startsWith('/');
  }

  /**
   * Get ConnectionHub instance (for external integration)
   */
  getConnectionHub(): ConnectionHub {
    return this.connectionHub;
  }

  /**
   * Get BindingManager instance (for external integration)
   */
  getBindingManager(): BindingManager {
    return this.bindingManager;
  }

  /**
   * Close all resources
   */
  async close(): Promise<void> {
    await this.bindingManager.close();
    this.connectionHub.closeAllConnections();
  }
}
