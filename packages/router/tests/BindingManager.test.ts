import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BindingManager } from '../src/binding/BindingManager';
import Redis from 'ioredis';

// Mock Redis
vi.mock('ioredis');

describe('BindingManager', () => {
  let bindingManager: BindingManager;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      hgetall: vi.fn(),
      hmset: vi.fn(),
      hset: vi.fn(),
      del: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      exists: vi.fn(),
      expire: vi.fn()
    };

    (Redis as any).mockImplementation(() => mockRedis);
    bindingManager = new BindingManager('redis://localhost:6379');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateBindingCode', () => {
    it('should generate binding code in correct format', async () => {
      const deviceId = 'dev_test_123';
      const deviceName = 'Test-Device';

      const bindingCode = await bindingManager.generateBindingCode(deviceId, deviceName);

      // Verify binding code format: XXX-XXX-XXX
      expect(bindingCode.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      expect(bindingCode.deviceId).toBe(deviceId);
      expect(bindingCode.createdAt).toBeLessThanOrEqual(Date.now());
      expect(bindingCode.expiresAt).toBe(bindingCode.createdAt + 5 * 60 * 1000); // Expires in 5 minutes
    });

    it('should store binding code in Redis', async () => {
      const deviceId = 'dev_test_123';
      const deviceName = 'Test-Device';

      mockRedis.set.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      const bindingCode = await bindingManager.generateBindingCode(deviceId, deviceName);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `binding:code:${bindingCode.code}`,
        expect.any(String)
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        `binding:code:${bindingCode.code}`,
        300 // 5 minutes
      );
    });
  });

  describe('verifyBindingCode', () => {
    it('should verify valid binding code', async () => {
      const code = 'ABC-123-XYZ';
      const deviceId = 'dev_test_123';
      const validBindingCode = {
        code,
        deviceId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(validBindingCode));

      const result = await bindingManager.verifyBindingCode(code);

      expect(result).not.toBeNull();
      expect(result?.deviceId).toBe(deviceId);
    });

    it('should reject expired binding code', async () => {
      const code = 'ABC-123-XYZ';
      const expiredBindingCode = {
        code,
        deviceId: 'dev_test_123',
        createdAt: Date.now() - 10 * 60 * 1000,
        expiresAt: Date.now() - 5 * 60 * 1000 // Already expired
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(expiredBindingCode));

      const result = await bindingManager.verifyBindingCode(code);

      expect(result).toBeNull();
    });

    it('should reject non-existent binding code', async () => {
      const code = 'INVALID-CODE';

      mockRedis.get.mockResolvedValue(null);

      const result = await bindingManager.verifyBindingCode(code);

      expect(result).toBeNull();
    });
  });

  describe('bindUser', () => {
    it('should successfully bind user and device', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';
      const deviceName = 'Test-Device';

      mockRedis.hmset.mockResolvedValue('OK');
      mockRedis.hset.mockResolvedValue(1);

      await bindingManager.bindUser(openId, deviceId, deviceName);

      expect(mockRedis.hmset).toHaveBeenCalledWith(
        `binding:user:${openId}`,
        expect.objectContaining({
          openId,
          deviceId,
          deviceName
        })
      );
    });

    it('should update existing binding', async () => {
      const openId = 'ou_test_user';
      const oldDeviceId = 'dev_old_123';
      const newDeviceId = 'dev_new_456';
      const deviceName = 'New-Device';

      mockRedis.hgetall.mockResolvedValue({
        openId,
        deviceId: oldDeviceId,
        deviceName: 'Old-Device',
        boundAt: String(Date.now() - 10000)
      });
      mockRedis.hmset.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);

      await bindingManager.bindUser(openId, newDeviceId, deviceName);

      // Should delete old device binding
      expect(mockRedis.del).toHaveBeenCalledWith(`binding:device:${oldDeviceId}`);

      // Should create new device binding
      expect(mockRedis.hmset).toHaveBeenCalledWith(
        `binding:user:${openId}`,
        expect.objectContaining({
          deviceId: newDeviceId,
          deviceName
        })
      );
    });
  });

  describe('getUserBinding', () => {
    it('should get user binding information', async () => {
      const openId = 'ou_test_user';
      const expectedBinding = {
        openId,
        deviceId: 'dev_test_123',
        deviceName: 'Test-Device',
        boundAt: String(Date.now()),
        lastActiveAt: String(Date.now())
      };

      mockRedis.hgetall.mockResolvedValue(expectedBinding);

      const binding = await bindingManager.getUserBinding(openId);

      expect(binding).not.toBeNull();
      expect(binding?.openId).toBe(openId);
      expect(binding?.deviceId).toBe('dev_test_123');
    });

    it('should return null when user is not bound', async () => {
      const openId = 'ou_unbound_user';

      mockRedis.hgetall.mockResolvedValue({});

      const binding = await bindingManager.getUserBinding(openId);

      expect(binding).toBeNull();
    });
  });

  describe('getDeviceBinding', () => {
    it('should get device binding information', async () => {
      const deviceId = 'dev_test_123';
      const openId = 'ou_test_user';

      mockRedis.hgetall.mockResolvedValue({
        openId,
        deviceId,
        deviceName: 'Test-Device',
        boundAt: String(Date.now())
      });

      const binding = await bindingManager.getDeviceBinding(deviceId);

      expect(binding).not.toBeNull();
      expect(binding?.deviceId).toBe(deviceId);
      expect(binding?.openId).toBe(openId);
    });
  });

  describe('unbindUser', () => {
    it('should successfully unbind user', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      mockRedis.hgetall.mockResolvedValue({
        openId,
        deviceId,
        deviceName: 'Test-Device',
        boundAt: String(Date.now())
      });
      mockRedis.del.mockResolvedValue(1);

      await bindingManager.unbindUser(openId);

      expect(mockRedis.del).toHaveBeenCalledWith(`binding:user:${openId}`);
      expect(mockRedis.del).toHaveBeenCalledWith(`binding:device:${deviceId}`);
    });

    it('should ignore unbound user', async () => {
      const openId = 'ou_unbound_user';

      mockRedis.hgetall.mockResolvedValue({});

      await bindingManager.unbindUser(openId);

      // Should not call delete operations
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  describe('updateLastActive', () => {
    it('should update user last active time', async () => {
      const openId = 'ou_test_user';

      mockRedis.hset.mockResolvedValue(1);

      await bindingManager.updateLastActive(openId);

      expect(mockRedis.hset).toHaveBeenCalledWith(
        `binding:user:${openId}`,
        'lastActiveAt',
        expect.any(String)
      );
    });
  });
});
