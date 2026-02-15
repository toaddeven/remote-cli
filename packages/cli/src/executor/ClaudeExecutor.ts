import { spawn, ChildProcess } from 'child_process';
import { DirectoryGuard } from '../security/DirectoryGuard';
import readline from 'readline';

/**
 * Claude execution options
 */
export interface ClaudeExecuteOptions {
  /** Stream output callback */
  onStream?: (chunk: string) => void;
  /** Execution timeout (milliseconds), default 300000 (5 minutes) */
  timeout?: number;
}

/**
 * Claude execution result
 */
export interface ClaudeExecuteResult {
  /** Whether execution was successful */
  success: boolean;
  /** Output content */
  output?: string;
  /** Error message */
  error?: string;
}

/**
 * Claude Executor
 * Manages a persistent Claude Code CLI process for session continuity
 */
export class ClaudeExecutor {
  private directoryGuard: DirectoryGuard;
  private currentWorkingDirectory: string;
  private isExecuting = false;
  private isDestroyed = false;
  private defaultTimeout = 300000; // 5 minutes

  // Persistent Claude Code process
  private claudeProcess: ChildProcess | null = null;
  private commandQueue: Array<{
    prompt: string;
    resolve: (result: ClaudeExecuteResult) => void;
    reject: (error: Error) => void;
    onStream?: (chunk: string) => void;
    timeout: number;
    startTime: number;
  }> = [];
  private currentCommand: typeof this.commandQueue[0] | null = null;
  private outputBuffer: string[] = [];
  private processReady = false;
  private readyCallbacks: Array<() => void> = [];

  constructor(directoryGuard: DirectoryGuard) {
    this.directoryGuard = directoryGuard;
    this.currentWorkingDirectory = process.cwd();
  }

  /**
   * Get current working directory
   */
  getCurrentWorkingDirectory(): string {
    return this.currentWorkingDirectory;
  }

  /**
   * Set working directory
   * @param targetPath Target path
   * @throws If path is not safe
   */
  setWorkingDirectory(targetPath: string): void {
    const resolvedPath = this.directoryGuard.resolveWorkingDirectory(
      targetPath,
      this.currentWorkingDirectory
    );
    this.currentWorkingDirectory = resolvedPath;
  }

  /**
   * Initialize the persistent Claude Code process
   */
  private async initializeProcess(): Promise<void> {
    if (this.claudeProcess && !this.claudeProcess.killed) {
      return;
    }

    return new Promise((resolve, reject) => {
      console.log('[Claude] Starting persistent Claude Code process...');
      console.log(`[Claude] Working directory: ${this.currentWorkingDirectory}`);

      // Start Claude Code in interactive mode (without --print)
      const child = spawn('claude', [], {
        cwd: this.currentWorkingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Force non-interactive mode for automation but keep session alive
          CI: 'true',
          FORCE_COLOR: '0',
          TERM: 'dumb',
        },
      });

      this.claudeProcess = child;

      console.log(`[Claude] Process started with PID: ${child.pid}`);

      // Handle stdout
      const stdoutReader = readline.createInterface({
        input: child.stdout!,
        crlfDelay: Infinity,
      });

      stdoutReader.on('line', (line) => {
        console.log('[Claude stdout]', line);
        this.handleOutput(line);
      });

      // Handle stderr
      const stderrReader = readline.createInterface({
        input: child.stderr!,
        crlfDelay: Infinity,
      });

      stderrReader.on('line', (line) => {
        console.error('[Claude stderr]', line);
        this.handleOutput(line);
      });

      // Handle process exit
      child.on('close', (code) => {
        console.log(`[Claude] Process exited with code: ${code}`);
        this.claudeProcess = null;
        this.processReady = false;

        // Reject current command if any
        if (this.currentCommand) {
          this.currentCommand.reject(new Error(`Claude process exited with code ${code}`));
          this.currentCommand = null;
        }

        // Reject queued commands
        while (this.commandQueue.length > 0) {
          const cmd = this.commandQueue.shift()!;
          cmd.reject(new Error('Claude process exited'));
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        console.error('[Claude] Process error:', error);
        if (error.message.includes('ENOENT')) {
          reject(new Error(
            'Claude Code CLI not found. Please ensure Claude Code is installed and available in PATH.\n' +
            'Installation: https://docs.anthropic.com/en/docs/claude-code/installation'
          ));
        } else {
          reject(error);
        }
      });

      // Wait a bit for process to initialize
      setTimeout(() => {
        this.processReady = true;
        console.log('[Claude] Process ready');
        resolve();
      }, 2000);
    });
  }

