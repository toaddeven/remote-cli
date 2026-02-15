import { spawn } from 'child_process';
import { DirectoryGuard } from '../security/DirectoryGuard';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
 * Session info from Claude Code
 */
interface SessionInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Claude Executor
 * Manages session ID for continuity using --resume
 */
export class ClaudeExecutor {
  private directoryGuard: DirectoryGuard;
  private currentWorkingDirectory: string;
  private isExecuting = false;
  private isDestroyed = false;
  private defaultTimeout = 300000; // 5 minutes
  private sessionId: string | null = null;
  private sessionFilePath: string;

  constructor(directoryGuard: DirectoryGuard) {
    this.directoryGuard = directoryGuard;
    this.currentWorkingDirectory = process.cwd();
    // Store session ID in a file in the working directory
    this.sessionFilePath = path.join(this.currentWorkingDirectory, '.claude-session');
    this.loadSessionId();
  }

  /**
   * Load session ID from file if exists
   */
  private loadSessionId(): void {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        const data = fs.readFileSync(this.sessionFilePath, 'utf-8');
        const session = JSON.parse(data);
        if (session.id) {
          this.sessionId = session.id;
          console.log(`[Claude] Loaded session ID: ${this.sessionId}`);
        }
      }
    } catch (error) {
      console.error('[Claude] Failed to load session ID:', error);
      this.sessionId = null;
    }
  }

  /**
   * Save session ID to file
   */
  private saveSessionId(sessionId: string): void {
    try {
      const data = JSON.stringify({
        id: sessionId,
        savedAt: new Date().toISOString(),
      });
      fs.writeFileSync(this.sessionFilePath, data, 'utf-8');
      console.log(`[Claude] Saved session ID: ${sessionId}`);
    } catch (error) {
      console.error('[Claude] Failed to save session ID:', error);
    }
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
    // Update session file path
    this.sessionFilePath = path.join(this.currentWorkingDirectory, '.claude-session');
    this.loadSessionId();
  }

  /**
   * Get recent session ID from Claude Code
   */
  private async getRecentSessionId(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const output: string[] = [];

      // Run claude without arguments to get session list
      const child = spawn('claude', [], {
        cwd: this.currentWorkingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CI: 'true',
          FORCE_COLOR: '0',
        },
      });

      let timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(null); // Timeout, use existing or create new
      }, 5000);

      child.stdout.on('data', (data: Buffer) => {
        output.push(data.toString());
      });

      child.stderr.on('data', (data: Buffer) => {
        output.push(data.toString());
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        const outputText = output.join('');
        console.log('[Claude] Session list output:', outputText.substring(0, 500));

        // Try to parse session ID from output
        // Looking for patterns like UUIDs in the output
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const matches = outputText.match(uuidPattern);

        if (matches && matches.length > 0) {
          // Return the first (most recent) session ID
          console.log(`[Claude] Found session ID: ${matches[0]}`);
          resolve(matches[0]);
        } else {
          resolve(null);
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[Claude] Failed to get session list:', error);
        resolve(null);
      });
    });
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

    if (this.isExecuting) {
      return {
        success: false,
        error: 'Executor is busy, please wait for current task to complete',
      };
    }

    this.isExecuting = true;

    try {
      const timeout = options.timeout || this.defaultTimeout;

      // If we don't have a session ID, try to get recent one
      if (!this.sessionId) {
        console.log('[Claude] No session ID, checking for recent sessions...');
        this.sessionId = await this.getRecentSessionId();
        if (this.sessionId) {
          this.saveSessionId(this.sessionId);
        }
      }

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
      const args: string[] = ['--print'];

      if (this.sessionId) {
        args.push('--resume', this.sessionId);
        console.log(`[Claude] Resuming session: ${this.sessionId}`);
      } else {
        console.log('[Claude] Starting new session');
      }

      args.push(prompt);

      console.log(`[Claude] Starting: claude ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
      console.log(`[Claude] Working directory: ${this.currentWorkingDirectory}`);

      const child = spawn('claude', args, {
        cwd: this.currentWorkingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
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
        console.error('[Claude] Command timeout');
        child.kill('SIGTERM');
        reject(new Error('Execution timeout exceeded'));
      }, timeout);

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        console.log(`[Claude] Process exited with code: ${code}`);

        const output = outputChunks.join('');

        // Check if session ID is in output (for new sessions)
        if (!this.sessionId) {
          const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
          const matches = output.match(uuidPattern);
          if (matches && matches.length > 0) {
            this.sessionId = matches[0];
            this.saveSessionId(this.sessionId);
            console.log(`[Claude] New session ID: ${this.sessionId}`);
          }
        }

        if (code === 0) {
          console.log('[Claude] Execution completed successfully');
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
   * Clears the session ID so next command starts a new session
   */
  resetContext(): void {
    console.log('[Claude] Resetting session context');
    this.sessionId = null;

    // Remove session file
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
        console.log('[Claude] Session file removed');
      }
    } catch (error) {
      console.error('[Claude] Failed to remove session file:', error);
    }
  }

  /**
   * Destroy executor
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isExecuting = false;
  }
}
