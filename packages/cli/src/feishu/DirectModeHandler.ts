import * as lark from '@larksuiteoapi/node-sdk';
import { v4 as uuidv4 } from 'uuid';
import { FeishuClient } from './FeishuClient';
import {
  FeishuCardElement,
  createMarkdownElement,
  createToolUseElement,
  createToolResultElement,
  createRedactedThinkingElement,
  createPlanModeElement,
  createDividerElement,
} from './ToolFormatter';
import type { ClaudeExecutor, ClaudePersistentExecutor } from '../executor';
import { DirectoryGuard } from '../security/DirectoryGuard';
import { ConfigManager } from '../config/ConfigManager';
import { ToolUseInfo, ToolResultInfo } from '../types';
import { processFileReadContent } from '../utils/FileReadDetector';
import { spawn } from 'child_process';

/**
 * Direct mode configuration
 */
export interface DirectModeHandlerConfig {
  appId: string;
  appSecret: string;
  openId?: string;
}

/**
 * Streaming session data
 */
interface StreamingSession {
  feishuMessageId: string | null;
  elements: FeishuCardElement[];
  currentTextContent: string;
  hasUpdated: boolean;
  createdAt: number;
  messageId: string;
  openId: string;
}

/**
 * Direct Mode Handler
 * Integrates Feishu long connection directly with CLI executor
 * Architecture: Feishu ↔ DirectModeHandler ↔ Executor ↔ Claude Code
 */
export class DirectModeHandler {
  private feishuClient: FeishuClient;
  private larkClient: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private appId: string;
  private appSecret: string;
  private openId: string | null;
  private executor: ClaudeExecutor | ClaudePersistentExecutor;
  private directoryGuard: DirectoryGuard;
  private config: ConfigManager;
  private isDestroyed = false;
  private isExecuting = false;
  private currentMessageId: string | null = null;

  // Streaming state
  private streamingSessions: Map<string, StreamingSession> = new Map();
  private messageChains: Map<string, string[]> = new Map();
  private lastProcessedLengths: Map<string, number> = new Map();
  private messageLocks: Map<string, Promise<any>> = new Map();
  private lastStreamUpdateTime: Map<string, number> = new Map();

  // Feishu Card limits
  private readonly CARD_ELEMENT_LIMIT = 150;
  private readonly CARD_DATA_SIZE_LIMIT = 3000000;
  private readonly CARD_SIZE_BUFFER = 100000;
  private readonly STREAM_UPDATE_INTERVAL_MS = 500;
  private readonly STREAM_UPDATE_MIN_LENGTH = 10;

  constructor(
    config: DirectModeHandlerConfig,
    executor: ClaudeExecutor | ClaudePersistentExecutor,
    directoryGuard: DirectoryGuard,
    cliConfig: ConfigManager
  ) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.openId = config.openId || null;
    this.executor = executor;
    this.directoryGuard = directoryGuard;
    this.config = cliConfig;
    this.feishuClient = new FeishuClient(config.appId, config.appSecret);
    this.larkClient = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  /**
   * Start the Feishu WebSocket long connection
   */
  async start(): Promise<void> {
    try {
      console.log('[DirectMode] Starting Feishu WebSocket long connection...');

      this.wsClient = new lark.WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        loggerLevel: lark.LoggerLevel.info,
      });

      await this.wsClient.start({
        eventDispatcher: new lark.EventDispatcher({}).register({
          'im.message.receive_v1': async (data: any) => {
            await this.handleMessageEvent(data);
          }
        })
      });

      console.log('[DirectMode] ✅ Feishu WebSocket long connection established');