  /**
   * Handle output from Claude process
   */
  private handleOutput(line: string): void {
    if (!this.currentCommand) {
      return;
    }

    // Buffer the output
    this.outputBuffer.push(line);

    // Stream to callback
    if (this.currentCommand.onStream) {
      this.currentCommand.onStream(line + '\n');
    }

    // Check for prompt indicator that command is complete
    // Claude typically shows a prompt like ">" or "claude>" when ready for next command
    if (this.isPromptLine(line)) {
      this.finishCurrentCommand();
    }
  }

  /**
   * Check if line is a prompt indicator
   */
  private isPromptLine(line: string): boolean {
    // Common prompt patterns in Claude Code
    const promptPatterns = [
      /^\s*[›>]\s*$/,  // › or > prompt
      /^\s*claude\s*[›>]\s*/i,  // claude> or claude ›
      /^\s*\$\s*/,  // $ shell prompt
      /^\s*>>>\s*/,  // Python-style prompt
    ];

    return promptPatterns.some(pattern => pattern.test(line));
  }

  /**
   * Finish current command and resolve
   */
  private finishCurrentCommand(): void {
    if (!this.currentCommand) {
      return;
    }

    const output = this.outputBuffer.join('\n').trim();
    this.outputBuffer = [];

    console.log('[Claude] Command completed');

    this.currentCommand.resolve({
      success: true,
      output,
    });

    this.currentCommand = null;
    this.isExecuting = false;

    // Process next command in queue
    this.processNextCommand();
  }

  /**
   * Process next command in queue
   */
  private async processNextCommand(): Promise<void> {
    if (this.currentCommand || this.commandQueue.length === 0) {
      return;
    }

    // Ensure process is running
    if (!this.claudeProcess || this.claudeProcess.killed) {
      try {
        await this.initializeProcess();
      } catch (error) {
        // Reject all queued commands
        while (this.commandQueue.length > 0) {
          const cmd = this.commandQueue.shift()!;
          cmd.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
    }

    this.currentCommand = this.commandQueue.shift()!;
    this.isExecuting = true;
    this.outputBuffer = [];

    const { prompt, timeout } = this.currentCommand;

    console.log(`[Claude] Executing: ${prompt.substring(0, 100)}...`);

    // Send command to Claude process
    this.claudeProcess!.stdin!.write(prompt + '\n');

    // Set timeout
    setTimeout(() => {
      if (this.currentCommand && this.currentCommand.startTime === this.currentCommand.startTime) {
        console.error('[Claude] Command timeout');
        this.currentCommand.reject(new Error('Execution timeout exceeded'));
        this.currentCommand = null;
        this.isExecuting = false;
        this.outputBuffer = [];

        // Try to cancel current operation by sending Ctrl+C
        this.claudeProcess!.stdin!.write('\x03');

        // Process next command
        this.processNextCommand();
      }
    }, timeout);
  }

  /**
   * Execute Claude command
   * @param prompt Command prompt
   * @param options Execution options
   * @returns Execution result
   */
  async execute(
    prompt: string,
    options: ClaudeExecuteOptions = {}
  ): Promise<ClaudeExecuteResult> {
    if (this.isDestroyed) {
      return {
        success: false,
        error: 'Executor has been destroyed',
      };
    }

    const timeout = options.timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      this.commandQueue.push({
        prompt,
        resolve,
        reject,
        onStream: options.onStream,
        timeout,
        startTime: Date.now(),
      });

      // Try to process immediately if not busy
      if (!this.isExecuting) {
        this.processNextCommand();
      }
    });
  }

  /**
   * Format error message
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return `Execution timeout exceeded. The task took too long to complete.`;
      }
      if (error.message.includes('ENOENT')) {
        return `Claude Code CLI not found. Please ensure it's installed and available in PATH.`;
      }
      if (error.message.includes('EACCES') || error.message.includes('Permission denied')) {
        return `Permission denied. You may not have access to this resource.`;
      }
      return `Execution error: ${error.message}`;
    }
    return 'Unknown execution error';
  }

  /**
   * Reset execution context
   */
  resetContext(): void {
    // Kill and restart the process to reset context
    if (this.claudeProcess && !this.claudeProcess.killed) {
      this.claudeProcess.kill('SIGTERM');
      this.claudeProcess = null;
    }
    this.processReady = false;
    this.currentCommand = null;
    this.commandQueue = [];
    this.outputBuffer = [];
    this.isExecuting = false;
  }

  /**
   * Destroy executor
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isExecuting = false;

    if (this.claudeProcess && !this.claudeProcess.killed) {
      this.claudeProcess.kill('SIGTERM');
      this.claudeProcess = null;
    }

    // Reject all queued commands
    while (this.commandQueue.length > 0) {
      const cmd = this.commandQueue.shift()!;
      cmd.reject(new Error('Executor has been destroyed'));
    }
  }
}
