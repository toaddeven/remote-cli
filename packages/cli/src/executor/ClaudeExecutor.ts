import { query } from '@anthropic-ai/claude-agent-sdk';
import { DirectoryGuard } from '../security/DirectoryGuard';
import path from 'path';

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
 * Responsible for invoking Claude Agent SDK to execute commands
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
      const timeoutPromise = new Promise<ClaudeExecuteResult>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Execution timeout exceeded'));
        }, timeout);
      });

      const executePromise = this.executeInternal(prompt, options);

      const result = await Promise.race([executePromise, timeoutPromise]);
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
   * Internal execution logic
   */
  private async executeInternal(
    prompt: string,
    options: ClaudeExecuteOptions
  ): Promise<ClaudeExecuteResult> {
    try {
      const queryInstance = query({
        prompt,
        options: {
          cwd: this.currentWorkingDirectory,
          tools: this.getAllowedTools(),
        }
      });

      let outputText = '';

      // Iterate through the query results
      for await (const message of queryInstance) {
        // Handle streaming output
        if (message.type === 'assistant' && message.message.content) {
          for (const content of message.message.content) {
            if (content.type === 'text' && options.onStream) {
              options.onStream(content.text);
            }
          }
        }

        // Collect final result
        if (message.type === 'result' && message.subtype === 'success') {
          outputText = message.result;
        }
      }

      return {
        success: true,
        output: outputText,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get allowed tools list
   */
  private getAllowedTools(): string[] {
    return [
      'Read',
      'Glob',
      'Grep',
      'Edit',
      'Write',
      'Bash',
      // Note: These tools will be further restricted by Claude Agent SDK
      // based on the working directory and security settings
    ];
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
        return `File or directory not found. Please check the path and try again.`;
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
    // Reset context logic (if SDK supports it)
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
