import { spawn, ChildProcess } from 'child_process';
import { DirectoryGuard } from '../security/DirectoryGuard';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

/**
 * Claude stream JSON input message
 * Note: stream-json format expects 'type' at top level with nested 'message' object
 * Format: { "type": "user", "message": { "role": "user", "content": "..." } }
 */
interface ClaudeInputMessage {
  /** Message type */
  type: 'user';
  /** Message object with role and content */
  message: {
    /** Role of the message sender */
    role: 'user';
    /** Message content */
    content: string;
  };
}

/**
 * Claude stream JSON output message
 */
interface ClaudeOutputMessage {
  /** Message type */
  type: 'message' | 'thinking' | 'error' | 'usage' | 'system' | 'stream_event' | 'result' | 'assistant';
  /** Message content */
  content?: string;
  /** Whether this is a partial chunk */
  partial?: boolean;
  /** Usage information */
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  /** Message subtype - varies by type: 'init' for system, 'success'/'error' for result */
  subtype?: 'init' | 'success' | 'error';
  /** Current working directory (for system/init) */
  cwd?: string;
  /** Session ID (for system/init) */
  session_id?: string;
  /** Stream event details (for stream_event) */
  event?: {
    type: string;
    index?: number;
    content_block?: {
      type: string;
      text?: string;
    };
  };
  /** Parent tool use ID */
  parent_tool_use_id?: string | null;
  /** Message UUID */
  uuid?: string;
  /** Result content (for result messages) */
  result?: string;
  /** Error flag (for result messages) */
  is_error?: boolean;
  /** Duration in milliseconds (for result messages) */
  duration_ms?: number;
}

/**
 * Persistent Claude Executor options
 */
export interface PersistentClaudeOptions {
  /** Stream output callback */
  onStream?: (chunk: string) => void;
  /** Execution timeout (milliseconds), default 300000 (5 minutes) */
  timeout?: number;
}

/**
 * Persistent Claude execution result
 */
export interface PersistentClaudeResult {
  /** Whether execution was successful */
  success: boolean;
  /** Complete output content */
  output?: string;
  /** Error message */
  error?: string;
  /** Session ID abbreviation (last 8 chars) */
  sessionAbbr?: string;
}

/**
 * Get Claude's global sessions directory
 */
