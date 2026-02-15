import { RouterConfig, DEFAULT_CONFIG } from '../types/config';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Configuration manager for router server
 */
export class ConfigManager {
  private config: RouterConfig;
  private configPath: string;
  private static CONFIG_DIR = path.join(os.homedir(), '.remote-cli-router');
  private static CONFIG_FILE = 'config.json';

  private constructor(config: RouterConfig, configPath: string) {
    this.config = config;
    this.configPath = configPath;
  }

  /**
   * Initialize configuration manager
   */
  static async initialize(): Promise<ConfigManager> {
    const configPath = path.join(ConfigManager.CONFIG_DIR, ConfigManager.CONFIG_FILE);

    // Ensure config directory exists
    await fs.mkdir(ConfigManager.CONFIG_DIR, { recursive: true });

    let config: RouterConfig;

    try {
      // Try to load existing config
      const content = await fs.readFile(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch (error: any) {
      // File doesn't exist or is invalid, use defaults
      if (error.code === 'ENOENT') {
        config = { ...DEFAULT_CONFIG };
        // Save default config
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      } else {
        throw error;
      }
    }

    return new ConfigManager(config, configPath);
  }

  /**
   * Get configuration value
   */
  get<K extends keyof RouterConfig>(key: K): RouterConfig[K];
  get<K extends keyof RouterConfig, SK extends keyof RouterConfig[K]>(
    key: K,
    subKey: SK
  ): RouterConfig[K][SK];
  get(key: any, subKey?: any): any {
    if (subKey !== undefined) {
      const parent = this.config[key as keyof RouterConfig];
      return parent ? (parent as any)[subKey] : undefined;
    }
    return this.config[key as keyof RouterConfig];
  }

  /**
   * Set configuration value
   */
  set<K extends keyof RouterConfig>(key: K, value: RouterConfig[K]): void;
  set<K extends keyof RouterConfig, SK extends keyof RouterConfig[K]>(
    key: K,
    subKey: SK,
    value: RouterConfig[K][SK]
  ): void;
  set(key: keyof RouterConfig, subKeyOrValue: any, value?: any): void {
    if (value !== undefined && typeof subKeyOrValue === 'string') {
      // Setting nested property
      const parent = { ...this.config[key] } as any;
      parent[subKeyOrValue] = value;
      this.config[key] = parent;
    } else {
      // Setting top-level property
      this.config[key] = subKeyOrValue;
    }
  }

  /**
   * Get all configuration
   */
  getAll(): RouterConfig {
    return { ...this.config };
  }

  /**
   * Check if Feishu is configured
   */
  isFeishuConfigured(): boolean {
    return !!(this.config.feishu.appId && this.config.feishu.appSecret);
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /**
   * Get configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Reset to default configuration
   */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
  }
}
