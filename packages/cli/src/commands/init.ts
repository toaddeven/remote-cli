import { ConfigManager } from '../config/ConfigManager';
import { machineId } from 'node-machine-id';
import axios from 'axios';
import ora from 'ora';
import os from 'os';
import type { Ora } from 'ora';

/**
 * Init command options
 */
export interface InitCommandOptions {
  /** Server URL (for router mode) */
  serverUrl?: string;
  /** Force re-initialization */
  force?: boolean;
  /** Allowed directories */
  allowedDirs?: string[];
  /** Direct mode (no router) */
  direct?: boolean;
  /** Feishu app ID (for direct mode) */
  feishuAppId?: string;
  /** Feishu app secret (for direct mode) */
  feishuAppSecret?: string;
}

/**
 * Init command result
 */
export interface InitCommandResult {
  success: boolean;
  bindingCode?: string;
  deviceId?: string;
  error?: string;
}

/**
 * Initialize the CLI in router mode
 */
async function initRouterMode(
  options: InitCommandOptions,
  config: ConfigManager,
  deviceId: string,
  spinner: Ora
): Promise<InitCommandResult> {
  // Validate server URL
  if (!options.serverUrl || !isValidUrl(options.serverUrl)) {
    spinner.fail('Invalid server URL');
    return {
      success: false,
      error: 'Invalid server URL format. Server URL is required for router mode.',
    };
  }

  // Request binding code from server
  spinner.text = 'Requesting binding code from server...';

  let response;
  try {
    response = await axios.post(
      `${options.serverUrl}/api/bind/request`,
      {
        deviceId,
        deviceName: os.hostname(),
        platform: os.platform(),
      },
      {
        timeout: 10000,
      }
    );
  } catch (error) {
    spinner.fail('Failed to connect to server');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }

  // Check server response
  if (!response.data.success) {
    spinner.fail('Server error');
    return {
      success: false,
      error: response.data.error || 'Server returned error',
    };
  }

  const { bindingCode } = response.data;

  // Save configuration
  await config.set('deviceId', deviceId);
  await config.set('serverUrl', options.serverUrl);

  return {
    success: true,
    bindingCode,
    deviceId,
  };
}

/**
 * Initialize the CLI in direct mode
 */
async function initDirectMode(
  options: InitCommandOptions,
  config: ConfigManager,
  deviceId: string,
  spinner: Ora
): Promise<InitCommandResult> {
  // Validate Feishu credentials if provided
  if (options.feishuAppId) {
    await config.set('feishu.appId', options.feishuAppId);
  }
  if (options.feishuAppSecret) {
    await config.set('feishu.appSecret', options.feishuAppSecret);
  }

  // Save configuration
  await config.set('deviceId', deviceId);
  await config.set('feishu.directMode', true);

  return {
    success: true,
    deviceId,
  };
}

/**
 * Initialize the CLI and request binding code from server
 */
export async function initCommand(
  options: InitCommandOptions
): Promise<InitCommandResult> {
  const spinner = ora('Initializing remote CLI...').start();

  try {
    const config = await ConfigManager.initialize();

    // Check if already initialized
    if (config.has('deviceId') && !options.force) {
      const existingDeviceId = config.get('deviceId');
      spinner.fail('Device already initialized');
      return {
        success: false,
        error: `Device already initialized with ID: ${existingDeviceId}. Use --force to re-initialize.`,
      };
    }

    // Generate device ID from machine ID
    let deviceId: string;
    try {
      const machine = await machineId();
      deviceId = `dev_${os.platform()}_${machine.substring(0, 12)}`;
    } catch (error) {
      spinner.fail('Failed to generate device ID');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate device ID',
      };
    }

    // Set allowed directories
    const allowedDirs = options.allowedDirs || [
      os.homedir(),
    ];
    await config.set('security.allowedDirectories', allowedDirs);

    // Initialize based on mode
    let result: InitCommandResult;
    if (options.direct) {
      result = await initDirectMode(options, config, deviceId, spinner);
    } else {
      result = await initRouterMode(options, config, deviceId, spinner);
    }

    if (result.success) {
      spinner.succeed('Initialization successful!');
    }

    return result;
  } catch (error) {
    spinner.fail('Initialization failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate URL format
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
