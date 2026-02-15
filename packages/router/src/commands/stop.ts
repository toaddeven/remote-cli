import { PidManager } from '../utils/PidManager';

/**
 * Stop the router server
 */
export async function stopCommand(): Promise<void> {
  console.log('\n🛑 Stopping router server...\n');

  const pidManager = new PidManager();

  try {
    const runningPid = await pidManager.getRunningPid();

    if (!runningPid) {
      console.log('❌ Router server is not running');
      console.log('\nUse this command to start:');
      console.log('  remote-cli-router start\n');
      process.exit(1);
    }

    console.log(`Found running server (PID: ${runningPid})`);
    console.log('Sending shutdown signal...');

    try {
      // Send SIGTERM for graceful shutdown
      process.kill(runningPid, 'SIGTERM');

      // Wait for process to exit (max 10 seconds)
      const maxWaitTime = 10000;
      const startTime = Date.now();

      while (pidManager.isProcessRunning(runningPid)) {
        if (Date.now() - startTime > maxWaitTime) {
          console.log('\n⚠️  Process did not stop gracefully, sending SIGKILL...');
          process.kill(runningPid, 'SIGKILL');
          await new Promise(resolve => setTimeout(resolve, 500));
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Clean up PID file
      await pidManager.removePid();

      console.log('✅ Router server stopped successfully\n');
    } catch (error: any) {
      if (error.code === 'ESRCH') {
        // Process doesn't exist
        await pidManager.removePid();
        console.log('✅ Process already stopped, cleaned up PID file\n');
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.log(`❌ Failed to stop router server: ${error.message}\n`);
    process.exit(1);
  }
}
