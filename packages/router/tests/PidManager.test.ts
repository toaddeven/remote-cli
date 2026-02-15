import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PidManager } from '../src/utils/PidManager';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('PidManager', () => {
  let testDir: string;
  let pidManager: PidManager;

  beforeEach(async () => {
    // Create temporary directory for testing
    testDir = path.join(os.tmpdir(), `test-router-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    pidManager = new PidManager(testDir);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('writePid', () => {
    it('should write PID to file', async () => {
      const testPid = 12345;
      await pidManager.writePid(testPid);

      const pidFilePath = path.join(testDir, 'server.pid');
      const content = await fs.readFile(pidFilePath, 'utf-8');
      expect(content).toBe('12345');
    });

    it('should create directory if it does not exist', async () => {
      const deepDir = path.join(os.tmpdir(), `test-router-deep-${Date.now()}`, 'nested');
      const deepManager = new PidManager(deepDir);

      await deepManager.writePid(99999);

      const pidFilePath = path.join(deepDir, 'server.pid');
      const content = await fs.readFile(pidFilePath, 'utf-8');
      expect(content).toBe('99999');

      // Cleanup
      await fs.rm(path.dirname(deepDir), { recursive: true, force: true });
    });
  });

  describe('readPid', () => {
    it('should read PID from file', async () => {
      await pidManager.writePid(54321);
      const pid = await pidManager.readPid();
      expect(pid).toBe(54321);
    });

    it('should return null if PID file does not exist', async () => {
      const pid = await pidManager.readPid();
      expect(pid).toBeNull();
    });

    it('should return null if PID file contains invalid content', async () => {
      const pidFilePath = path.join(testDir, 'server.pid');
      await fs.writeFile(pidFilePath, 'not-a-number', 'utf-8');
      const pid = await pidManager.readPid();
      expect(pid).toBeNull();
    });
  });

  describe('removePid', () => {
    it('should remove PID file', async () => {
      await pidManager.writePid(11111);

      const pidFilePath = path.join(testDir, 'server.pid');
      expect(await fileExists(pidFilePath)).toBe(true);

      await pidManager.removePid();
      expect(await fileExists(pidFilePath)).toBe(false);
    });

    it('should not throw error if PID file does not exist', async () => {
      await expect(pidManager.removePid()).resolves.not.toThrow();
    });
  });

  describe('isProcessRunning', () => {
    it('should return true for current process', () => {
      const result = pidManager.isProcessRunning(process.pid);
      expect(result).toBe(true);
    });

    it('should return false for non-existent process', () => {
      // Use a PID that is very unlikely to exist
      const result = pidManager.isProcessRunning(999999);
      expect(result).toBe(false);
    });
  });

  describe('getRunningPid', () => {
    it('should return PID if process is running', async () => {
      await pidManager.writePid(process.pid);
      const runningPid = await pidManager.getRunningPid();
      expect(runningPid).toBe(process.pid);
    });

    it('should return null if PID file does not exist', async () => {
      const runningPid = await pidManager.getRunningPid();
      expect(runningPid).toBeNull();
    });

    it('should return null and clean up stale PID file', async () => {
      // Write a PID that doesn't exist
      await pidManager.writePid(999999);

      const runningPid = await pidManager.getRunningPid();
      expect(runningPid).toBeNull();

      // Verify PID file was removed
      const pidFilePath = path.join(testDir, 'server.pid');
      expect(await fileExists(pidFilePath)).toBe(false);
    });
  });
});

/**
 * Helper function to check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