      // Send welcome message if openId is known
      if (this.openId) {
        await this.sendWelcomeMessage();
      } else {
        console.log('[DirectMode] Waiting for first message to get openId...');
      }
    } catch (error) {
      console.error('[DirectMode] ❌ Failed to start Feishu connection:', error);
      throw error;
    }
  }

  /**
   * Stop the Feishu connection
   */
  async stop(): Promise<void> {
    try {
      console.log('[DirectMode] Stopping Feishu WebSocket connection...');
      this.isDestroyed = true;

      if (this.wsClient) {
        this.wsClient = null;
      }

      console.log('[DirectMode] ✅ Feishu WebSocket connection stopped');
    } catch (error) {
      console.error('[DirectMode] Error stopping Feishu connection:', error);
      throw error;
    }
  }

  /**
   * Set openId (can be called after first message
   */
  setOpenId(openId: string): void {
    this.openId = openId;
  }

  /**
   * Send welcome message to user
   */
  private async sendWelcomeMessage(): Promise<void> {
    if (!this.openId) return;

    const welcomeText = `🤖 **Remote CLI Direct Mode**

Connected and ready! You can now control Claude Code directly from Feishu.

**Available commands:**
- /help - Show help
- /status - Show current status
- /cd <directory> - Change working directory
- /clear - Clear conversation context
- /abort - Abort current command
- /compact - Compress conversation history

Just send a message and I will process it! 🚀`;

    await this.feishuClient.sendTextMessage(this.openId, welcomeText);
  }

  /**
   * Handle incoming message from Feishu
   */
  private async handleMessageEvent(data: any): Promise<void> {
    try {
      // Log received event for debugging
      const eventStr = JSON.stringify(data);
      console.log('[DirectMode] Received event:', eventStr.substring(0, 800));

      // Handle different event structures
      // Some versions have data.event.message, others have data.message directly
      let message: any;
      let sender: any;

      if (data.event) {
        // Structure: { schema: "2.0", event: { message: ..., sender: ... } }
        message = data.event.message;
        sender = data.event.sender;
      } else {
        // Structure: { schema: "2.0", message: ..., sender: ... }
        message = data.message;
        sender = data.sender;
      }

      // Also check for sender in message (some versions have sender_id.message_id)
      if (!sender && message?.sender_id) {
        sender = { sender_id: message.sender_id };
      }

      if (!message) {
        console.log('[DirectMode] Invalid message event structure: missing message');
        console.log('[DirectMode]   data.event exists:', !!data.event);
        console.log('[DirectMode]   data.message exists:', !!data.message);
        return;
      }

      if (!sender) {
        console.log('[DirectMode] Invalid message event structure: missing sender');
        return;
      }

      // Extract openId from various possible locations
      let openId: string | undefined;
      if (sender.sender_id?.open_id) {
        openId = sender.sender_id.open_id;
      } else if (sender.open_id) {
        openId = sender.open_id;
      } else if (message.sender_id?.open_id) {
        openId = message.sender_id.open_id;
      }

      const messageId = message.message_id;
      const content = this.parseMessageContent(message);

      console.log('[DirectMode] Parsed message:');
      console.log('[DirectMode]   openId:', openId);
      console.log('[DirectMode]   messageId:', messageId);
      console.log('[DirectMode]   content:', content?.substring(0, 100));

      if (!openId || !content) {
        console.log('[DirectMode] Missing openId or content, skipping');
        console.log('[DirectMode]   openId missing:', !openId);
        console.log('[DirectMode]   content missing:', !content);
        console.log('[DirectMode]   sender object:', JSON.stringify(sender));
        return;
      }

      // Save openId if not set
      if (!this.openId) {
        this.openId = openId;
        await this.config.set('openId', openId);
        console.log(`[DirectMode] Set openId: ${openId}`);
      }

      // Ignore messages from other users if we already have an openId
      if (this.openId && openId !== this.openId) {
        console.log(`[DirectMode] Ignoring message from different user: ${openId}`);
        return;
      }

      console.log(`[DirectMode] Received message: ${content.substring(0, 100)}...`);

      // Handle command
      if (this.isCommand(content)) {
        await this.handleCommand(openId, messageId, content);
      } else {
        await this.handleRegularCommand(openId, messageId, content);
      }
    } catch (error) {
      console.error('[DirectMode] Error in handleMessageEvent:', error);
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
      case '/help':
        await this.handleHelpCommand(openId, messageId);
        break;

      case '/status':
        await this.handleStatusCommand(openId, messageId);
        break;

      case '/clear':
        await this.handleClearCommand(openId, messageId);
        break;

      case '/compact':
        await this.handleCompactCommand(openId, messageId);
        break;

      case '/abort':
        await this.handleAbortCommand(openId, messageId);
        break;

      case '/cd':
        await this.handleCdCommand(openId, messageId, parts.slice(1).join(' '));
        break;

      default:
        // Pass through to executor as slash command
        await this.handleSlashCommand(openId, messageId, content);
    }
  }

  /**
   * Handle /help command
   */
  private async handleHelpCommand(openId: string, messageId: string): Promise<void> {
    const helpText = `📖 **Remote CLI Direct Mode Help**

**Built-in commands:**
- /help - Show this help message
- /status - Show current status
- /cd <directory> - Change working directory
- /clear - Clear conversation context
- /abort - Abort the currently executing command
- /compact - Compress conversation history

**How to use:
Just send a natural language message and I'll process it with Claude Code!`;

    await this.replyToMessage(messageId, helpText);
  }

  /**
   * Handle /status command
   */
  private async handleStatusCommand(openId: string, messageId: string): Promise<void> {
    const cwd = this.executor.getCurrentWorkingDirectory();
    const allowedDirs = this.directoryGuard.getAllowedDirectories();

    const statusText = `📊 **Status**
- Working Directory: ${cwd}
- Allowed Directories: ${allowedDirs.join(', ')}
- Mode: Direct (no router)`;

    await this.replyToMessage(messageId, statusText);
  }

  /**
   * Handle /clear command
   */
  private async handleClearCommand(openId: string, messageId: string): Promise<void> {
    this.executor.resetContext();
    await this.replyToMessage(messageId, '✅ Conversation context cleared');
  }

  /**
   * Handle /compact command
   */
  private async handleCompactCommand(openId: string, messageId: string): Promise<void> {
    if (!('compactWhenFull' in this.executor && typeof this.executor.compactWhenFull === 'function')) {
      await this.replyToMessage(messageId, '/compact is not supported in this executor mode');
      return;
    }

    await this.replyToMessage(messageId, '🗜️ Compressing conversation history...');

    const persistentExecutor = this.executor as ClaudePersistentExecutor;
    const result = await persistentExecutor.compactWhenFull((chunk: string) => {
      // We don't need to stream in this case
    });

    if (!result.success) {
      await this.replyToMessage(messageId, `❌ Compression failed: ${result.error}`);
    } else {
      await this.replyToMessage(messageId, '✅ Conversation history compressed');
    }
  }

  /**
   * Handle /abort command
   */
  private async handleAbortCommand(openId: string, messageId: string): Promise<void> {
    const wasExecuting = this.isExecuting;
    const aborted = await this.executor.abort();

    if (aborted) {
      this.isExecuting = false;
      await this.replyToMessage(
        messageId,
        wasExecuting
          ? '✅ Current command has been aborted'
          : '⚠️ No command was executing, but executor has been reset'
      );
    } else {
      await this.replyToMessage(messageId, 'ℹ️ No command is currently executing');
    }
  }

  /**
   * Handle /cd command
   */
  private async handleCdCommand(openId: string, messageId: string, targetDir: string): Promise<void> {
    if (!targetDir) {
      await this.replyToMessage(messageId, 'Usage: /cd <directory>');
      return;
    }

    try {
      await this.executor.setWorkingDirectory(targetDir);
      const newCwd = this.executor.getCurrentWorkingDirectory();

      await this.config.set('lastWorkingDirectory', newCwd);
      await this.replyToMessage(messageId, `✅ Changed working directory to: ${newCwd}`);
    } catch (error) {
      await this.replyToMessage(
        messageId,
        error instanceof Error
          ? error.message
          : 'Failed to change directory'
      );
    }
  }

  /**
   * Handle slash command passthrough
   */
  private async handleSlashCommand(openId: string, messageId: string, command: string): Promise<void> {
    console.log(`[DirectMode] Executing slash command: ${command}`);

    // Create streaming card
    const commandMessageId = uuidv4();
    const feishuMessageId = await this.sendStreamingStart(openId, `🤔 Executing ${command}...`);

    if (feishuMessageId) {
      this.registerStreamingSession(commandMessageId, openId, feishuMessageId);
    }

    try {
      return new Promise((resolve) => {
        const chunks: string[] = [];
        const errorChunks: string[] = [];

        const child = spawn('claude', [command, '--print'], {
          cwd: this.executor.getCurrentWorkingDirectory(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CLAUDECODE: '',
          },
        });

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          chunks.push(chunk);
          this.handleTextChunk(commandMessageId, openId, chunk);
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          errorChunks.push(chunk);
          console.error(`[DirectMode] Claude stderr: ${chunk}`);
        });

        child.on('exit', async (code) => {
          console.log(`[DirectMode] Claude process exited with code: ${code}`);

          if (code === 0) {
            const output = chunks.join('');
            await this.finalizeStreamingMessage(
              commandMessageId,
              true,
              output.trim() || '✅ Command executed successfully',
              undefined,
              undefined
            );
          } else {
            const errorOutput = errorChunks.join('') || chunks.join('');
            await this.finalizeStreamingMessage(
              commandMessageId,
              false,
              undefined,
              errorOutput.trim() || `Command failed with exit code ${code}`
            );
          }
          resolve();
        });

        child.on('error', async (error) => {
          console.error(`[DirectMode] Failed to spawn Claude:`, error);
          await this.finalizeStreamingMessage(
            commandMessageId,
            false,
            undefined,
            `Failed to execute command: ${error.message}`
          );
          resolve();
        });
      });
    } catch (error) {
      console.error('[DirectMode] Error executing slash command:', error);
      await this.replyToMessage(messageId, '❌ Error processing command');
    }
  }

  /**
   * Handle regular command
   */
  private async handleRegularCommand(openId: string, messageId: string, content: string): Promise<void> {
    // Check if executor is waiting for interactive input
    if ('isWaitingInput' in this.executor && typeof this.executor.isWaitingInput === 'function') {
      const executor = this.executor as { isWaitingInput(): boolean; sendInput(input: string): boolean };
      if (executor.isWaitingInput()) {
        const input = content?.trim();
        if (input) {
          const sent = executor.sendInput(input);
          if (sent) {
            await this.replyToMessage(messageId, `✅ Sent: "${input}"`);
          } else {
            await this.replyToMessage(messageId, '❌ Failed to send input - executor is no longer waiting');
          }
        } else {
          await this.replyToMessage(messageId, '❌ Please provide a non-empty input');
        }
        return;
      }
    }

    // Check if busy
    if (this.isExecuting) {
      await this.replyToMessage(
        messageId,
        'Executor is busy, please wait for current task to complete. Send /abort to cancel the running task.'
      );
      return;
    }

    try {
      this.isExecuting = true;
      this.currentMessageId = messageId;

      // Create streaming session
      const commandMessageId = uuidv4();
      const feishuMessageId = await this.sendStreamingStart(openId, '🤔 Processing...');

      if (feishuMessageId) {
        this.registerStreamingSession(commandMessageId, openId, feishuMessageId);
      }

      // Expand shortcuts
      const expandedContent = this.expandCommandShortcuts(content);
      const processedContent = processFileReadContent(expandedContent);

      // Execute
      const result = await this.executor.execute(processedContent, {
        onStream: (chunk: string) => {
          this.handleTextChunk(commandMessageId, openId, chunk);
        },
        onToolUse: (toolUse: ToolUseInfo) => {
          this.handleToolUse(commandMessageId, openId, toolUse);
        },
        onToolResult: (toolResult: ToolResultInfo) => {
          this.handleToolResult(commandMessageId, openId, toolResult);
        },
        onRedactedThinking: () => {
          this.handleRedactedThinking(commandMessageId, openId);
        },
        onPlanMode: (planContent: string) => {
          this.handlePlanMode(commandMessageId, openId, planContent);
        },
      });

      // Finalize - sessionAbbr only exists on PersistentClaudeResult
      const persistentResult = result as any;
      await this.finalizeStreamingMessage(
        commandMessageId,
        result.success,
        result.output,
        result.error,
        persistentResult.sessionAbbr
      );
    } catch (error) {
      await this.replyToMessage(
        messageId,
        error instanceof Error
          ? error.message
          : 'Execution error'
      );
    } finally {
      this.isExecuting = false;
      this.currentMessageId = null;
    }
  }

  /**
   * Expand command shortcuts
   */
  private expandCommandShortcuts(content: string): string {
    const trimmed = content.trim();
    if (trimmed === '/r' || trimmed === '/resume') {
      return 'Please resume the previous conversation';
    }
    if (trimmed === '/c' || trimmed === '/continue') {
      return 'Please continue from where we left off';
    }
    return content;
  }

  // ===========================================================================
  // Streaming Methods (from RouterServer streaming handling
  // ===========================================================================

  /**
   * Register streaming session
   */
  private registerStreamingSession(messageId: string, openId: string, feishuMessageId: string): void {
    this.streamingSessions.set(messageId, {
      feishuMessageId,
      elements: [],
      currentTextContent: '',
      hasUpdated: false,
      createdAt: Date.now(),
      messageId,
      openId,
    });
  }

  /**
   * Send streaming start card
   */
  private async sendStreamingStart(openId: string, initialText: string = '🤔 Thinking...'): Promise<string | null> {
    try {
      const card = {
        schema: '2.0',
        body: {
          elements: [
            {
              tag: 'markdown',
              content: initialText,
            },
          ],
        },
      };

      return await this.feishuClient.sendCardMessage(openId, card);
    } catch (error) {
      console.error('[DirectMode] Failed to send streaming start:', error);
      return null;
    }
  }

  /**
   * Handle text chunk
   */
  private async handleTextChunk(messageId: string, openId: string, chunk: string): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    streamData.currentTextContent += chunk;
    streamData.createdAt = Date.now();

    const now = Date.now();
    const lastUpdate = this.lastStreamUpdateTime.get(messageId) || 0;
    const timeSinceLastUpdate = now - lastUpdate;
    const contentLength = streamData.currentTextContent.length;

    const shouldUpdate = streamData.feishuMessageId && (
      !streamData.hasUpdated ||
      (contentLength % this.STREAM_UPDATE_MIN_LENGTH === 0) ||
      (timeSinceLastUpdate >= this.STREAM_UPDATE_INTERVAL_MS)
    );

    if (shouldUpdate && streamData.feishuMessageId) {
      const elements = [...streamData.elements];
      if (streamData.currentTextContent.trim()) {
        elements.push(createMarkdownElement(streamData.currentTextContent));
      }

      await this.updateStreamingMessage(
        streamData.feishuMessageId,
        elements,
        openId
      );
      this.lastStreamUpdateTime.set(messageId, now);
      streamData.hasUpdated = true;
    }
  }

  /**
   * Handle tool use
   */
  private async handleToolUse(messageId: string, openId: string, toolUse: ToolUseInfo): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    if (streamData.currentTextContent.trim()) {
      streamData.elements.push(createMarkdownElement(streamData.currentTextContent));
      streamData.currentTextContent = '';
    }

    const toolUseElements = createToolUseElement(toolUse);
    streamData.elements.push(...toolUseElements);
    streamData.createdAt = Date.now();

    if (streamData.feishuMessageId) {
      await this.updateStreamingMessage(
        streamData.feishuMessageId,
        streamData.elements,
        openId
      );
      streamData.hasUpdated = true;
    }
  }

  /**
   * Handle tool result
   */
  private async handleToolResult(messageId: string, openId: string, toolResult: ToolResultInfo): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    if (streamData.currentTextContent.trim()) {
      streamData.elements.push(createMarkdownElement(streamData.currentTextContent));
      streamData.currentTextContent = '';
    }

    const toolResultElements = createToolResultElement(toolResult);
    streamData.elements.push(...toolResultElements);
    streamData.createdAt = Date.now();

    if (streamData.feishuMessageId) {
      await this.updateStreamingMessage(
        streamData.feishuMessageId,
        streamData.elements,
        openId
      );
      streamData.hasUpdated = true;
    }
  }

  /**
   * Handle redacted thinking
   */
  private async handleRedactedThinking(messageId: string, openId: string): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    if (streamData.currentTextContent.trim()) {
      streamData.elements.push(createMarkdownElement(streamData.currentTextContent));
      streamData.currentTextContent = '';
    }

    const redactedThinkingElements = createRedactedThinkingElement();
    streamData.elements.push(...redactedThinkingElements);
    streamData.createdAt = Date.now();

    if (streamData.feishuMessageId) {
      await this.updateStreamingMessage(
        streamData.feishuMessageId,
        streamData.elements,
        openId
      );
      streamData.hasUpdated = true;
    }
  }

  /**
   * Handle plan mode
   */
  private async handlePlanMode(messageId: string, openId: string, planContent: string): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    streamData.currentTextContent = '';

    const planModeElements = createPlanModeElement(planContent);
    streamData.elements.push(...planModeElements);
    streamData.createdAt = Date.now();

    if (streamData.feishuMessageId) {
      await this.updateStreamingMessage(
        streamData.feishuMessageId,
        streamData.elements,
        openId
      );
      streamData.hasUpdated = true;
    }
  }

  /**
   * Finalize streaming message
   */
  private async finalizeStreamingMessage(
    messageId: string,
    success: boolean,
    output?: string,
    error?: string,
    sessionAbbr?: string,
    cwd?: string
  ): Promise<void> {
    const streamData = this.streamingSessions.get(messageId);
    if (!streamData) return;

    const { feishuMessageId, openId } = streamData;

    if (feishuMessageId) {
      if (streamData.currentTextContent.trim()) {
        streamData.elements.push(createMarkdownElement(streamData.currentTextContent));
        streamData.currentTextContent = '';
      }

      if (streamData.elements.length === 0 && output) {
        streamData.elements.push(createMarkdownElement(output));
      }

      // Add final status note
      const noteElements: FeishuCardElement[] = [];

      if (success) {
        if (sessionAbbr) {
          noteElements.push(createDividerElement());
          noteElements.push(createMarkdownElement(`💾 Session: ${sessionAbbr}`));
        }
        if (cwd) {
          const formattedCwd = cwd.startsWith(process.env.HOME || '/Users')
            ? `~${cwd.slice((process.env.HOME || '/Users').length)}`
            : cwd;
          noteElements.push(createMarkdownElement(`📂 Working Directory: ${formattedCwd}`));
        }
      } else {
        const errorMsg = error || 'Command failed';
        noteElements.push(createMarkdownElement(`\n\n❌ Error: ${errorMsg}`));
      }

      const finalElements = [...streamData.elements, ...noteElements];

      await this._updateStreamingMessage(feishuMessageId, finalElements, openId);

      this.messageChains.delete(feishuMessageId);
      this.lastProcessedLengths.delete(feishuMessageId);
    }

    this.streamingSessions.delete(messageId);
    this.lastStreamUpdateTime.delete(messageId);
  }

  // ===========================================================================
  // Card update methods (from FeishuLongConnHandler)
  // ===========================================================================

  /**
   * Serialize async operations per messageId
   */
  private async withMessageLock<T>(messageId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.messageLocks.get(messageId) || Promise.resolve();
    const current = previous.then(fn, fn);
    this.messageLocks.set(messageId, current);
    try {
      return await current;
    } finally {
      if (this.messageLocks.get(messageId) === current) {
        this.messageLocks.delete(messageId);
      }
    }
  }

  /**
   * Update streaming message
   */
  private async updateStreamingMessage(
    messageId: string,
    elements: any[],
    openId?: string
  ): Promise<boolean> {
    return this.withMessageLock(messageId, () => this._updateStreamingMessage(messageId, elements, openId));
  }

  private async _updateStreamingMessage(
    messageId: string,
    elements: any[],
    openId?: string
  ): Promise<boolean> {
    try {
      const chunks = this.splitElementsIntoChunks(elements);

      let chain = this.messageChains.get(messageId);
      if (!chain) {
        chain = [messageId];
        this.messageChains.set(messageId, chain);
      }

      await this.feishuClient.patchCardMessage(chain[0], {
        schema: '2.0',
        body: { elements: chunks[0] },
      });

      if (chunks.length > 1 && openId) {
        const existingContinuationCards = chain.slice(1);
        const neededContinuationCards = chunks.length - 1;

        for (let i = existingContinuationCards.length; i < neededContinuationCards; i++) {
          const newMessageId = await this.createContinuationCard(openId, chunks[i + 1]);
          if (newMessageId) {
            chain.push(newMessageId);
          }
        }

        for (let i = 0; i < existingContinuationCards.length && i < neededContinuationCards; i++) {
          await this.feishuClient.patchCardMessage(existingContinuationCards[i], {
            schema: '2.0',
            body: { elements: chunks[i + 1] },
          });
        }
      }

      return true;
    } catch (error: any) {
      console.error('[DirectMode] Failed to update streaming message:', error?.message || error);
      return false;
    }
  }

  /**
   * Create continuation card
   */
  private async createContinuationCard(openId: string, elements: any[]): Promise<string | null> {
    try {
      const card = {
        schema: '2.0',
        body: { elements },
      };
      return await this.feishuClient.sendCardMessage(openId, card);
    } catch (error) {
      console.error('[DirectMode] Failed to create continuation card:', error);
      return null;
    }
  }

  /**
   * Split elements into chunks
   */
  private splitElementsIntoChunks(elements: any[]): any[][] {
    if (elements.length === 0) return [elements];

    const needsSplitting = this.checkIfElementsNeedSplitting(elements);

    if (!needsSplitting) {
      return [elements];
    }

    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentChunkSize = 0;
    let currentChunkTaggedNodes = 0;

    const continuationIndicatorSize = 200;
    const continuationIndicatorCount = 2;

    for (const element of elements) {
      const elementSize = JSON.stringify(element).length;
      const elementTaggedNodes = this.countTaggedNodes(element);

      const wouldExceedElementLimit =
        currentChunkTaggedNodes + elementTaggedNodes > (this.CARD_ELEMENT_LIMIT - continuationIndicatorCount);
      const wouldExceedSizeLimit =
        currentChunkSize + elementSize + continuationIndicatorSize >
        (this.CARD_DATA_SIZE_LIMIT - this.CARD_SIZE_BUFFER);

      if (currentChunk.length > 0 && (wouldExceedElementLimit || wouldExceedSizeLimit)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkSize = 0;
        currentChunkTaggedNodes = 0;
      }

      currentChunk.push(element);
      currentChunkSize += elementSize;
      currentChunkTaggedNodes += elementTaggedNodes;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length; i++) {
        const isFirst = i === 0;
        const isLast = i === chunks.length - 1;

        if (!isLast) {
          chunks[i].push({
            tag: 'markdown',
            content: '\n\n_➡️ Continued in next message..._',
          });
        }

        if (!isFirst) {
          chunks[i].unshift({
            tag: 'markdown',
            content: '_⬅️ Continued from previous message..._\n\n',
          });
        }
      }
    }

    return chunks;
  }

  /**
   * Count tagged nodes
   */
  private countTaggedNodes(obj: any): number {
    if (!obj || typeof obj !== 'object') return 0;

    let count = 0;
    if (obj.tag) count = 1;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            count += this.countTaggedNodes(item);
          }
        } else if (typeof value === 'object' && value !== null) {
          count += this.countTaggedNodes(value);
        }
      }
    }

    return count;
  }

  /**
   * Check if elements need splitting
   */
  private checkIfElementsNeedSplitting(elements: any[]): boolean {
    if (!Array.isArray(elements)) return false;

    const totalTaggedNodes = elements.reduce((sum, el) => sum + this.countTaggedNodes(el), 0);

    if (totalTaggedNodes > this.CARD_ELEMENT_LIMIT) return true;

    const cardData = { schema: '2.0', body: { elements } };
    const jsonSize = JSON.stringify(cardData).length;
    const sizeLimit = this.CARD_DATA_SIZE_LIMIT - this.CARD_SIZE_BUFFER;

    return jsonSize > sizeLimit;
  }

  /**
   * Reply to message
   */
  private async replyToMessage(messageId: string, text: string): Promise<void> {
    await this.feishuClient.replyToMessage(messageId, text);
  }
}
