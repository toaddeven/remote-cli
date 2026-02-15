import { BindingCode, UserBinding } from '../types';

/**
 * In-memory storage for bindings
 * Replaces Redis for low-concurrency scenarios
 */
export class MemoryStore {
  private bindingCodes: Map<string, BindingCode> = new Map();
  private userBindings: Map<string, UserBinding> = new Map();
  private deviceBindings: Map<string, UserBinding> = new Map();

  /**
   * Store binding code with expiration
   * @param code Binding code
   * @param bindingCode Binding code object
   * @param ttlSeconds Time to live in seconds
   */
  setBindingCode(code: string, bindingCode: BindingCode, ttlSeconds: number): void {
    this.bindingCodes.set(code, bindingCode);

    // Auto-expire after TTL
    setTimeout(() => {
      this.bindingCodes.delete(code);
    }, ttlSeconds * 1000);
  }

  /**
   * Get binding code
   * @param code Binding code
   * @returns Binding code object or null if not found/expired
   */
  getBindingCode(code: string): BindingCode | null {
    const bindingCode = this.bindingCodes.get(code);

    if (!bindingCode) {
      return null;
    }

    // Check if expired
    if (Date.now() > bindingCode.expiresAt) {
      this.bindingCodes.delete(code);
      return null;
    }

    return bindingCode;
  }

  /**
   * Delete binding code
   * @param code Binding code
   */
  deleteBindingCode(code: string): void {
    this.bindingCodes.delete(code);
  }

  /**
   * Set user binding
   * @param openId Feishu user open_id
   * @param binding User binding object
   */
  setUserBinding(openId: string, binding: UserBinding): void {
    this.userBindings.set(openId, binding);
    this.deviceBindings.set(binding.deviceId, binding);
  }

  /**
   * Get user binding
   * @param openId Feishu user open_id
   * @returns User binding or null if not found
   */
  getUserBinding(openId: string): UserBinding | null {
    return this.userBindings.get(openId) || null;
  }

  /**
   * Get device binding
   * @param deviceId Device unique identifier
   * @returns User binding or null if not found
   */
  getDeviceBinding(deviceId: string): UserBinding | null {
    return this.deviceBindings.get(deviceId) || null;
  }

  /**
   * Delete user binding
   * @param openId Feishu user open_id
   */
  deleteUserBinding(openId: string): void {
    const binding = this.userBindings.get(openId);
    if (binding) {
      this.userBindings.delete(openId);
      this.deviceBindings.delete(binding.deviceId);
    }
  }

  /**
   * Update user last active time
   * @param openId Feishu user open_id
   */
  updateLastActive(openId: string): void {
    const binding = this.userBindings.get(openId);
    if (binding) {
      binding.lastActiveAt = Date.now();
      this.userBindings.set(openId, binding);
      this.deviceBindings.set(binding.deviceId, binding);
    }
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.bindingCodes.clear();
    this.userBindings.clear();
    this.deviceBindings.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    bindingCodes: number;
    userBindings: number;
    deviceBindings: number;
  } {
    return {
      bindingCodes: this.bindingCodes.size,
      userBindings: this.userBindings.size,
      deviceBindings: this.deviceBindings.size,
    };
  }
}
