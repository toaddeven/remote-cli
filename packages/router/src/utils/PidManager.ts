import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * PID file manager for the router server
 */
export class PidManager {
  private pidFilePath: string;

  constructor(baseDir?: string) {
    const configDir = baseDir || path.join(os.homedir(), '.remote-cli-router');
    this.pidFilePath = path.join(configDir, 'server.pid');
  }

  /**
   * Write the current process ID to the PID file
   */
  async writePid(pid: number): Promise<void> {
    try {
      const dir = path.dirname(this.pidFilePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.pidFilePath, pid.toString(), 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to write PID file: ${error.message}`);
    }
  }

  /**
   * Read the PID from the PID file
   */
  async readPid(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.pidFilePath, 'utf-8');
      const pid = parseInt(content.trim(), 10);
      return isNaN(pid) ? null : pid;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null; // PID file doesn't exist
      }
      throw new Error(`Failed to read PID file: ${error.message}`);
    }
  }

  /**
   * Remove the PID file
   */
  async removePid(): Promise<void> {
    try {
      await fs.unlink(this.pidFilePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to remove PID file: ${error.message}`);
      }
    }
  }

  /**
   * Check if a process with the given PID is running
   */
  isProcessRunning(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the PID of the running server, or null if not running
   */
  async getRunningPid(): Promise<number | null> {
    const pid = await this.readPid();
    if (pid && this.isProcessRunning(pid)) {
      return pid;
    }

    // PID file exists but process is not running - clean up stale file
    if (pid) {
      await this.removePid();
    }

    return null;
  }
}
