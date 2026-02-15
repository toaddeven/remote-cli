import { spawn } from 'child_process';
import { DirectoryGuard } from '../security/DirectoryGuard';

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
 * Responsible for invoking local Claude Code CLI to execute commands
 */
export class ClaudeExecutor {
  private directoryGuard: DirectoryGuard;
  private currentWorkingDirectory: string;
  private isExecuting = false;
  private isDestroyed = false;
  private defaultTimeout = 300000; // 5 minutes

  constructor(directoryGuard: DirectoryGuard) {
    this.directoryGuard = directoryGuard;
    // Default working directory is current directory
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
   * Execute Claude command
   * @param prompt Command prompt
   * @param options Execution options
   * @returns Execution result
   */
  async execute(
    prompt: string,
    options: ClaudeExecuteOptions = {}
  ): Promise<ClaudeExecuteResult> {
    // Check if already destroyed
    if (this.isDestroyed) {
      return {
        success: false,
        error: 'Executor has been destroyed',
      };
    }

    // Check if there is a task currently executing
    if (this.isExecuting) {
      return {
        success: false,
        error: 'Executor is busy, please wait for current task to complete',
      };
    }

    this.isExecuting = true;

    try {
      const timeout = options.timeout || this.defaultTimeout;

      const result = await this.executeWithClaudeCLI(prompt, options, timeout);
      return result;
    } catch (error) {
      return {
        success: false,
        error: this.formatError(error),
      };
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute using local Claude Code CLI
   */
  private async executeWithClaudeCLI(
    prompt: string,
    options: ClaudeExecuteOptions,
    timeout: number
  ): Promise<ClaudeExecuteResult> {
    return new Promise((resolve, reject) => {
      const outputChunks: string[] = [];
      let timeoutTimer: NodeJS.Timeout;

      // Build claude command arguments
      // Use --print to get output without interactive mode
      const args = ['--print', prompt];

      console.log(`[Claude] Starting: claude ${args.join(' ')}`);
      console.log(`[Claude] Working directory: ${this.currentWorkingDirectory}`);

      const child = spawn('claude', args, {
        cwd: this.currentWorkingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CI: 'true',
          FORCE_COLOR: '0',
        },
      });

      console.log(`[Claude] Process started with PID: ${child.pid}`);

      // Handle stdout
      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        console.log('[Claude stdout]', chunk);
        outputChunks.push(chunk);
        if (options.onStream) {
          options.onStream(chunk);
        }
      });

      // Handle stderr
      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        console.error('[Claude stderr]', chunk);
        outputChunks.push(chunk);
        if (options.onStream) {
          options.onStream(chunk);
        }
      });

      // Handle timeout
      timeoutTimer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Execution timeout exceeded'));
      }, timeout);

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        console.log(`[Claude] Process exited with code: ${code}`);

        const output = outputChunks.join('');

        if (code === 0) {
          console.log(`[Claude] Execution completed successfully`);
          resolve({
            success: true,
            output: output.trim(),
          });
        } else {
          console.error(`[Claude] Execution failed with code ${code}`);
          resolve({
            success: false,
            error: `Claude Code process exited with code ${code}${output ? '\n' + output : ''}`,
          });
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutTimer);

        if (error.message.includes('ENOENT')) {
          reject(new Error(
            'Claude Code CLI not found. Please ensure Claude Code is installed and available in PATH.\n' +
            'Installation: https://docs.anthropic.com/en/docs/claude-code/installation'
          ));
        } else {
          reject(error);
        }
      });
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
    // Reset context logic - not applicable for CLI mode
    // Currently left as empty implementation
  }

  /**
   * Destroy executor
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isExecuting = false;
  }
}
