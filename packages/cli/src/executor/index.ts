import { DirectoryGuard } from '../security/DirectoryGuard';
import { ClaudeExecutor } from './ClaudeExecutor';
import { ClaudePersistentExecutor } from './ClaudePersistentExecutor';

export type { ClaudeExecuteOptions, ClaudeExecuteResult } from './ClaudeExecutor';
export type { PersistentClaudeOptions, PersistentClaudeResult } from './ClaudePersistentExecutor';
export { ClaudeExecutor } from './ClaudeExecutor';
export { ClaudePersistentExecutor } from './ClaudePersistentExecutor';

/**
 * Check if we're running inside a Claude Code session
 */
function isRunningInsideClaudeCode(): boolean {
  // Check for CLAUDECODE environment variable
  if (process.env.CLAUDECODE) {
    return true;
  }

  // Check for other indicators
  if (process.env.CLAUDE_CODE) {
    return true;
  }

  return false;
}

/**
 * Executor type
 */
export type ExecutorType = 'persistent' | 'spawn' | 'auto';

/**
 * Create an appropriate Claude executor
 *
 * @param directoryGuard Directory guard instance
 * @param type Executor type: 'persistent' (long-running process), 'spawn' (one-shot process), or 'auto' (choose based on environment)
 * @returns Executor instance
 */
export function createClaudeExecutor(
  directoryGuard: DirectoryGuard,
  type: ExecutorType = 'auto'
): ClaudeExecutor | ClaudePersistentExecutor {
  if (type === 'auto') {
    // Auto-detect: use spawn mode if running inside Claude Code to avoid nested session error
    if (isRunningInsideClaudeCode()) {
      console.log('[ExecutorFactory] Detected nested Claude Code session, using spawn mode');
      return new ClaudeExecutor(directoryGuard);
    }
    // Otherwise use persistent mode
    console.log('[ExecutorFactory] Using persistent mode for better performance');
    return new ClaudePersistentExecutor(directoryGuard);
  }

  if (type === 'persistent') {
    return new ClaudePersistentExecutor(directoryGuard);
  }

  return new ClaudeExecutor(directoryGuard);
}
