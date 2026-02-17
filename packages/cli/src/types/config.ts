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
 * Server configuration
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
 * Worktree configuration
 */
export interface WorktreeConfig {
  /** Enable/disable worktree integration (default: true) */
  enabled: boolean;
  /** Auto-cleanup threshold in days (0 = never, default: 0) */
  autoCleanupDays: number;
  /** Base branch for worktrees (default: 'main') */
  baseBranch: string;
}

/**
 * Complete configuration
 */
export interface Config {
  deviceId?: string;
  openId?: string;
  serverUrl?: string;
  security: SecurityConfig;
  server: ServerConfig;
  worktree: WorktreeConfig;
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
  worktree: {
    enabled: true,
    autoCleanupDays: 0,
    baseBranch: 'main'
  }
};
