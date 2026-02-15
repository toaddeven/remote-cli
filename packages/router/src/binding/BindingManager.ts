import Redis from 'ioredis';
import { BindingCode, UserBinding } from '../types';

/**
 * Binding Manager
 * Responsible for managing user and device binding relationships
 */
export class BindingManager {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  /**
   * Generate binding code
   * @param deviceId Device unique identifier
   * @param deviceName Device name
   * @returns Binding code object
   */
  async generateBindingCode(deviceId: string, deviceName: string): Promise<BindingCode> {
    // Generate binding code in format XXX-XXX-XXX
    const code = this.generateRandomCode();
    const now = Date.now();
    const bindingCode: BindingCode = {
      code,
      deviceId,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000 // Expires after 5 minutes
    };

    // Store binding code to Redis, set 5 minute expiration
    const key = `binding:code:${code}`;
    await this.redis.set(key, JSON.stringify(bindingCode));
    await this.redis.expire(key, 300); // 5 minutes = 300 seconds

    return bindingCode;
  }

  /**
   * Verify binding code
   * @param code Binding code
   * @returns Binding code object, returns null if invalid or expired
   */
  async verifyBindingCode(code: string): Promise<BindingCode | null> {
    const key = `binding:code:${code}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    const bindingCode: BindingCode = JSON.parse(data);

    // Check if expired
    if (Date.now() > bindingCode.expiresAt) {
      // Delete expired binding code
      await this.redis.del(key);
      return null;
    }

    return bindingCode;
  }

  /**
   * Bind user and device
   * @param openId Feishu user open_id
   * @param deviceId Device unique identifier
   * @param deviceName Device name
   */
  async bindUser(openId: string, deviceId: string, deviceName: string): Promise<void> {
    const now = Date.now();

    // Check if user already has a binding
    const existingBinding = await this.getUserBinding(openId);
    if (existingBinding) {
      // Delete old device binding
      await this.redis.del(`binding:device:${existingBinding.deviceId}`);
    }

    // Create new binding relationship
    const binding: UserBinding = {
      openId,
      deviceId,
      deviceName,
      boundAt: now,
      lastActiveAt: now
    };

    // Store user -> device mapping
    await this.redis.hmset(`binding:user:${openId}`, binding as any);

    // Store device -> user mapping (for device-side queries)
    await this.redis.hmset(`binding:device:${deviceId}`, {
      openId,
      deviceId,
      deviceName,
      boundAt: String(now)
    });
  }

  /**
   * Get user binding information
   * @param openId Feishu user open_id
   * @returns Binding information, returns null if not bound
   */
  async getUserBinding(openId: string): Promise<UserBinding | null> {
    const data = await this.redis.hgetall(`binding:user:${openId}`);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      openId: data.openId,
      deviceId: data.deviceId,
      deviceName: data.deviceName,
      boundAt: Number(data.boundAt),
      lastActiveAt: Number(data.lastActiveAt)
    };
  }

  /**
   * Get device binding information
   * @param deviceId Device unique identifier
   * @returns Binding information, returns null if not bound
   */
  async getDeviceBinding(deviceId: string): Promise<UserBinding | null> {
    const data = await this.redis.hgetall(`binding:device:${deviceId}`);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      openId: data.openId,
      deviceId: data.deviceId,
      deviceName: data.deviceName,
      boundAt: Number(data.boundAt),
      lastActiveAt: Number(data.lastActiveAt || data.boundAt)
    };
  }

  /**
   * Unbind user
   * @param openId Feishu user open_id
   */
  async unbindUser(openId: string): Promise<void> {
    const binding = await this.getUserBinding(openId);

    if (!binding) {
      return;
    }

    // Delete bidirectional binding
    await this.redis.del(`binding:user:${openId}`);
    await this.redis.del(`binding:device:${binding.deviceId}`);
  }

  /**
   * Update user last active time
   * @param openId Feishu user open_id
   */
  async updateLastActive(openId: string): Promise<void> {
    await this.redis.hset(
      `binding:user:${openId}`,
      'lastActiveAt',
      String(Date.now())
    );
  }

  /**
   * Generate random binding code (format: XXX-XXX-XXX)
   * @returns Binding code string
   */
  private generateRandomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = [];

    for (let i = 0; i < 3; i++) {
      let segment = '';
      for (let j = 0; j < 3; j++) {
        segment += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      segments.push(segment);
    }

    return segments.join('-');
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
