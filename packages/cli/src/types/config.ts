/**
 * Configuration type definitions
 */

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Allowed directory list (supports ~ and relative paths) */
  allowedDirectories: string[];
  /** Denied command patterns */
  deniedCommands: string[];
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
}

/**
 * Server configuration (for router mode)
 */
export interface ServerConfig {
  /** WebSocket server URL */
  url: string;
  /** Reconnect interval (milliseconds) */
  reconnectInterval: number;
  /** Heartbeat interval (milliseconds) */
  heartbeatInterval: number;
}

/**
 * Feishu configuration (for direct mode)
 */
export interface FeishuConfig {
  /** Feishu app ID */
  appId?: string;
  /** Feishu app secret */
  appSecret?: string;
  /** Whether direct mode is enabled */
  directMode?: boolean;
}

/**
 * Complete configuration
 */
export interface Config {
  deviceId?: string;
  openId?: string;
  serverUrl?: string;
  lastWorkingDirectory?: string;
  security: SecurityConfig;
  server: ServerConfig;
  feishu?: FeishuConfig;
  service?: {
    running?: boolean;
    startedAt?: number;
    stoppedAt?: number;
    pid?: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: Config = {
  security: {
    allowedDirectories: [],
    deniedCommands: [],
    maxConcurrentTasks: 1
  },
  server: {
    url: 'wss://localhost:3000',
    reconnectInterval: 5000,
    heartbeatInterval: 30000
  },
  feishu: {
    directMode: false
  }
};
