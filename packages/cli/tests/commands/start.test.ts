import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startCommand } from '../../src/commands/start';
import { ConfigManager } from '../../src/config/ConfigManager';
import { WebSocketClient } from '../../src/client/WebSocketClient';

// Mock dependencies
vi.mock('../../src/config/ConfigManager');
vi.mock('../../src/client/WebSocketClient');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('start command', () => {
  let mockConfig: any;
  let mockWsClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      get: vi.fn(),
      has: vi.fn(() => true),
      getAll: vi.fn(() => ({
        deviceId: 'dev_test_12345',
        serverUrl: 'https://test-server.com',
        security: {
          allowedDirectories: ['~/projects'],
        },
      })),
      set: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(ConfigManager, 'initialize').mockResolvedValue(mockConfig);

    mockWsClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn(() => true),
      disconnect: vi.fn(),
      on: vi.fn(),
    };
    (WebSocketClient as any).mockImplementation(() => mockWsClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('service startup', () => {
    it('should start service with valid configuration', async () => {
      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(true);
      expect(mockWsClient.connect).toHaveBeenCalled();
    });

    it('should connect to WebSocket server', async () => {
      await startCommand({
        daemon: false,
      });

      expect(WebSocketClient).toHaveBeenCalledWith(
        'https://test-server.com',
        'dev_test_12345',
        expect.any(Object)
      );
      expect(mockWsClient.connect).toHaveBeenCalled();
    });

    it('should fail if not initialized', async () => {
      mockConfig.has.mockReturnValue(false);

      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
      expect(mockWsClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('daemon mode', () => {
    it('should run in daemon mode when specified', async () => {
      const result = await startCommand({
        daemon: true,
      });

      expect(result.success).toBe(true);
      expect(result.daemonMode).toBe(true);
    });

    it('should run in foreground mode by default', async () => {
      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(true);
      expect(result.daemonMode).toBe(false);
    });
  });

  describe('connection handling', () => {
    it('should handle connection errors', async () => {
      mockWsClient.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    it('should setup event handlers', async () => {
      await startCommand({
        daemon: false,
      });

      expect(mockWsClient.on).toHaveBeenCalledWith('connected', expect.any(Function));
      expect(mockWsClient.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
      expect(mockWsClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('configuration validation', () => {
    it('should validate device ID exists', async () => {
      mockConfig.getAll.mockReturnValue({
        serverUrl: 'https://test-server.com',
        security: { allowedDirectories: ['~/projects'] },
      });

      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('deviceId');
    });

    it('should validate server URL exists', async () => {
      mockConfig.getAll.mockReturnValue({
        deviceId: 'dev_test_12345',
        security: { allowedDirectories: ['~/projects'] },
      });

      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('serverUrl');
    });

    it('should validate allowed directories exist', async () => {
      mockConfig.getAll.mockReturnValue({
        deviceId: 'dev_test_12345',
        serverUrl: 'https://test-server.com',
        security: {},
      });

      const result = await startCommand({
        daemon: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('allowedDirectories');
    });
  });

  describe('service lifecycle', () => {
    it('should save process information when started', async () => {
      const result = await startCommand({
        daemon: true,
      });

      expect(result.success).toBe(true);
      expect(mockConfig.set).toHaveBeenCalledWith('service.running', true);
      expect(mockConfig.set).toHaveBeenCalledWith('service.startedAt', expect.any(Number));
    });
  });
});
