import { ClaudeExecutor } from '../executor/ClaudeExecutor';
import { WebSocketClient } from './WebSocketClient';
import { DirectoryGuard } from '../security/DirectoryGuard';
import { IncomingMessage, OutgoingMessage } from '../types';

/**
 * Legacy message type for backward compatibility
 */
export interface Message {
  type: string;
  messageId?: string;
  content?: string;
  timestamp?: number;
}

/**
 * Message Handler
 * Responsible for handling messages from WebSocket and invoking Claude executor
 */
export class MessageHandler {
  private wsClient: WebSocketClient;
  private executor: ClaudeExecutor;
  private directoryGuard: DirectoryGuard;
  private isDestroyed = false;
  private isExecuting = false;

  constructor(
    wsClient: WebSocketClient,
    executor: ClaudeExecutor,
    directoryGuard: DirectoryGuard
  ) {
    this.wsClient = wsClient;
    this.executor = executor;
    this.directoryGuard = directoryGuard;
  }

  /**
   * Handle message (supports new IncomingMessage format)
   * @param message Message object
   */
  async handleMessage(message: Message | IncomingMessage): Promise<void> {
    // Check if already destroyed
    if (this.isDestroyed) {
      return;
    }

    // Validate message structure
    if (!this.isValidMessage(message)) {
      this.sendResponse(message.messageId || 'unknown', {
        success: false,
        error: 'Invalid message format',
      });
      return;
    }

    // Handle different types of messages
    switch (message.type) {
      case 'status':
        await this.handleStatusQuery(message.messageId!);
        return;

      case 'command':
        await this.handleCommandMessage(message as IncomingMessage);
        return;

      default:
        this.sendResponse(message.messageId!, {
          success: false,
          error: `Unknown message type: ${message.type}`,
        });
    }
  }

  /**
   * Handle command message
   */
  private async handleCommandMessage(message: IncomingMessage): Promise<void> {
    const { messageId, content, workingDirectory } = message;

    // Check if there is a task currently executing
    if (this.isExecuting) {
      this.sendResponse(messageId, {
        success: false,
        error: 'Executor is busy, please wait for current task to complete',
      });
      return;
    }

    // If working directory is provided, validate and set it
    if (workingDirectory) {
      // Verify directory is in the whitelist
      if (!this.directoryGuard.isSafePath(workingDirectory)) {
        this.sendResponse(messageId, {
          success: false,
          error: `Directory not in whitelist: ${workingDirectory}\n\nAllowed directories:\n${this.directoryGuard
            .getAllowedDirectories()
            .map((d) => `• ${d}`)
            .join('\n')}`,
        });
        return;
      }

      // Set working directory
      this.executor.setWorkingDirectory(workingDirectory);
    }

    try {
      this.isExecuting = true;

      // Handle built-in commands
      const builtInResult = await this.handleBuiltInCommand(messageId, content!);
      if (builtInResult) {
        return;
      }

      // Expand command shortcuts
      const expandedContent = this.expandCommandShortcuts(content!);

      // Execute Claude command
      await this.executeCommand(messageId, expandedContent);
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Handle status query
   */
  private async handleStatusQuery(messageId: string): Promise<void> {
    this.wsClient.send({
      type: 'status',
      messageId,
      status: {
        connected: this.wsClient.isConnected(),
        allowedDirectories: this.directoryGuard.getAllowedDirectories(),
        currentWorkingDirectory: this.executor.getCurrentWorkingDirectory(),
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Validate message structure
   */
  private isValidMessage(message: Message): boolean {
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (message.type !== 'command') {
      return true; // Non-command messages don't need further validation
    }

    return Boolean(message.messageId && message.content);
  }

  /**
   * Handle built-in commands
   * @returns Returns true if built-in command was handled, otherwise false
   */
  private async handleBuiltInCommand(
    messageId: string,
    content: string
  ): Promise<boolean> {
    const trimmed = content.trim();

    // /status command
    if (trimmed === '/status') {
      const cwd = this.executor.getCurrentWorkingDirectory();
      const allowedDirs = this.directoryGuard.getAllowedDirectories();

      this.sendResponse(messageId, {
        success: true,
        output: `📊 Status:
- Working Directory: ${cwd}
- Allowed Directories: ${allowedDirs.join(', ')}
- Connection: Active`,
      });
      return true;
    }

    // /help command
    if (trimmed === '/help') {
      this.sendResponse(messageId, {
        success: true,
        output: `📖 Available commands:
- /help - Show this help message
- /status - Show current status
- /clear - Clear conversation context
- /cd <directory> - Change working directory
- /r or /resume - Resume previous conversation
- /c or /continue - Continue previous conversation

You can also use natural language commands to control Claude Code CLI.`,
      });
      return true;
    }

    // /clear command
    if (trimmed === '/clear') {
      this.executor.resetContext();
      this.sendResponse(messageId, {
        success: true,
        output: '✅ Conversation context cleared',
      });
      return true;
    }

    // /cd command
    if (trimmed.startsWith('/cd')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) {
        this.sendResponse(messageId, {
          success: false,
          error: 'Usage: /cd <directory>',
        });
        return true;
      }

      const targetDir = parts.slice(1).join(' ');
      try {
        this.executor.setWorkingDirectory(targetDir);
        const newCwd = this.executor.getCurrentWorkingDirectory();
        this.sendResponse(messageId, {
          success: true,
          output: `✅ Changed working directory to: ${newCwd}`,
        });
      } catch (error) {
        this.sendResponse(messageId, {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to change directory',
        });
      }
      return true;
    }

    return false;
  }

  /**
   * Expand command shortcuts
   */
  private expandCommandShortcuts(content: string): string {
    const trimmed = content.trim();

    // Only expand when command is the entire content
    if (trimmed === '/r' || trimmed === '/resume') {
      return 'Please resume the previous conversation';
    }

    if (trimmed === '/c' || trimmed === '/continue') {
      return 'Please continue from where we left off';
    }

    return content;
  }

  /**
   * Execute Claude command
   */
  private async executeCommand(
    messageId: string,
    content: string
  ): Promise<void> {
    try {
      const result = await this.executor.execute(content, {
        onStream: (chunk: string) => {
          this.sendStreamChunk(messageId, chunk);
        },
      });

      this.sendResponse(messageId, result);
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Execution error',
      });
    }
  }

  /**
   * Send streaming output chunk
   */
  private sendStreamChunk(messageId: string, chunk: string): void {
    try {
      this.wsClient.send({
        type: 'stream',
        messageId,
        chunk,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Ignore send errors, don't affect main flow
      console.error('Failed to send stream chunk:', error);
    }
  }

  /**
   * Send response
   */
  private sendResponse(
    messageId: string,
    result: { success: boolean; output?: string; error?: string }
  ): void {
    try {
      this.wsClient.send({
        type: 'result',
        messageId,
        success: result.success,
        output: result.output,
        error: result.error,
        cwd: this.executor.getCurrentWorkingDirectory(),
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to send response:', error);
    }
  }

  /**
   * Destroy handler
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isExecuting = false;
  }
}
