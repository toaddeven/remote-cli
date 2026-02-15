import { ConfigManager } from '../config/ConfigManager';
import { WebSocketClient } from '../client/WebSocketClient';
import { ClaudeExecutor } from '../executor/ClaudeExecutor';
import { MessageHandler } from '../client/MessageHandler';
import { DirectoryGuard } from '../security/DirectoryGuard';
import ora from 'ora';

/**
 * Start command options
 */
export interface StartCommandOptions {
  /** Run as daemon */
  daemon?: boolean;
}

/**
 * Start command result
 */
export interface StartCommandResult {
  success: boolean;
  daemonMode?: boolean;
  error?: string;
}

/**
 * Start the remote CLI service
 */
export async function startCommand(
  options: StartCommandOptions
): Promise<StartCommandResult> {
  const spinner = ora('Starting remote CLI service...').start();

  try {
    const config = await ConfigManager.initialize();

    // Check if initialized
    if (!config.has('deviceId')) {
      spinner.fail('Device not initialized');
      return {
        success: false,
        error: 'Device not initialized. Please run "remote-cli init" first.',
      };
    }

    // Get configuration
    const allConfig = config.getAll();
    const { deviceId, serverUrl, security, service } = allConfig;

    // Validate configuration
    if (!deviceId) {
      spinner.fail('Missing deviceId');
      return {
        success: false,
        error: 'Configuration error: deviceId is missing',
      };
    }

    if (!serverUrl) {
      spinner.fail('Missing serverUrl');
      return {
        success: false,
        error: 'Configuration error: serverUrl is missing',
      };
    }

    if (!security?.allowedDirectories || security.allowedDirectories.length === 0) {
      spinner.fail('Missing allowedDirectories');
      return {
        success: false,
        error: 'Configuration error: allowedDirectories is missing',
      };
    }

    // Initialize components
    spinner.text = 'Initializing components...';

    const directoryGuard = new DirectoryGuard(security.allowedDirectories);
    const executor = new ClaudeExecutor(directoryGuard);

    // Create WebSocket URL
    const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws';
    const wsClient = new WebSocketClient(wsUrl, deviceId);

    const messageHandler = new MessageHandler(wsClient, executor, directoryGuard);

    // Setup event handlers
    wsClient.on('connected', () => {
      console.log('✅ Connected to server');
    });

    wsClient.on('disconnected', () => {
      console.log('⚠️  Disconnected from server');
    });

    wsClient.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });

    wsClient.on('message', async (message) => {
      await messageHandler.handleMessage(message);
    });

    // Connect to server
    spinner.text = 'Connecting to server...';
    try {
      await wsClient.connect(wsUrl);
    } catch (error) {
      spinner.fail('Connection failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }

    // Save service state
    await config.set('service.running', true);
    await config.set('service.startedAt', Date.now());
    if (options.daemon) {
      await config.set('service.pid', process.pid);
    }

    spinner.succeed(
      options.daemon
        ? 'Remote CLI service started in daemon mode'
        : 'Remote CLI service started'
    );

    return {
      success: true,
      daemonMode: options.daemon,
    };
  } catch (error) {
    spinner.fail('Failed to start service');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