function getClaudeSessionsDir(): string | null {
  const homeDir = os.homedir();
  const possiblePaths = [
    path.join(homeDir, '.claude', 'sessions'),
    path.join(homeDir, '.config', 'claude', 'sessions'),
    path.join(homeDir, 'Library', 'Application Support', 'Claude', 'sessions'),
  ];

  for (const dir of possiblePaths) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

/**
 * Claude Persistent Executor
 *
 * Maintains a long-running Claude process and communicates via stdin/stdout
 * using stream-json format for real-time bidirectional communication.
 */
export class ClaudePersistentExecutor extends EventEmitter {
  private directoryGuard: DirectoryGuard;
  private currentWorkingDirectory: string;
  private isDestroyed = false;
  private defaultTimeout = 300000; // 5 minutes
  private sessionId: string | null = null;
  private sessionFilePath: string;

  // Persistent process
  private claudeProcess: ChildProcess | null = null;
  private isStarting = false;
  private commandQueue: Array<{
    prompt: string;
    options: PersistentClaudeOptions;
    resolve: (result: PersistentClaudeResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessing = false;

  // Output handling
  private currentOutputBuffer: string[] = [];
  private currentStreamCallback?: (chunk: string) => void;
  private currentCommandResolve?: (result: PersistentClaudeResult) => void;
  private currentCommandReject?: (error: Error) => void;
  private currentTimeoutTimer?: NodeJS.Timeout;

  constructor(directoryGuard: DirectoryGuard) {
    super();
    this.directoryGuard = directoryGuard;
    this.currentWorkingDirectory = process.cwd();
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
          console.log(`[ClaudePersistent] Loaded session ID: ${this.sessionId}`);
        }
      }
    } catch (error) {
      console.error('[ClaudePersistent] Failed to load session ID:', error);
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
      console.log(`[ClaudePersistent] Saved session ID: ${sessionId}`);
    } catch (error) {
      console.error('[ClaudePersistent] Failed to save session ID:', error);
    }
  }

  /**
   * Get recent session ID from Claude's sessions directory
   */
  private async getRecentSessionId(): Promise<string | null> {
    try {
      const sessionsDir = getClaudeSessionsDir();
      if (!sessionsDir) {
        return null;
      }

      const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
      const sessionDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => {
          const sessionPath = path.join(sessionsDir, entry.name);
          const stats = fs.statSync(sessionPath);
          return {
            id: entry.name,
            mtime: stats.mtime,
          };
        })
        .filter(session => {
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          return uuidPattern.test(session.id);
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (sessionDirs.length === 0) {
        return null;
      }

      return sessionDirs[0].id;
    } catch (error) {
      console.error('[ClaudePersistent] Failed to get recent session ID:', error);
      return null;
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
   */
  setWorkingDirectory(targetPath: string): void {
    const resolvedPath = this.directoryGuard.resolveWorkingDirectory(
      targetPath,
      this.currentWorkingDirectory
    );

    // If directory changes, we need to restart the process
    const needsRestart = this.currentWorkingDirectory !== resolvedPath && this.claudeProcess !== null;

    this.currentWorkingDirectory = resolvedPath;
    this.sessionFilePath = path.join(this.currentWorkingDirectory, '.claude-session');
    this.loadSessionId();

    if (needsRestart) {
      console.log('[ClaudePersistent] Working directory changed, restarting process...');
      this.stopProcess().then(() => this.startProcess());
    }
  }

  /**
   * Start the persistent Claude process
   */
  private async startProcess(): Promise<void> {
    if (this.claudeProcess || this.isStarting) {
      return;
    }

    this.isStarting = true;

    try {
      // If no session ID, try to get recent one
      if (!this.sessionId) {
        console.log('[ClaudePersistent] No session ID, checking for recent sessions...');
        this.sessionId = await this.getRecentSessionId();
        if (this.sessionId) {
          this.saveSessionId(this.sessionId);
        }
      }

      // Build arguments
      // Note: --output-format=stream-json requires --verbose
      const args: string[] = [
        '--input-format=stream-json',
        '--output-format=stream-json',
        '--include-partial-messages',
        '--verbose',
      ];

      if (this.sessionId) {
        args.push('--resume', this.sessionId);
        console.log(`[ClaudePersistent] Resuming session: ${this.sessionId}`);
      } else {
        console.log('[ClaudePersistent] Starting new session');
      }

      console.log(`[ClaudePersistent] Starting: claude ${args.join(' ')}`);
      console.log(`[ClaudePersistent] Working directory: ${this.currentWorkingDirectory}`);

      // Spawn the process
      const child = spawn('claude', args, {
        cwd: this.currentWorkingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          // Prevent nested session error
          CLAUDECODE: '',
        },
      });

      this.claudeProcess = child;

      // Buffer for collecting stderr on startup (for error reporting)
      let stderrBuffer: string[] = [];
      let isStartupPhase = true;

      // Handle stdout (JSON stream)
      let buffer = '';
      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            this.handleOutputLine(line.trim());
          }
        }
      });

      // Handle stderr
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();

        // Collect stderr during startup for error reporting
        if (isStartupPhase) {
          stderrBuffer.push(text);
          // Keep only last 20 lines to avoid memory issues
          if (stderrBuffer.length > 20) {
            stderrBuffer.shift();
          }
        }

        console.error('[ClaudePersistent stderr]', text);

        // Forward to current stream callback if available
        if (this.currentStreamCallback) {
          this.currentStreamCallback(text);
        }
        this.currentOutputBuffer.push(text);
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        isStartupPhase = false;
        const stderrOutput = stderrBuffer.join('');
        stderrBuffer = []; // Clear buffer

        if (code !== 0 && code !== null) {
          console.error(`[ClaudePersistent] Process exited with code ${code}, signal ${signal}`);
          if (stderrOutput) {
            console.error('[ClaudePersistent] stderr output:\n', stderrOutput);
          }
        } else {
          console.log(`[ClaudePersistent] Process exited with code ${code}, signal ${signal}`);
        }

        this.claudeProcess = null;

        // Reject current command if any
        if (this.currentCommandReject) {
          let errorMsg = `Claude process exited unexpectedly (code: ${code})`;
          if (stderrOutput) {
            errorMsg += `\nstderr: ${stderrOutput.substring(0, 500)}`;
          }
          this.currentCommandReject(new Error(errorMsg));
          this.resetCurrentCommand();
        }

        // Emit event for external handling
        this.emit('processExit', { code, signal });

        // Auto-restart if not destroyed and there are pending commands
        if (!this.isDestroyed && this.commandQueue.length > 0) {
          console.log('[ClaudePersistent] Auto-restarting process...');
          setTimeout(() => this.startProcess(), 1000);
        }
      });

      // Handle process error
      child.on('error', (error) => {
        console.error('[ClaudePersistent] Process error:', error);
        this.claudeProcess = null;
        this.isStarting = false;

        if (this.currentCommandReject) {
          if (error.message.includes('ENOENT')) {
            this.currentCommandReject(new Error(
              'Claude Code CLI not found. Please ensure Claude Code is installed and available in PATH.'
            ));
          } else {
            this.currentCommandReject(error);
          }
          this.resetCurrentCommand();
        }
      });

      // Wait a bit for process to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clear startup phase after a few seconds (stderr won't be buffered anymore)
      setTimeout(() => {
        isStartupPhase = false;
        stderrBuffer = [];
      }, 5000);

      console.log(`[ClaudePersistent] Process started with PID: ${child.pid}`);
      this.isStarting = false;

      // Process any pending commands
      this.processQueue();

    } catch (error) {
      this.isStarting = false;
      throw error;
    }
  }

  /**
   * Stop the persistent Claude process
   */
  private async stopProcess(): Promise<void> {
    if (!this.claudeProcess) {
      return;
    }

    console.log('[ClaudePersistent] Stopping process...');

    // Send EOF to stdin to gracefully close
    this.claudeProcess.stdin?.end();

    // Kill after timeout
    const killTimeout = setTimeout(() => {
      if (this.claudeProcess) {
        console.log('[ClaudePersistent] Force killing process...');
        this.claudeProcess.kill('SIGTERM');
      }
    }, 5000);

    // Wait for process to exit
    await new Promise<void>(resolve => {
      if (!this.claudeProcess) {
        resolve();
        return;
      }

      this.claudeProcess.on('exit', () => {
        clearTimeout(killTimeout);
        resolve();
      });
    });

    this.claudeProcess = null;
    console.log('[ClaudePersistent] Process stopped');
  }

  /**
   * Handle a line of JSON output from Claude
   */
  private handleOutputLine(line: string): void {
    try {
      const message: ClaudeOutputMessage = JSON.parse(line);

      switch (message.type) {
        case 'message':
        case 'thinking':
          console.log(`[ClaudePersistent] Received ${message.type} message, partial=${message.partial}, content length=${message.content?.length || 0}`);
          if (message.content) {
            this.currentOutputBuffer.push(message.content);
            if (this.currentStreamCallback) {
              this.currentStreamCallback(message.content);
            }

            // If not partial, command is complete
            if (!message.partial) {
              console.log('[ClaudePersistent] Message complete (partial=false), completing command');
              this.completeCurrentCommand(true);
            }
          }
          break;

        case 'error':
          console.error('[ClaudePersistent] Error from Claude:', message.content);
          this.completeCurrentCommand(false, message.content || 'Unknown error from Claude');
          break;

        case 'usage':
          // Usage info, can be logged or ignored
          if (message.usage) {
            console.log(`[ClaudePersistent] Usage: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);
          }
          break;

        case 'system':
          // System messages (e.g., init)
          if (message.subtype === 'init' && message.session_id) {
            console.log(`[ClaudePersistent] Session initialized: ${message.session_id}`);
            this.sessionId = message.session_id;
            this.saveSessionId(message.session_id);
          }
          break;

        case 'stream_event':
          // Stream events are internal protocol messages, silently ignore
          // These include content_block_start, content_block_delta, etc.
          break;

        case 'result':
          // Result messages contain the final response and completion status
          console.log(`[ClaudePersistent] Result received, subtype=${message.subtype}, has result=${!!message.result}`);
          if (message.result) {
            this.currentOutputBuffer.push(message.result);
            if (this.currentStreamCallback) {
              this.currentStreamCallback(message.result);
            }
          }
          // Complete the command with success or error based on is_error flag
          if (message.is_error) {
            this.completeCurrentCommand(false, message.result || 'Command failed');
          } else {
            this.completeCurrentCommand(true);
          }
          break;

        case 'assistant':
          // Assistant messages contain metadata about the assistant's response
          // Usually sent at the end of a response stream
          console.log('[ClaudePersistent] Assistant response complete');
          break;

        default:
          // Log unknown message types for debugging
          console.log('[ClaudePersistent] Unknown message type:', (message as { type: string }).type, 'Full message:', JSON.stringify(message).substring(0, 200));
      }
    } catch (error) {
      // Not valid JSON, treat as plain text output
      this.currentOutputBuffer.push(line);
      if (this.currentStreamCallback) {
        this.currentStreamCallback(line + '\n');
      }
    }
  }

  /**
   * Complete the current command
   */
  private completeCurrentCommand(success: boolean, errorMessage?: string): void {
    if (this.currentTimeoutTimer) {
      clearTimeout(this.currentTimeoutTimer);
      this.currentTimeoutTimer = undefined;
    }

    const output = this.currentOutputBuffer.join('');
    console.log(`[ClaudePersistent] Completing command, success=${success}, output length=${output.length}, output preview: ${output.substring(0, 100)}...`);

    if (success && this.currentCommandResolve) {
      // Get session abbreviation (last 8 characters of session ID)
      const sessionAbbr = this.sessionId ? this.sessionId.slice(-8) : undefined;
      this.currentCommandResolve({
        success: true,
        output: output.trim(),
        sessionAbbr,
      });
    } else if (this.currentCommandReject) {
      this.currentCommandReject(new Error(errorMessage || 'Command failed'));
    }

    this.resetCurrentCommand();

    // Process next command in queue
    this.isProcessing = false;
    this.processQueue();
  }

  /**
   * Reset current command state
   */
  private resetCurrentCommand(): void {
    this.currentOutputBuffer = [];
    this.currentStreamCallback = undefined;
    this.currentCommandResolve = undefined;
    this.currentCommandReject = undefined;
    if (this.currentTimeoutTimer) {
      clearTimeout(this.currentTimeoutTimer);
      this.currentTimeoutTimer = undefined;
    }
  }

  /**
   * Process the command queue
   */
  private processQueue(): void {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return;
    }

    // Ensure process is running
    if (!this.claudeProcess) {
      this.startProcess();
      return;
    }

    const command = this.commandQueue.shift();
    if (!command) {
      return;
    }

    this.isProcessing = true;
    this.currentStreamCallback = command.options.onStream;
    this.currentCommandResolve = command.resolve;
    this.currentCommandReject = command.reject;

    // Set timeout
    const timeout = command.options.timeout || this.defaultTimeout;
    this.currentTimeoutTimer = setTimeout(() => {
      console.error('[ClaudePersistent] Command timeout');
      this.completeCurrentCommand(false, 'Execution timeout exceeded');
    }, timeout);

    // Send the command
    const inputMessage: ClaudeInputMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: command.prompt,
      },
    };

    const inputLine = JSON.stringify(inputMessage);
    console.log(`[ClaudePersistent] Sending command: ${command.prompt.substring(0, 100)}...`);

    this.claudeProcess.stdin?.write(inputLine + '\n');
  }

  /**
   * Execute a command through the persistent Claude process
   */
  async execute(
    prompt: string,
    options: PersistentClaudeOptions = {}
  ): Promise<PersistentClaudeResult> {
    if (this.isDestroyed) {
      return {
        success: false,
        error: 'Executor has been destroyed',
      };
    }

    return new Promise((resolve, reject) => {
      // Add to queue
      this.commandQueue.push({
        prompt,
        options,
        resolve: (result) => {
          // Extract and save session ID if it's a new session
          if (!this.sessionId && result.success) {
            const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
            const matches = result.output?.match(uuidPattern);
            if (matches && matches.length > 0) {
              this.sessionId = matches[0];
              this.saveSessionId(this.sessionId);
            }
          }
          resolve(result);
        },
        reject,
      });

      // Try to process queue
      this.processQueue();
    });
  }

  /**
   * Reset execution context
   */
  resetContext(): void {
    console.log('[ClaudePersistent] Resetting session context');
    this.sessionId = null;

    // Stop current process
    this.stopProcess();

    // Clear queue
    this.commandQueue = [];
    this.resetCurrentCommand();
    this.isProcessing = false;

    // Remove session file
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
        console.log('[ClaudePersistent] Session file removed');
      }
    } catch (error) {
      console.error('[ClaudePersistent] Failed to remove session file:', error);
    }
  }

  /**
   * Destroy executor and cleanup
   */
  async destroy(): Promise<void> {
    this.isDestroyed = true;

    // Clear queue and reject pending commands
    for (const command of this.commandQueue) {
      command.reject(new Error('Executor has been destroyed'));
    }
    this.commandQueue = [];

    if (this.currentCommandReject) {
      this.currentCommandReject(new Error('Executor has been destroyed'));
      this.resetCurrentCommand();
    }

    // Stop process
    await this.stopProcess();

    // Remove all listeners
    this.removeAllListeners();
  }

  /**
   * Check if process is running
   */
  isProcessRunning(): boolean {
    return this.claudeProcess !== null && !this.claudeProcess.killed;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}
