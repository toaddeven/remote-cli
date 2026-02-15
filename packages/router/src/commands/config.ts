import { Command } from 'commander';
import { ConfigManager } from '../config/ConfigManager';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

/**
 * Interactive configuration command
 * Prompts user for required Feishu credentials and optional settings
 */
export async function configureCommand(): Promise<void> {
  const config = await ConfigManager.initialize();
  const rl = readline.createInterface({ input, output });

  console.log('\n📝 Router Configuration Setup\n');
  console.log('This will guide you through configuring your router server.');
  console.log('Press Enter to keep existing values (shown in brackets).\n');

  try {
    // Feishu App ID (required)
    const existingAppId = config.get('feishu', 'appId');
    const appIdPrompt = existingAppId
      ? `Feishu App ID [${existingAppId}]: `
      : 'Feishu App ID (required): ';
    const appId = await rl.question(appIdPrompt);
    if (appId.trim()) {
      config.set('feishu', 'appId', appId.trim());
    } else if (!existingAppId) {
      console.error('❌ App ID is required!');
      rl.close();
      process.exit(1);
    }

    // Feishu App Secret (required)
    const existingAppSecret = config.get('feishu', 'appSecret');
    const appSecretPrompt = existingAppSecret
      ? `Feishu App Secret [***${existingAppSecret.slice(-4)}]: `
      : 'Feishu App Secret (required): ';
    const appSecret = await rl.question(appSecretPrompt);
    if (appSecret.trim()) {
      config.set('feishu', 'appSecret', appSecret.trim());
    } else if (!existingAppSecret) {
      console.error('❌ App Secret is required!');
      rl.close();
      process.exit(1);
    }

    // Feishu Encrypt Key (optional)
    const existingEncryptKey = config.get('feishu', 'encryptKey');
    const encryptKeyPrompt = existingEncryptKey
      ? `Feishu Encrypt Key [${existingEncryptKey}]: `
      : 'Feishu Encrypt Key (optional, press Enter to skip): ';
    const encryptKey = await rl.question(encryptKeyPrompt);
    if (encryptKey.trim()) {
      config.set('feishu', 'encryptKey', encryptKey.trim());
    }

    // Feishu Verification Token (optional)
    const existingVerificationToken = config.get('feishu', 'verificationToken');
    const verificationTokenPrompt = existingVerificationToken
      ? `Feishu Verification Token [${existingVerificationToken}]: `
      : 'Feishu Verification Token (optional, press Enter to skip): ';
    const verificationToken = await rl.question(verificationTokenPrompt);
    if (verificationToken.trim()) {
      config.set('feishu', 'verificationToken', verificationToken.trim());
    }

    console.log('\n⚙️  Optional Settings (press Enter to use defaults)\n');

    // Server Port
    const existingPort = config.get('server', 'port');
    const portInput = await rl.question(`Server Port [${existingPort}]: `);
    if (portInput.trim()) {
      const port = parseInt(portInput.trim(), 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('❌ Invalid port number!');
        rl.close();
        process.exit(1);
      }
      config.set('server', 'port', port);
    }

    // Server Host
    const existingHost = config.get('server', 'host');
    const hostInput = await rl.question(`Server Host [${existingHost}]: `);
    if (hostInput.trim()) {
      config.set('server', 'host', hostInput.trim());
    }

    // WebSocket Heartbeat Interval
    const existingHeartbeat = config.get('websocket', 'heartbeatInterval');
    const heartbeatInput = await rl.question(
      `WebSocket Heartbeat Interval (ms) [${existingHeartbeat}]: `
    );
    if (heartbeatInput.trim()) {
      const interval = parseInt(heartbeatInput.trim(), 10);
      if (isNaN(interval) || interval < 1000) {
        console.error('❌ Heartbeat interval must be at least 1000ms!');
        rl.close();
        process.exit(1);
      }
      config.set('websocket', 'heartbeatInterval', interval);
    }

    await config.save();

    console.log('\n✅ Configuration saved successfully!');
    console.log(`📁 Config file: ${config.getConfigPath()}`);
    console.log('\nYou can now start the router with: remote-cli-router start\n');
  } catch (error) {
    console.error('❌ Configuration failed:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Show current configuration
 */
export async function showConfigCommand(): Promise<void> {
  const config = await ConfigManager.initialize();
  const allConfig = config.getAll();

  console.log('\n📋 Current Configuration:\n');
  console.log('Server:');
  console.log(`  Port: ${allConfig.server.port}`);
  console.log(`  Host: ${allConfig.server.host}`);
  console.log(`  Environment: ${allConfig.server.nodeEnv}`);

  console.log('\nFeishu:');
  console.log(`  App ID: ${allConfig.feishu.appId || '(not set)'}`);
  console.log(
    `  App Secret: ${allConfig.feishu.appSecret ? '***' + allConfig.feishu.appSecret.slice(-4) : '(not set)'}`
  );
  console.log(`  Encrypt Key: ${allConfig.feishu.encryptKey || '(not set)'}`);
  console.log(`  Verification Token: ${allConfig.feishu.verificationToken || '(not set)'}`);

  console.log('\nWebSocket:');
  console.log(`  Heartbeat Interval: ${allConfig.websocket.heartbeatInterval}ms`);
  console.log(`  Reconnect Delay: ${allConfig.websocket.reconnectDelay}ms`);

  console.log('\nSecurity:');
  console.log(`  Binding Code Expiry: ${allConfig.security.bindingCodeExpiry}ms`);
  console.log(`  Max Binding Attempts: ${allConfig.security.maxBindingAttempts}`);

  console.log(`\n📁 Config file: ${config.getConfigPath()}\n`);
}

/**
 * Reset configuration to defaults
 */
export async function resetConfigCommand(): Promise<void> {
  const config = await ConfigManager.initialize();
  const rl = readline.createInterface({ input, output });

  const confirm = await rl.question(
    '\n⚠️  This will reset all configuration to defaults. Continue? (y/N): '
  );
  rl.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  await config.reset();
  console.log('✅ Configuration reset to defaults.');
  console.log('Run "remote-cli-router config" to set up your router.\n');
}

/**
 * Register config commands
 */
export function registerConfigCommands(program: Command): void {
  const configCommand = program
    .command('config')
    .description('Configure router server settings');

  configCommand
    .command('setup')
    .description('Interactive configuration setup')
    .action(configureCommand);

  configCommand
    .command('show')
    .description('Show current configuration')
    .action(showConfigCommand);

  configCommand
    .command('reset')
    .description('Reset configuration to defaults')
    .action(resetConfigCommand);

  // Default action for 'config' without subcommand is 'setup'
  configCommand.action(configureCommand);
}
