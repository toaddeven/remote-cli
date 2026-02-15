import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient } from '../../src/client/WebSocketClient';
import { MessageHandler } from '../../src/client/MessageHandler';
import { ClaudeExecutor } from '../../src/executor/ClaudeExecutor';
import { DirectoryGuard } from '../../src/security/DirectoryGuard';
import { IncomingMessage, OutgoingMessage } from '../../src/types';

// Mock dependencies
vi.mock('../../src/client/WebSocketClient');
vi.mock('../../src/executor/ClaudeExecutor');

describe('Integration: Message Flow', () => {
  let wsClient: any;
  let executor: any;
  let guard: DirectoryGuard;
  let handler: MessageHandler;
  let messageCallback: (message: IncomingMessage) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock WebSocket client
    wsClient = {
      send: vi.fn(),
      on: vi.fn((event: string, callback: any) => {
        if (event === 'message') {
          messageCallback = callback;
        }
      }),
      isConnected: vi.fn(() => true),
    };
    (WebSocketClient as any).mockImplementation(() => wsClient);

    // Setup mock executor
    executor = {
      execute: vi.fn(),
      getCurrentWorkingDirectory: vi.fn(() => '~/projects'),
      setWorkingDirectory: vi.fn(),
      isExecuting: vi.fn(() => false),
    };
    (ClaudeExecutor as any).mockImplementation(() => executor);

    // Setup directory guard with ~ paths (always safe within home directory)
    guard = new DirectoryGuard(['~/projects', '~/work']);

    // Create message handler
    handler = new MessageHandler(wsClient, executor, guard);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Command execution flow', () => {
    it('should handle simple command message', async () => {
      executor.execute.mockResolvedValueOnce({
        success: true,
        output: 'Task completed successfully',
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_001',
        content: 'List files in current directory',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(executor.execute).toHaveBeenCalledWith(
        'List files in current directory',
        expect.objectContaining({
          onStream: expect.any(Function),
        })
      );

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_001',
          success: true,
          output: 'Task completed successfully',
        })
      );
    });

    it('should reject command with unsafe directory', async () => {
      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_002',
        content: 'Read /etc/passwd file',
        workingDirectory: '/etc',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(executor.execute).not.toHaveBeenCalled();
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_002',
          success: false,
          error: expect.stringContaining('whitelist'),
        })
      );
    });

    it('should handle command with streaming progress', async () => {
      const progressUpdates: string[] = [];

      executor.execute.mockImplementationOnce(async (content: string, options: any) => {
        options.onStream?.('Starting code analysis...');
        progressUpdates.push('Starting code analysis...');

        await new Promise((resolve) => setTimeout(resolve, 10));
        options.onStream?.('Fixing errors...');
        progressUpdates.push('Fixing errors...');

        await new Promise((resolve) => setTimeout(resolve, 10));
        options.onStream?.('Running tests...');
        progressUpdates.push('Running tests...');

        return {
          success: true,
          output: 'All tests passed',
        };
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_003',
        content: 'Fix TypeScript errors',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      // Verify progress messages were sent (using 'stream' type not 'progress')
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stream',
          messageId: 'msg_003',
          chunk: 'Starting code analysis...',
        })
      );

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stream',
          messageId: 'msg_003',
          chunk: 'Fixing errors...',
        })
      );

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stream',
          messageId: 'msg_003',
          chunk: 'Running tests...',
        })
      );

      // Verify final result
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_003',
          success: true,
          output: 'All tests passed',
        })
      );

      expect(progressUpdates).toEqual([
        'Starting code analysis...',
        'Fixing errors...',
        'Running tests...',
      ]);
    });

    it('should handle command execution error', async () => {
      executor.execute.mockRejectedValueOnce(new Error('Execution timeout'));

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_004',
        content: 'Complex long-running task',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_004',
          success: false,
          error: 'Execution timeout',
        })
      );
    });
  });

  describe('Special command handling', () => {
    it('should handle resume command', async () => {
      executor.execute.mockResolvedValueOnce({
        success: true,
        output: 'Session resumed',
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_005',
        content: '/resume',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      // The MessageHandler expands /resume to natural language
      expect(executor.execute).toHaveBeenCalledWith(
        'Please resume the previous conversation',
        expect.any(Object)
      );
    });

    it('should handle continue command', async () => {
      executor.execute.mockResolvedValueOnce({
        success: true,
        output: 'Continuing previous task',
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_006',
        content: '/continue',
        workingDirectory: '~/work',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      // The MessageHandler expands /continue to natural language
      expect(executor.execute).toHaveBeenCalledWith(
        'Please continue from where we left off',
        expect.any(Object)
      );
    });

    it('should handle status query', async () => {
      const message: IncomingMessage = {
        type: 'status',
        messageId: 'msg_007',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status',
          messageId: 'msg_007',
          status: {
            connected: true,
            allowedDirectories: ['~/projects', '~/work'],
            currentWorkingDirectory: expect.any(String),
          },
        })
      );
    });
  });

  describe('Concurrent command handling', () => {
    it('should reject concurrent commands (one at a time)', async () => {
      // First command takes time
      executor.execute.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { success: true, output: 'Done' };
      });

      const message1: IncomingMessage = {
        type: 'command',
        messageId: 'msg_008',
        content: 'Long running task',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      const message2: IncomingMessage = {
        type: 'command',
        messageId: 'msg_009',
        content: 'Another task',
        workingDirectory: '~/projects',
        timestamp: Date.now() + 1,
      };

      // Start first command
      const promise1 = handler.handleMessage(message1);

      // Try to start second command immediately
      await handler.handleMessage(message2);

      // Second command should be rejected
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_009',
          success: false,
          error: expect.stringContaining('busy'),
        })
      );

      // Wait for first command to complete
      await promise1;

      expect(executor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Directory path resolution', () => {
    it('should resolve tilde paths', async () => {
      executor.execute.mockResolvedValueOnce({
        success: true,
        output: 'File created',
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_010',
        content: 'Create file',
        workingDirectory: '~/projects',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(executor.execute).toHaveBeenCalledWith(
        'Create file',
        expect.any(Object)
      );
    });

    it('should handle relative paths from allowed directories', async () => {
      executor.execute.mockResolvedValueOnce({
        success: true,
        output: 'Task done',
      });

      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_011',
        content: 'Execute task',
        workingDirectory: '~/projects/my-app',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(executor.execute).toHaveBeenCalledWith(
        'Execute task',
        expect.any(Object)
      );
    });

    it('should reject path traversal attempts', async () => {
      const message: IncomingMessage = {
        type: 'command',
        messageId: 'msg_012',
        content: 'Read file',
        workingDirectory: '~/projects/../../../etc',
        timestamp: Date.now(),
      };

      await handler.handleMessage(message);

      expect(executor.execute).not.toHaveBeenCalled();
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          messageId: 'msg_012',
          success: false,
          error: expect.stringContaining('whitelist'),
        })
      );
    });
  });

  describe('Message validation', () => {
    it('should reject malformed messages', async () => {
      const invalidMessage: any = {
        type: 'command',
        // Missing required fields
      };

      await handler.handleMessage(invalidMessage);

      expect(executor.execute).not.toHaveBeenCalled();
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Invalid'),
        })
      );
    });

    it('should handle unknown message types', async () => {
      const unknownMessage: any = {
        type: 'unknown_type',
        messageId: 'msg_013',
        timestamp: Date.now(),
      };

      await handler.handleMessage(unknownMessage);

      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg_013',
          success: false,
          error: expect.stringContaining('Unknown message type'),
        })
      );
    });
  });
});
