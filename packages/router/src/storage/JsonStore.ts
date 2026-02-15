import { BindingCode, UserBinding } from '../types';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface StoreData {
  bindingCodes: Record<string, BindingCode>;
  userBindings: Record<string, UserBinding>;
  deviceBindings: Record<string, UserBinding>;
}

/**
 * JSON file-based storage for bindings
 * Persists data across router restarts
 */
export class JsonStore {
  private storePath: string;
  private data: StoreData;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DELAY = 1000; // Debounce saves by 1 second

  constructor(storePath?: string) {
    this.storePath = storePath || path.join(os.homedir(), '.remote-cli-router', 'bindings.json');
    this.data = {
      bindingCodes: {},
      userBindings: {},
      deviceBindings: {},
    };
  }

  /**
   * Initialize store by loading data from disk
   */
  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.storePath), { recursive: true });

      // Try to load existing data
      try {
        const content = await fs.readFile(this.storePath, 'utf-8');
        this.data = JSON.parse(content);

        // Clean up expired binding codes on startup
        this.cleanupExpiredBindingCodes();
      } catch (error: any) {
        // File doesn't exist or is invalid, start with empty data
        if (error.code !== 'ENOENT') {
          console.warn('Failed to load bindings data, starting fresh:', error.message);
        }
        await this.save();
      }
    } catch (error) {
      console.error('Failed to initialize JSON store:', error);
      throw error;
    }
  }

  /**
   * Store binding code with expiration
   * @param code Binding code
   * @param bindingCode Binding code object
   */
  async setBindingCode(code: string, bindingCode: BindingCode): Promise<void> {
    this.data.bindingCodes[code] = bindingCode;
    await this.scheduleSave();
  }

  /**
   * Get binding code
   * @param code Binding code
   * @returns Binding code object or null if not found/expired
   */
  getBindingCode(code: string): BindingCode | null {
    const bindingCode = this.data.bindingCodes[code];

    if (!bindingCode) {
      return null;
    }

    // Check if expired
    if (Date.now() > bindingCode.expiresAt) {
      delete this.data.bindingCodes[code];
      this.scheduleSave();
      return null;
    }

    return bindingCode;
  }

  /**
   * Delete binding code
   * @param code Binding code
   */
  async deleteBindingCode(code: string): Promise<void> {
    delete this.data.bindingCodes[code];
    await this.scheduleSave();
  }

  /**
   * Set user binding
   * @param openId Feishu user open_id
   * @param binding User binding object
   */
  async setUserBinding(openId: string, binding: UserBinding): Promise<void> {
    this.data.userBindings[openId] = binding;
    this.data.deviceBindings[binding.deviceId] = binding;
    await this.scheduleSave();
  }

  /**
   * Get user binding
   * @param openId Feishu user open_id
   * @returns User binding or null if not found
   */
  getUserBinding(openId: string): UserBinding | null {
    return this.data.userBindings[openId] || null;
  }

  /**
   * Get device binding
   * @param deviceId Device unique identifier
   * @returns User binding or null if not found
   */
  getDeviceBinding(deviceId: string): UserBinding | null {
    return this.data.deviceBindings[deviceId] || null;
  }

  /**
   * Delete user binding
   * @param openId Feishu user open_id
   */
  async deleteUserBinding(openId: string): Promise<void> {
    const binding = this.data.userBindings[openId];
    if (binding) {
      delete this.data.userBindings[openId];
      delete this.data.deviceBindings[binding.deviceId];
      await this.scheduleSave();
    }
  }

  /**
   * Update user last active time
   * @param openId Feishu user open_id
   */
  async updateLastActive(openId: string): Promise<void> {
    const binding = this.data.userBindings[openId];
    if (binding) {
      binding.lastActiveAt = Date.now();
      this.data.userBindings[openId] = binding;
      this.data.deviceBindings[binding.deviceId] = binding;
      await this.scheduleSave();
    }
  }

  /**
   * Clean up expired binding codes
   */
  private cleanupExpiredBindingCodes(): void {
    const now = Date.now();
    let hasChanges = false;

    for (const [code, bindingCode] of Object.entries(this.data.bindingCodes)) {
      if (now > bindingCode.expiresAt) {
        delete this.data.bindingCodes[code];
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.scheduleSave();
    }
  }

  /**
   * Schedule a save operation (debounced)
   */
  private async scheduleSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    return new Promise((resolve) => {
      this.saveTimer = setTimeout(async () => {
        await this.save();
        resolve();
      }, this.SAVE_DELAY);
    });
  }

  /**
   * Save data to disk
   */
  private async save(): Promise<void> {
    try {
      const content = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.storePath, content, 'utf-8');
    } catch (error) {
      console.error('Failed to save bindings data:', error);
    }
  }

  /**
   * Force immediate save (for graceful shutdown)
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    this.data = {
      bindingCodes: {},
      userBindings: {},
      deviceBindings: {},
    };
    await this.save();
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
      bindingCodes: Object.keys(this.data.bindingCodes).length,
      userBindings: Object.keys(this.data.userBindings).length,
      deviceBindings: Object.keys(this.data.deviceBindings).length,
    };
  }
}
