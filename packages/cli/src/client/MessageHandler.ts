import { WebSocketClient } from './WebSocketClient';
import { DirectoryGuard } from '../security/DirectoryGuard';
import { IncomingMessage, OutgoingMessage, StructuredContent, ToolUseInfo, ToolResultInfo } from '../types';
import type { ClaudeExecutor, ClaudePersistentExecutor } from '../executor';
import { FeishuNotificationAdapter } from '../hooks';
import { spawn } from 'child_process';

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
  private executor: ClaudeExecutor | ClaudePersistentExecutor;
  private directoryGuard: DirectoryGuard;
  private isDestroyed = false;
  private isExecuting = false;
  private currentOpenId?: string;
  private notificationAdapter: FeishuNotificationAdapter;

  constructor(
    wsClient: WebSocketClient,
    executor: ClaudeExecutor | ClaudePersistentExecutor,
    directoryGuard: DirectoryGuard
  ) {
    this.wsClient = wsClient;
    this.executor = executor;
    this.directoryGuard = directoryGuard;

    // Initialize Feishu notification adapter
    this.notificationAdapter = new FeishuNotificationAdapter(wsClient);
    this.notificationAdapter.register();
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
    if (!message || !this.isValidMessage(message)) {
      this.sendResponse(message?.messageId || 'unknown', {
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

      case 'heartbeat':
        // Silently ignore heartbeat responses from server
        return;

      case 'binding_confirm':
        // Silently ignore binding confirmation from server
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
    const { messageId, content, workingDirectory, openId, isSlashCommand } = message;

    // Store openId for response routing and notifications
    this.currentOpenId = openId;
    this.notificationAdapter.setCurrentOpenId(openId);

    // Handle /abort command first, even when busy
    if (content?.trim() === '/abort') {
      await this.handleAbortCommand(messageId);
      return;
    }

    // Check if executor is waiting for interactive input
    if ('isWaitingInput' in this.executor && typeof this.executor.isWaitingInput === 'function') {
      const executor = this.executor as { isWaitingInput(): boolean; sendInput(input: string): boolean };
      if (executor.isWaitingInput()) {
        const input = content?.trim();
        if (input) {
          const sent = executor.sendInput(input);
          if (sent) {
            this.sendResponse(messageId, {
              success: true,
              output: `✅ Sent: "${input}"`,
            });
          } else {
            this.sendResponse(messageId, {
              success: false,
              error: '❌ Failed to send input - executor is no longer waiting',
            });
          }
        } else {
          this.sendResponse(messageId, {
            success: false,
            error: '❌ Please provide a non-empty input',
          });
        }
        return;
      }
    }

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

      // Set working directory (now async for worktree support)
      await this.executor.setWorkingDirectory(workingDirectory);
    }

    try {
      this.isExecuting = true;

      // Handle built-in commands (except /abort which was handled above)
      const builtInResult = await this.handleBuiltInCommand(messageId, content!);
      if (builtInResult) {
        return;
      }

      // Check if this is a passthrough slash command from server
      if (isSlashCommand) {
        console.log(`[MessageHandler] Executing passthrough slash command: ${content}`);
        await this.executeSlashCommand(messageId, content!);
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
   * Handle abort command
   * Can be executed even when executor is busy
   */
  private async handleAbortCommand(messageId: string): Promise<void> {
    const wasExecuting = this.isExecuting;
    const aborted = await this.executor.abort();

    if (aborted) {
      this.isExecuting = false;
      this.sendResponse(messageId, {
        success: true,
        output: wasExecuting
          ? '✅ Current command has been aborted'
          : '⚠️ No command was executing, but executor has been reset',
      });
    } else {
      this.sendResponse(messageId, {
        success: true,
        output: 'ℹ️ No command is currently executing',
      });
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
- /abort - Abort the currently executing command
- /clear - Clear conversation context
- /cd <directory> - Change working directory
- /r or /resume - Resume previous conversation
- /c or /continue - Continue previous conversation
- /review - Review changes (supports remote interaction)

🌳 Worktree commands:
- /worktree list - List all worktrees
- /worktree cleanup [days] - Remove stale worktrees (default: 7 days)
- /worktree remove <session-id> - Remove specific worktree
- /main or /reset - Return to main working directory

💡 Interactive commands like /review will prompt you for input via Feishu when needed.

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
        await this.executor.setWorkingDirectory(targetDir);
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

    // /worktree list command
    if (trimmed === '/worktree list') {
      return await this.handleWorktreeList(messageId);
    }

    // /worktree cleanup command
    if (trimmed.startsWith('/worktree cleanup')) {
      const parts = trimmed.split(/\s+/);
      const days = parts[2] ? parseInt(parts[2]) : 7;
      return await this.handleWorktreeCleanup(messageId, days);
    }

    // /worktree remove command
    if (trimmed.startsWith('/worktree remove')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) {
        this.sendResponse(messageId, {
          success: false,
          error: 'Usage: /worktree remove <session-id>',
        });
        return true;
      }
      const sessionId = parts[2];
      return await this.handleWorktreeRemove(messageId, sessionId);
    }

    // /main or /reset command - return to main working directory
    if (trimmed === '/main' || trimmed === '/reset') {
      return await this.handleReturnToMain(messageId);
    }

    return false;
  }

  /**
   * Handle /worktree list command
   */
  private async handleWorktreeList(messageId: string): Promise<boolean> {
    try {
      const cwd = this.executor.getCurrentWorkingDirectory();
      const worktreeManager = this.executor.getWorktreeManager();

      // Get main repo path (remove worktree suffix if present)
      const mainRepoPath = cwd.replace(/\.worktrees[/\\]session-[a-f0-9]{8}$/, '');

      const worktrees = await worktreeManager.listWorktrees(mainRepoPath);

      if (worktrees.length === 0) {
        this.sendResponse(messageId, {
          success: true,
          output: '📂 No worktrees found',
        });
        return true;
      }

      let output = `📂 Worktrees (${worktrees.length}):\n\n`;
      for (const wt of worktrees) {
        if (wt.isMain) {
          output += `• [MAIN] ${wt.branch}\n`;
          output += `  Path: ${wt.path}\n`;
          output += `  Commit: ${wt.commit.slice(0, 7)}\n\n`;
        } else if (wt.sessionId) {
          output += `• Session: ${wt.sessionId}\n`;
          output += `  Branch: ${wt.branch}\n`;
          output += `  Path: ${wt.path}\n`;
          output += `  Commit: ${wt.commit.slice(0, 7)}\n\n`;
        }
      }

      this.sendResponse(messageId, { success: true, output });
      return true;
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list worktrees',
      });
      return true;
    }
  }

  /**
   * Handle /worktree cleanup command
   */
  private async handleWorktreeCleanup(messageId: string, days: number): Promise<boolean> {
    try {
      const cwd = this.executor.getCurrentWorkingDirectory();
      const worktreeManager = this.executor.getWorktreeManager();

      // Get main repo path
      const mainRepoPath = cwd.replace(/\.worktrees[/\\]session-[a-f0-9]{8}$/, '');

      const count = await worktreeManager.pruneStaleWorktrees(mainRepoPath, days);

      this.sendResponse(messageId, {
        success: true,
        output: `🗑️ Cleaned up ${count} stale worktree(s) older than ${days} days`,
      });
      return true;
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cleanup worktrees',
      });
      return true;
    }
  }

  /**
   * Handle /worktree remove command
   */
  private async handleWorktreeRemove(messageId: string, sessionId: string): Promise<boolean> {
    try {
      const cwd = this.executor.getCurrentWorkingDirectory();
      const worktreeManager = this.executor.getWorktreeManager();

      // Get main repo path
      const mainRepoPath = cwd.replace(/\.worktrees[/\\]session-[a-f0-9]{8}$/, '');

      const worktreePath = worktreeManager.getWorktreePath(mainRepoPath, sessionId);

      if (!worktreePath) {
        this.sendResponse(messageId, {
          success: false,
          error: `Worktree not found for session: ${sessionId}`,
        });
        return true;
      }

      await worktreeManager.removeWorktree(worktreePath, mainRepoPath);

      this.sendResponse(messageId, {
        success: true,
        output: `✅ Removed worktree for session ${sessionId}`,
      });
      return true;
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove worktree',
      });
      return true;
    }
  }

  /**
   * Handle /main or /reset command - return to main working directory
   */
  private async handleReturnToMain(messageId: string): Promise<boolean> {
    try {
      const cwd = this.executor.getCurrentWorkingDirectory();

      // Check if currently in a worktree
      const match = cwd.match(/^(.+)\.worktrees[/\\]session-[a-f0-9]{8}$/);
      if (!match) {
        this.sendResponse(messageId, {
          success: true,
          output: '✅ Already in main working directory',
        });
        return true;
      }

      const mainRepoPath = match[1];

      // Stop current session
      this.executor.resetContext();

      // Switch to main repo
      await this.executor.setWorkingDirectory(mainRepoPath);

      this.sendResponse(messageId, {
        success: true,
        output: `✅ Switched to main working directory: ${mainRepoPath}`,
      });
      return true;
    } catch (error) {
      this.sendResponse(messageId, {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to return to main directory',
      });
      return true;
    }
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
   * Execute passthrough slash command using local Claude CLI
   * This allows users to use their custom slash commands
   */
  private async executeSlashCommand(messageId: string, command: string): Promise<void> {
    return new Promise((resolve) => {
      const chunks: string[] = [];
      const errorChunks: string[] = [];

      console.log(`[MessageHandler] Spawning Claude CLI for command: ${command}`);

      // Spawn Claude CLI with the slash command
      // Use --print to get output and exit
      const child = spawn('claude', [command, '--print'], {
        cwd: this.executor.getCurrentWorkingDirectory(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDECODE: '', // Prevent nested session error
        },
      });

      // Handle stdout (stream chunks)
      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        chunks.push(chunk);
        this.sendStreamChunk(messageId, chunk);
      });

      // Handle stderr
      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        errorChunks.push(chunk);
        console.error(`[MessageHandler] Claude stderr: ${chunk}`);
      });

      // Handle process exit
      child.on('exit', (code) => {
        console.log(`[MessageHandler] Claude process exited with code: ${code}`);

        if (code === 0) {
          const output = chunks.join('');
          this.sendResponse(messageId, {
            success: true,
            output: output.trim() || '✅ Command executed successfully',
          });
        } else {
          const errorOutput = errorChunks.join('') || chunks.join('');
          this.sendResponse(messageId, {
            success: false,
            error: errorOutput.trim() || `Command failed with exit code ${code}`,
          });
        }
        resolve();
      });

      // Handle process error
      child.on('error', (error) => {
        console.error(`[MessageHandler] Failed to spawn Claude:`, error);
        this.sendResponse(messageId, {
          success: false,
          error: `Failed to execute command: ${error.message}`,
        });
        resolve();
      });
    });
  }

  /**
   * Execute Claude command
   */
  private async executeCommand(
    messageId: string,
    content: string
  ): Promise<void> {
    try {
      // Ensure current session has a corresponding worktree (if using ClaudePersistentExecutor)
      if ('ensureWorktree' in this.executor && typeof this.executor.ensureWorktree === 'function') {
        const noticeMessage = await this.executor.ensureWorktree();

        // If there's a notice message (e.g., not in a git repo), send it to user
        if (noticeMessage) {
          this.sendResponse(messageId, {
            success: true,
            output: noticeMessage,
          });
          // Don't return - continue executing the command
        }
      }

      const result = await this.executor.execute(content, {
        onStream: (chunk: string) => {
          this.sendStreamChunk(messageId, chunk);
        },
        onToolUse: (toolUse: ToolUseInfo) => {
          this.sendToolUse(messageId, toolUse);
        },
        onToolResult: (toolResult: ToolResultInfo) => {
          this.sendToolResult(messageId, toolResult);
        },
      });

      // Only send success status, not the output
      // Output has already been streamed via onStream callback
      this.sendResponse(messageId, {
        success: result.success,
        error: result.error,
      });
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
        streamType: 'text',
        openId: this.currentOpenId,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Ignore send errors, don't affect main flow
      console.error('Failed to send stream chunk:', error);
    }
  }

  /**
   * Send tool use event
   */
  private sendToolUse(messageId: string, toolUse: ToolUseInfo): void {
    try {
      this.wsClient.send({
        type: 'stream',
        messageId,
        streamType: 'tool_use',
        toolUse,
        openId: this.currentOpenId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to send tool use:', error);
    }
  }

  /**
   * Send tool result event
   */
  private sendToolResult(messageId: string, toolResult: ToolResultInfo): void {
    try {
      this.wsClient.send({
        type: 'stream',
        messageId,
        streamType: 'tool_result',
        toolResult,
        openId: this.currentOpenId,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to send tool result:', error);
    }
  }

  /**
   * Send structured content for rich formatting
   */
  private sendStructuredContent(messageId: string, structuredContent: StructuredContent): void {
    try {
      this.wsClient.send({
        type: 'structured',
        messageId,
        structuredContent,
        openId: this.currentOpenId,
        timestamp: Date.now(),
        cwd: this.executor.getCurrentWorkingDirectory(),
      } as OutgoingMessage);
    } catch (error) {
      console.error('Failed to send structured content:', error);
    }
  }

  /**
   * Send response
   */
  private sendResponse(
    messageId: string,
    result: { success: boolean; output?: string; error?: string; sessionAbbr?: string }
  ): void {
    try {
      this.wsClient.send({
        type: 'response',
        messageId,
        success: result.success,
        output: result.output,
        error: result.error,
        sessionAbbr: result.sessionAbbr,
        openId: this.currentOpenId,
        timestamp: Date.now(),
        cwd: this.executor.getCurrentWorkingDirectory(),
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
    this.notificationAdapter.unregister();
  }
}
