import { ConfigManager } from '../config/ConfigManager';
import { JsonStore } from '../storage/JsonStore';
import { RouterServer } from '../server';

/**
 * Start the router server
 */
export async function startCommand(): Promise<void> {
  try {
    console.log('\n🚀 Starting remote CLI router server...\n');

    // Load configuration
    const config = await ConfigManager.initialize();

    // Validate required configuration
    const appId = config.get('feishu', 'appId');
    const appSecret = config.get('feishu', 'appSecret');

    if (!appId || !appSecret) {
      console.error('❌ Missing required configuration!');
      console.error('\nPlease run configuration first:');
      console.error('  remote-cli-router config\n');
      process.exit(1);
    }

    // Initialize storage
    const store = new JsonStore();
    await store.initialize();

    // Create and start server
    const server = new RouterServer(config, store);
    await server.start();

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n\nReceived ${signal}, shutting down gracefully...`);
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error: any) {
    console.error('❌ Failed to start router server:', error.message);
    process.exit(1);
  }
}
