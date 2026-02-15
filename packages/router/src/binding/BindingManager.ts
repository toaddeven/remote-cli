import { BindingCode, UserBinding } from '../types';
import { JsonStore } from '../storage/JsonStore';

/**
 * Binding Manager
 * Responsible for managing user and device binding relationships
 */
export class BindingManager {
  private store: JsonStore;

  constructor(store: JsonStore) {
    this.store = store;
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

    // Store binding code
    await this.store.setBindingCode(code, bindingCode);

    return bindingCode;
  }

  /**
   * Verify binding code
   * @param code Binding code
   * @returns Binding code object, returns null if invalid or expired
   */
  async verifyBindingCode(code: string): Promise<BindingCode | null> {
    return this.store.getBindingCode(code);
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
      // Will be overwritten by setUserBinding
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
    await this.store.setUserBinding(openId, binding);
  }

  /**
   * Get user binding information
   * @param openId Feishu user open_id
   * @returns Binding information, returns null if not bound
   */
  async getUserBinding(openId: string): Promise<UserBinding | null> {
    return this.store.getUserBinding(openId);
  }

  /**
   * Get device binding information
   * @param deviceId Device unique identifier
   * @returns Binding information, returns null if not bound
   */
  async getDeviceBinding(deviceId: string): Promise<UserBinding | null> {
    return this.store.getDeviceBinding(deviceId);
  }

  /**
   * Unbind user
   * @param openId Feishu user open_id
   */
  async unbindUser(openId: string): Promise<void> {
    await this.store.deleteUserBinding(openId);
  }

  /**
   * Update user last active time
   * @param openId Feishu user open_id
   */
  async updateLastActive(openId: string): Promise<void> {
    await this.store.updateLastActive(openId);
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
   * Close and flush data
   */
  async close(): Promise<void> {
    await this.store.flush();
  }
}
