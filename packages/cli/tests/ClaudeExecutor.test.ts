import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeExecutor } from '../src/executor/ClaudeExecutor';
import { DirectoryGuard } from '../src/security/DirectoryGuard';

// Mock Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';

describe('ClaudeExecutor', () => {
  let executor: ClaudeExecutor;
  let directoryGuard: DirectoryGuard;
  const mockQuery = query as any;

  beforeEach(() => {
    vi.clearAllMocks();
    directoryGuard = new DirectoryGuard(['~/test-project', './work']);
    executor = new ClaudeExecutor(directoryGuard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create executor with directory guard', () => {
      expect(executor).toBeDefined();
      expect(executor).toBeInstanceOf(ClaudeExecutor);
    });

    it('should have default working directory', () => {
      const cwd = executor.getCurrentWorkingDirectory();
      expect(cwd).toBeDefined();
      expect(typeof cwd).toBe('string');
    });
  });

  describe('working directory management', () => {
    it('should set working directory if path is safe', () => {
      const safePath = '~/test-project';
      executor.setWorkingDirectory(safePath);
      const cwd = executor.getCurrentWorkingDirectory();
      expect(cwd).toContain('test-project');
    });

    it('should throw error if path is not safe', () => {
      const unsafePath = '/etc/passwd';
      expect(() => executor.setWorkingDirectory(unsafePath)).toThrow();
    });

    it('should normalize tilde paths', () => {
      executor.setWorkingDirectory('~/test-project');
      const cwd = executor.getCurrentWorkingDirectory();
      expect(cwd).not.toContain('~');
      expect(cwd).toContain('test-project');
    });

    it('should handle relative paths', () => {
      executor.setWorkingDirectory('./work');
      const cwd = executor.getCurrentWorkingDirectory();
      expect(cwd).toContain('work');
    });
  });

  describe('command execution', () => {
    it('should execute command with Claude Agent SDK', async () => {
      mockQuery.mockResolvedValue({
        output: 'Test output',
        success: true,
      });

      const result = await executor.execute('list files');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'list files',
        })
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe('Test output');
    });

    it('should pass current working directory to Claude', async () => {
      mockQuery.mockResolvedValue({ output: 'ok', success: true });

      executor.setWorkingDirectory('~/test-project');
      await executor.execute('test command');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: expect.stringContaining('test-project'),
        })
      );
    });

    it('should handle execution errors', async () => {
      mockQuery.mockRejectedValue(new Error('Claude SDK error'));

      const result = await executor.execute('test command');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude SDK error');
    });

    it('should not execute if working directory is not safe', async () => {
      // Force set unsafe directory (bypass validation for test)
      try {
        executor.setWorkingDirectory('/etc');
      } catch {
        // Expected to throw
      }

      // Current directory should remain unchanged
      const cwd = executor.getCurrentWorkingDirectory();
      expect(cwd).not.toBe('/etc');
    });
  });

  describe('streaming output', () => {
    it('should support streaming output callback', async () => {
      const chunks: string[] = [];
      const onStream = vi.fn((chunk: string) => {
        chunks.push(chunk);
      });

      mockQuery.mockImplementation(async (options: any) => {
        if (options.onStream) {
          options.onStream('chunk 1');
          options.onStream('chunk 2');
          options.onStream('chunk 3');
        }
        return { output: 'final output', success: true };
      });

      await executor.execute('test command', { onStream });

      expect(onStream).toHaveBeenCalledTimes(3);
      expect(chunks).toEqual(['chunk 1', 'chunk 2', 'chunk 3']);
      expect(onStream).toHaveBeenCalledWith('chunk 1');
      expect(onStream).toHaveBeenCalledWith('chunk 2');
      expect(onStream).toHaveBeenCalledWith('chunk 3');
    });

    it('should handle streaming errors gracefully', async () => {
      const onStream = vi.fn(() => {
        throw new Error('Stream processing error');
      });

      mockQuery.mockImplementation(async (options: any) => {
        if (options.onStream) {
          options.onStream('test chunk');
        }
        return { output: 'output', success: true };
      });

      // Should not throw, should continue execution
      const result = await executor.execute('test', { onStream });
      expect(result.success).toBe(true);
    });
  });

  describe('tool restrictions', () => {
    it('should pass allowed tools to Claude', async () => {
      mockQuery.mockResolvedValue({ output: 'ok', success: true });

      await executor.execute('test command');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedTools: expect.arrayContaining(['Read', 'Glob', 'Grep']),
        })
      );
    });

    it('should restrict dangerous tools by default', async () => {
      mockQuery.mockResolvedValue({ output: 'ok', success: true });

      await executor.execute('test command');

      const call = mockQuery.mock.calls[0][0];
      expect(call.allowedTools).toBeDefined();
      // Should not include unrestricted Bash or Write to sensitive locations
      expect(call.allowedTools).toEqual(
        expect.not.arrayContaining(['sudo', 'rm -rf'])
      );
    });
  });

  describe('context management', () => {
    it('should maintain execution context', async () => {
      mockQuery.mockResolvedValue({ output: 'ok', success: true });

      await executor.execute('command 1');
      await executor.execute('command 2');

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should reset context when requested', async () => {
      mockQuery.mockResolvedValue({ output: 'ok', success: true });

      await executor.execute('command 1');
      executor.resetContext();
      await executor.execute('command 2');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Second call should not reference first command's context
    });
  });

  describe('concurrent execution', () => {
    it('should prevent concurrent executions', async () => {
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ output: 'ok', success: true }), 100))
      );

      const promise1 = executor.execute('command 1');
      const promise2 = executor.execute('command 2');

      const result1 = await promise1;
      const result2 = await promise2;

      // One should succeed, one should fail with "busy" error
      const results = [result1, result2];
      const successCount = results.filter((r) => r.success).length;
      const busyCount = results.filter((r) => !r.success && r.error?.includes('busy')).length;

      expect(successCount).toBe(1);
      expect(busyCount).toBe(1);
    });
  });

  describe('timeout handling', () => {
    it('should timeout long-running executions', async () => {
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ output: 'ok', success: true }), 10000))
      );

      const result = await executor.execute('long command', { timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should use default timeout if not specified', async () => {
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ output: 'ok', success: true }), 100))
      );

      const result = await executor.execute('command');

      expect(result.success).toBe(true);
    });
  });

  describe('error messages', () => {
    it('should provide user-friendly error messages', async () => {
      mockQuery.mockRejectedValue(new Error('ENOENT: no such file'));

      const result = await executor.execute('test command');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('should include working directory in error context', async () => {
      mockQuery.mockRejectedValue(new Error('Permission denied'));

      executor.setWorkingDirectory('~/test-project');
      const result = await executor.execute('test command');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources on destroy', () => {
      executor.destroy();
      // Should not throw
      expect(() => executor.destroy()).not.toThrow();
    });

    it('should reject executions after destroy', async () => {
      executor.destroy();
      const result = await executor.execute('test command');

      expect(result.success).toBe(false);
      expect(result.error).toContain('destroyed');
    });
  });
});
