import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BindingManager } from '../src/binding/BindingManager';
import { JsonStore } from '../src/storage/JsonStore';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('BindingManager', () => {
  let bindingManager: BindingManager;
  let store: JsonStore;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test data
    testDir = path.join(os.tmpdir(), `binding-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    const storePath = path.join(testDir, 'bindings.json');
    store = new JsonStore(storePath);
    await store.initialize();
    bindingManager = new BindingManager(store);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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

    it('should store binding code in store', async () => {
      const deviceId = 'dev_test_123';
      const deviceName = 'Test-Device';

      const bindingCode = await bindingManager.generateBindingCode(deviceId, deviceName);

      // Verify the code can be retrieved
      const retrieved = await bindingManager.verifyBindingCode(bindingCode.code);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.deviceId).toBe(deviceId);
    });
  });

  describe('verifyBindingCode', () => {
    it('should verify valid binding code', async () => {
      const deviceId = 'dev_test_123';

      // Generate a code first
      const bindingCode = await bindingManager.generateBindingCode(deviceId, 'Test-Device');

      const result = await bindingManager.verifyBindingCode(bindingCode.code);

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

      // Store expired code directly
      await store.setBindingCode(code, expiredBindingCode);

      const result = await bindingManager.verifyBindingCode(code);

      expect(result).toBeNull();
    });

    it('should reject non-existent binding code', async () => {
      const code = 'INVALID-CODE';

      const result = await bindingManager.verifyBindingCode(code);

      expect(result).toBeNull();
    });
  });

  describe('bindUser', () => {
    it('should successfully bind user and device', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';
      const deviceName = 'Test-Device';

      await bindingManager.bindUser(openId, deviceId, deviceName);

      // Verify binding was created
      const binding = await bindingManager.getUserBinding(openId);
      expect(binding).not.toBeNull();
      expect(binding?.openId).toBe(openId);
      expect(binding?.deviceId).toBe(deviceId);
      expect(binding?.deviceName).toBe(deviceName);
    });

    it('should update existing binding', async () => {
      const openId = 'ou_test_user';
      const oldDeviceId = 'dev_old_123';
      const newDeviceId = 'dev_new_456';

      // Create initial binding
      await bindingManager.bindUser(openId, oldDeviceId, 'Old-Device');

      // Update to new device
      await bindingManager.bindUser(openId, newDeviceId, 'New-Device');

      // Verify new binding
      const binding = await bindingManager.getUserBinding(openId);
      expect(binding?.deviceId).toBe(newDeviceId);
      expect(binding?.deviceName).toBe('New-Device');
    });
  });

  describe('getUserBinding', () => {
    it('should get user binding information', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      await bindingManager.bindUser(openId, deviceId, 'Test-Device');

      const binding = await bindingManager.getUserBinding(openId);

      expect(binding).not.toBeNull();
      expect(binding?.openId).toBe(openId);
      expect(binding?.deviceId).toBe(deviceId);
    });

    it('should return null when user is not bound', async () => {
      const openId = 'ou_unbound_user';

      const binding = await bindingManager.getUserBinding(openId);

      expect(binding).toBeNull();
    });
  });

  describe('getDeviceBinding', () => {
    it('should get device binding information', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      await bindingManager.bindUser(openId, deviceId, 'Test-Device');

      const binding = await bindingManager.getDeviceBinding(deviceId);

      expect(binding).not.toBeNull();
      expect(binding?.deviceId).toBe(deviceId);
      expect(binding?.openId).toBe(openId);
    });

    it('should return null when device is not bound', async () => {
      const deviceId = 'dev_unbound_123';

      const binding = await bindingManager.getDeviceBinding(deviceId);

      expect(binding).toBeNull();
    });
  });

  describe('unbindUser', () => {
    it('should successfully unbind user', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      await bindingManager.bindUser(openId, deviceId, 'Test-Device');
      await bindingManager.unbindUser(openId);

      // Verify user binding is removed
      const userBinding = await bindingManager.getUserBinding(openId);
      expect(userBinding).toBeNull();

      // Verify device binding is also removed
      const deviceBinding = await bindingManager.getDeviceBinding(deviceId);
      expect(deviceBinding).toBeNull();
    });

    it('should ignore unbound user', async () => {
      const openId = 'ou_unbound_user';

      // Should not throw error
      await expect(bindingManager.unbindUser(openId)).resolves.not.toThrow();
    });
  });

  describe('updateLastActive', () => {
    it('should update user last active time', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      await bindingManager.bindUser(openId, deviceId, 'Test-Device');

      const beforeUpdate = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay

      await bindingManager.updateLastActive(openId);

      const binding = await bindingManager.getUserBinding(openId);
      expect(binding?.lastActiveAt).toBeGreaterThanOrEqual(beforeUpdate);
    });

    it('should not throw for unbound user', async () => {
      const openId = 'ou_unbound_user';

      await expect(bindingManager.updateLastActive(openId)).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('should flush data to disk', async () => {
      const openId = 'ou_test_user';
      const deviceId = 'dev_test_123';

      await bindingManager.bindUser(openId, deviceId, 'Test-Device');
      await bindingManager.close();

      // Verify file exists
      const storePath = path.join(testDir, 'bindings.json');
      const content = await fs.readFile(storePath, 'utf-8');
      const data = JSON.parse(content);

      expect(data.userBindings[openId]).toBeDefined();
      expect(data.userBindings[openId].deviceId).toBe(deviceId);
    });
  });
});
