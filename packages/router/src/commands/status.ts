import axios from 'axios';
import { ConfigManager } from '../config/ConfigManager';
import { PidManager } from '../utils/PidManager';

/**
 * Show router server status
 */
export async function statusCommand(): Promise<void> {
  try {
    console.log('\n📊 Router Server Status\n');
    console.log('─'.repeat(50));

    const pidManager = new PidManager();
    const runningPid = await pidManager.getRunningPid();

    if (!runningPid) {
      console.log('Status:     ❌ Not Running');
      console.log('\nUse this command to start:');
      console.log('  remote-cli-router start\n');
      return;
    }

    console.log(`Status:     ✅ Running`);
    console.log(`PID:        ${runningPid}`);

    // Try to load configuration and get health status
    try {
      const config = await ConfigManager.initialize();
      const host = config.get('server', 'host');
      const port = config.get('server', 'port');

      console.log(`Host:       ${host}`);
      console.log(`Port:       ${port}`);

      // Try to fetch health status
      const healthUrl = `http://localhost:${port}/health`;
      try {
        const response = await axios.get(healthUrl, { timeout: 3000 });
        const health = response.data;

        console.log(`Connections: ${health.connections || 0}`);
        console.log(`Devices:    ${health.devices?.length || 0}`);

        if (health.devices && health.devices.length > 0) {
          console.log('\nConnected Devices:');
          health.devices.forEach((deviceId: string, index: number) => {
            console.log(`  ${index + 1}. ${deviceId}`);
          });
        }

        console.log(`\nUptime:     ${formatUptime(Date.now() - health.timestamp)}`);
      } catch (healthError: any) {
        console.log('\n⚠️  Could not fetch health status');
        console.log(`   API endpoint (${healthUrl}) is not responding`);
        console.log(`   The server process is running but may not be fully started`);
      }

      // Show configuration
      console.log('\nConfiguration:');
      const appId = config.get('feishu', 'appId');
      console.log(`  App ID:    ${appId ? maskString(appId) : 'Not configured'}`);
      console.log(`  Environment: ${config.get('server', 'nodeEnv')}`);

    } catch (configError) {
      console.log('\n⚠️  Could not load configuration');
    }

    console.log('\n' + '─'.repeat(50));
    console.log('\nAvailable commands:');
    console.log('  remote-cli-router stop    - Stop the server');
    console.log('  remote-cli-router config  - View/edit configuration\n');

  } catch (error: any) {
    console.error('❌ Failed to check status:', error.message);
    process.exit(1);
  }
}

/**
 * Mask sensitive string (show first and last few characters)
 */
function maskString(str: string): string {
  if (str.length <= 8) {
    return '***';
  }
  return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
