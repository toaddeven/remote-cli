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
  // Feishu message size limit (4000 chars per message)
  private readonly FEISHU_MESSAGE_LIMIT = 4000;
  // Track message chains: messageId -> [messageId1, messageId2, ...]
  private messageChains: Map<string, string[]> = new Map();
  // Track the last processed text length for each message chain
  // This helps us only send NEW content to existing messages, preventing duplication
  private lastProcessedLengths: Map<string, number> = new Map();
  // Per-message serialization locks to prevent concurrent updates from creating duplicates
  private messageLocks: Map<string, Promise<any>> = new Map();

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
   * Callback to register streaming message with RouterServer
   */
  private onStartStreaming?: (messageId: string, openId: string, feishuMessageId: string | null, deviceId: string) => void;

  /**
   * Set streaming start callback
   */
  setOnStartStreaming(callback: (messageId: string, openId: string, feishuMessageId: string | null, deviceId: string) => void): void {
    this.onStartStreaming = callback;
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

      console.log(`[FeishuHandler] Received message from ${openId}: ${content}, msgId=${messageId}`);

      // Check if it's a command
      if (this.isCommand(content)) {
        await this.handleCommand(openId, messageId, content);
      } else {
        console.log(`[FeishuHandler] Handling regular command, msgId=${messageId}`);
        await this.handleRegularCommand(openId, messageId, content);
        console.log(`[FeishuHandler] Finished handling regular command, msgId=${messageId}`);
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
        // Pass through unknown slash commands to the client
        // This allows users to use their local Claude Code custom commands
        await this.handleSlashCommandPassthrough(openId, messageId, content, command);
    }
  }

  /**
   * Handle slash command passthrough to client
   * Passes unknown slash commands to the local Claude Code instance
   */
  private async handleSlashCommandPassthrough(
    openId: string,
    messageId: string,
    content: string,
    command: string
  ): Promise<void> {
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

      console.log(`[FeishuHandler] Passing through slash command: ${command}`);

      // Generate message ID first
      const commandMessageId = uuidv4();

      // Register streaming session BEFORE sending command
      const feishuMessageId = await this.sendStreamingStart(openId, `🤔 Executing ${command}...`);
      console.log(`[FeishuHandler] Created card ${feishuMessageId} for slash command ${commandMessageId}`);
      if (this.onStartStreaming) {
        this.onStartStreaming(commandMessageId, openId, feishuMessageId, binding.deviceId);
      }

      // Send slash command to device - the client will execute it locally
      const success = await this.connectionHub.sendToDevice(binding.deviceId, {
        type: MessageType.COMMAND,
        messageId: commandMessageId,
        timestamp: Date.now(),
        content, // Send the full command including arguments
        openId,
        isSlashCommand: true, // Flag to indicate this is a slash command
      });

      if (!success) {
        await this.replyToMessage(messageId, '❌ Command sending failed, please try again later');
      }
    } catch (error) {
      console.error('Error handling slash command passthrough:', error);
      await this.replyToMessage(messageId, '❌ Error processing command, please try again later');
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

      // Generate message ID first
      const commandMessageId = uuidv4();
      console.log(`[FeishuHandler] Creating streaming card for command ${commandMessageId}`);

      // Register streaming session BEFORE sending command to avoid race condition
      // where stream chunks arrive before registration
      const feishuMessageId = await this.sendStreamingStart(openId, '🤔 Processing...');
      console.log(`[FeishuHandler] Created card ${feishuMessageId} for command ${commandMessageId}`);
      if (this.onStartStreaming) {
        this.onStartStreaming(commandMessageId, openId, feishuMessageId, binding.deviceId);
      }

      // Send command to device
      const success = await this.connectionHub.sendToDevice(binding.deviceId, {
        type: MessageType.COMMAND,
        messageId: commandMessageId,
        timestamp: Date.now(),
        content,
        openId
      });

      if (!success) {
        // Send failed - delete the streaming session and notify user
        if (this.onStartStreaming) {
          // We need a way to clean up, for now just send error as new message
          await this.replyToMessage(messageId, '❌ Command sending failed, please try again later');
        }
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
   * Send streaming message with card update support
   * Returns message_id for updating
   */
  async sendStreamingStart(openId: string, initialText: string = '🤔 Thinking...'): Promise<string | null> {
    console.log(`[FeishuHandler] Creating interactive card for ${openId}`);
    try {
      const result = await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'interactive',
          content: JSON.stringify({
            config: { wide_screen_mode: true },
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: initialText,
                },
              },
            ],
          }),
        },
      });
      return result?.data?.message_id || null;
    } catch (error: any) {
      console.error('Failed to send streaming start:', error?.message || error);
      return null;
    }
  }

  /**
   * Serialize async operations per messageId to prevent race conditions.
   * Concurrent calls for the same messageId will queue and execute in order.
   */
  private async withMessageLock<T>(messageId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.messageLocks.get(messageId) || Promise.resolve();
    const current = previous.then(fn, fn); // Run fn after previous completes (even if it failed)
    this.messageLocks.set(messageId, current);
    try {
      return await current;
    } finally {
      // Clean up lock if this is still the latest operation
      if (this.messageLocks.get(messageId) === current) {
        this.messageLocks.delete(messageId);
      }
    }
  }

  /**
   * Split text into chunks that fit within Feishu's message size limit
   * Tries to split at newlines to keep context intact
   *
   * Reserves space for continuation indicators:
   * - "~➡️ Continued in next message...~" (40 chars) at end of non-final chunks
   * - "~⬅️ Continued from previous message...~" (44 chars) at start of continuation chunks
   */
  private splitTextIntoChunks(text: string, limit: number = this.FEISHU_MESSAGE_LIMIT): string[] {
    // Reserve space for continuation indicator
    const continuationOverhead = 50; // "\n\n_➡️ Continued in next message..._"
    const effectiveLimit = limit - continuationOverhead;

    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let remainingText = text;

    while (remainingText.length > 0) {
      if (remainingText.length <= limit) {
        chunks.push(remainingText);
        break;
      }

      // Try to find a good split point (newline, space, or just at limit)
      let splitPoint = effectiveLimit;

      // Look for last newline before limit
      const lastNewline = remainingText.lastIndexOf('\n', effectiveLimit);
      if (lastNewline > effectiveLimit * 0.7) { // Only split at newline if it's not too far back
        splitPoint = lastNewline + 1;
      } else {
        // Look for last space before limit
        const lastSpace = remainingText.lastIndexOf(' ', effectiveLimit);
        if (lastSpace > effectiveLimit * 0.8) { // Only split at space if it's close to limit
          splitPoint = lastSpace + 1;
        }
      }

      chunks.push(remainingText.substring(0, splitPoint));
      remainingText = remainingText.substring(splitPoint);
    }

    return chunks;
  }

  /**
   * Update streaming message content
   * Automatically creates new messages if content exceeds Feishu's size limit
   *
   * This method uses an incremental approach to prevent content duplication:
   * - Once a message (except the last one) is created, its content is frozen
   * - Only the last message in the chain gets updated with new content
   * - New messages are only created when the last message exceeds the limit
   */
  async updateStreamingMessage(messageId: string, text: string, openId?: string): Promise<boolean> {
    return this.withMessageLock(messageId, () => this._updateStreamingMessage(messageId, text, openId));
  }

  private async _updateStreamingMessage(messageId: string, text: string, openId?: string): Promise<boolean> {
    try {
      // Get or initialize message chain
      let chain = this.messageChains.get(messageId);
      if (!chain) {
        chain = [messageId]; // First message in chain
        this.messageChains.set(messageId, chain);
      }

      // Get the last processed length for this chain
      const lastProcessedLength = this.lastProcessedLengths.get(messageId) || 0;

      // Split text into chunks
      const chunks = this.splitTextIntoChunks(text);

      // Calculate cumulative lengths to determine which chunk each character belongs to
      const cumulativeLengths: number[] = [];
      let cumulative = 0;
      for (const chunk of chunks) {
        cumulative += chunk.length;
        cumulativeLengths.push(cumulative);
      }

      // Determine which chunk contains the last processed character
      // This tells us which messages are "complete" (frozen) vs which is still growing
      let lastProcessedChunkIndex = 0;
      for (let i = 0; i < cumulativeLengths.length; i++) {
        if (lastProcessedLength <= cumulativeLengths[i]) {
          lastProcessedChunkIndex = i;
          break;
        }
      }

      // Update existing messages and create new ones as needed
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLastChunk = i === chunks.length - 1;

        // Add continuation indicator if not the last chunk
        const content = isLastChunk ? chunk : `${chunk}\n\n_➡️ Continued in next message..._`;

        if (i < chain.length) {
          // This is an existing message
          // Only update if:
          // 1. It's the last chunk (still receiving new content)
          // 2. OR it's the chunk containing the last processed position (transitioning from growing to frozen)
          const shouldUpdate = isLastChunk || i >= lastProcessedChunkIndex;

          if (shouldUpdate) {
            await this.client.im.message.patch({
              path: { message_id: chain[i] },
              data: {
                content: JSON.stringify({
                  config: { wide_screen_mode: true },
                  elements: [
                    {
                      tag: 'div',
                      text: {
                        tag: 'lark_md',
                        content,
                      },
                    },
                  ],
                }),
              },
            });
          }
          // If not updating, the message keeps its previous content (frozen)
        } else if (openId) {
          // Create new message for additional chunks
          const prefix = `_⬅️ Continued from previous message..._\n\n`;
          const newContent = isLastChunk ? `${prefix}${chunk}` : `${prefix}${chunk}\n\n_➡️ Continued in next message..._`;

          const result = await this.client.im.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
              receive_id: openId,
              msg_type: 'interactive',
              content: JSON.stringify({
                config: { wide_screen_mode: true },
                elements: [
                  {
                    tag: 'div',
                    text: {
                      tag: 'lark_md',
                      content: newContent,
                    },
                  },
                ],
              }),
            },
          });

          const newMessageId = result?.data?.message_id;
          if (newMessageId) {
            chain.push(newMessageId);
            console.log(`[FeishuHandler] Created continuation message ${newMessageId} for chain (part ${i + 1}/${chunks.length})`);
          }
        } else {
          console.warn(`[FeishuHandler] Cannot create continuation message: openId not provided`);
          break;
        }
      }

      // Update the last processed length
      this.lastProcessedLengths.set(messageId, text.length);

      return true;
    } catch (error: any) {
      console.error('Failed to update streaming message:', error?.message || error);
      return false;
    }
  }

  /**
   * Finalize streaming message
   * Automatically creates new messages if content exceeds Feishu's size limit
   */
  async finalizeStreamingMessage(messageId: string, finalText: string, sessionAbbr?: string, openId?: string): Promise<boolean> {
    return this.withMessageLock(messageId, () => this._finalizeStreamingMessage(messageId, finalText, sessionAbbr, openId));
  }

  private async _finalizeStreamingMessage(messageId: string, finalText: string, sessionAbbr?: string, openId?: string): Promise<boolean> {
    try {
      // Get or initialize message chain
      let chain = this.messageChains.get(messageId);
      if (!chain) {
        chain = [messageId];
        this.messageChains.set(messageId, chain);
      }

      // Build note content with session abbreviation if available
      let noteContent = '✅ Completed';
      if (sessionAbbr) {
        noteContent += ` · Session: ${sessionAbbr}`;
      }

      // Split text into chunks
      const chunks = this.splitTextIntoChunks(finalText);

      // Use lastProcessedLengths to determine which messages are frozen
      // Same logic as updateStreamingMessage to ensure consistency
      const lastProcessedLength = this.lastProcessedLengths.get(messageId) || 0;

      let lastProcessedChunkIndex = 0;
      if (lastProcessedLength > 0) {
        let cumulative = 0;
        for (let i = 0; i < chunks.length; i++) {
          cumulative += chunks[i].length;
          if (lastProcessedLength <= cumulative) {
            lastProcessedChunkIndex = i;
            break;
          }
          // If lastProcessedLength exceeds all chunks, point to last chunk
          lastProcessedChunkIndex = i;
        }
      }

      // Update existing messages and create new ones as needed
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLastChunk = i === chunks.length - 1;

        // Add continuation indicator if not the last chunk
        const content = isLastChunk ? chunk : `${chunk}\n\n_➡️ Continued in next message..._`;

        // Only add completion note to the last chunk
        const elements: any[] = [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content,
            },
          },
        ];

        if (isLastChunk) {
          elements.push({
            tag: 'note',
            elements: [
              {
                tag: 'plain_text',
                content: noteContent,
              },
            ],
          });
        }

        if (i < chain.length) {
          // This is an existing message in the chain
          // Only update if it's at or after the last processed chunk index
          // Messages before that are frozen and should not be re-patched
          const shouldUpdate = isLastChunk || i >= lastProcessedChunkIndex;

          if (shouldUpdate) {
            await this.client.im.message.patch({
              path: { message_id: chain[i] },
              data: {
                content: JSON.stringify({
                  config: { wide_screen_mode: true },
                  elements,
                }),
              },
            });
          }
        } else if (openId) {
          // Create new message for additional chunks
          const prefix = `_⬅️ Continued from previous message..._\n\n`;
          const newContent = isLastChunk ? `${prefix}${chunk}` : `${prefix}${chunk}\n\n_➡️ Continued in next message..._`;

          const newElements: any[] = [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: newContent,
              },
            },
          ];

          if (isLastChunk) {
            newElements.push({
              tag: 'note',
              elements: [
                {
                  tag: 'plain_text',
                  content: noteContent,
                },
              ],
            });
          }

          const result = await this.client.im.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
              receive_id: openId,
              msg_type: 'interactive',
              content: JSON.stringify({
                config: { wide_screen_mode: true },
                elements: newElements,
              }),
            },
          });

          const newMessageId = result?.data?.message_id;
          if (newMessageId) {
            chain.push(newMessageId);
            console.log(`[FeishuHandler] Created final continuation message ${newMessageId} for chain (part ${i + 1}/${chunks.length})`);
          }
        } else {
          console.warn(`[FeishuHandler] Cannot create continuation message: openId not provided`);
          break;
        }
      }

      // Clean up message chain tracking
      this.messageChains.delete(messageId);
      this.lastProcessedLengths.delete(messageId);

      return true;
    } catch (error: any) {
      console.error('Failed to finalize streaming message:', error?.message || error);
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
