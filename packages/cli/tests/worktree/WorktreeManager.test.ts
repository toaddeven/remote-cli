import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorktreeManager, WorktreeInfo } from '../../src/worktree/WorktreeManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

describe('WorktreeManager', () => {
  let tempDir: string;
  let testRepoPath: string;
  let worktreeManager: WorktreeManager;
  const testSessionId = 'abcdef12-3456-7890-abcd-ef1234567890';
  const sessionAbbr = 'ef1234567890'.slice(-8); // Last 8 chars

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
    testRepoPath = path.join(tempDir, 'test-repo');

    // Initialize a git repository for testing
    fs.mkdirSync(testRepoPath, { recursive: true });
    await execGit(['init'], testRepoPath);
    await execGit(['config', 'user.email', 'test@example.com'], testRepoPath);
    await execGit(['config', 'user.name', 'Test User'], testRepoPath);

    // Create an initial commit on main branch
    fs.writeFileSync(path.join(testRepoPath, 'README.md'), '# Test Repo\n');
    await execGit(['add', 'README.md'], testRepoPath);
    await execGit(['commit', '-m', 'Initial commit'], testRepoPath);
    await execGit(['branch', '-M', 'main'], testRepoPath);

    worktreeManager = new WorktreeManager('main');
  });

  afterEach(() => {
    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createWorktree', () => {
    it('should create worktree directory', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(worktreePath).toContain('.worktrees');
      expect(worktreePath).toContain(`session-${sessionAbbr}`);
    });

    it('should create branch with correct naming', async () => {
      await worktreeManager.createWorktree(testRepoPath, testSessionId);

      const branches = await execGit(['branch', '--list'], testRepoPath);
      expect(branches).toContain(`remote-cli/session-${sessionAbbr}`);
    });

    it('should save .claude-session file in worktree', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      const sessionFile = path.join(worktreePath, '.claude-session');
      expect(fs.existsSync(sessionFile)).toBe(true);

      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(sessionData.id).toBe(testSessionId);
      expect(sessionData.savedAt).toBeDefined();
    });

    it('should return existing worktree if already created', async () => {
      const worktreePath1 = await worktreeManager.createWorktree(testRepoPath, testSessionId);
      const worktreePath2 = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      expect(worktreePath1).toBe(worktreePath2);
    });
  });

  describe('getWorktreePath', () => {
    it('should return worktree path if exists', async () => {
      const createdPath = await worktreeManager.createWorktree(testRepoPath, testSessionId);
      const retrievedPath = worktreeManager.getWorktreePath(testRepoPath, testSessionId);

      expect(retrievedPath).toBe(createdPath);
    });

    it('should return null if worktree does not exist', () => {
      const retrievedPath = worktreeManager.getWorktreePath(testRepoPath, 'nonexistent-session-id');

      expect(retrievedPath).toBeNull();
    });
  });

  describe('getOrCreateWorktree', () => {
    it('should create worktree on first call', async () => {
      const worktreePath = await worktreeManager.getOrCreateWorktree(testRepoPath, testSessionId);

      expect(fs.existsSync(worktreePath)).toBe(true);
    });

    it('should return existing worktree on second call', async () => {
      const worktreePath1 = await worktreeManager.getOrCreateWorktree(testRepoPath, testSessionId);
      const worktreePath2 = await worktreeManager.getOrCreateWorktree(testRepoPath, testSessionId);

      expect(worktreePath1).toBe(worktreePath2);
    });
  });

  describe('listWorktrees', () => {
    it('should return main worktree when no additional worktrees exist', async () => {
      const worktrees = await worktreeManager.listWorktrees(testRepoPath);

      expect(worktrees.length).toBe(1);
      expect(worktrees[0].isMain).toBe(true);
      // Normalize paths using fs.realpathSync to handle symlinks (/private/var -> /var on macOS)
      expect(fs.realpathSync(worktrees[0].path)).toBe(fs.realpathSync(testRepoPath));
    });

    it('should list all worktrees including newly created ones', async () => {
      await worktreeManager.createWorktree(testRepoPath, testSessionId);

      const worktrees = await worktreeManager.listWorktrees(testRepoPath);

      expect(worktrees.length).toBe(2);

      const mainWorktree = worktrees.find(wt => wt.isMain);
      const sessionWorktree = worktrees.find(wt => !wt.isMain);

      expect(mainWorktree).toBeDefined();
      expect(sessionWorktree).toBeDefined();
      expect(sessionWorktree!.sessionId).toBe(sessionAbbr);
      expect(sessionWorktree!.branch).toBe(`remote-cli/session-${sessionAbbr}`);
    });

    it('should return empty array for non-git repository', async () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      const worktrees = await worktreeManager.listWorktrees(nonGitDir);

      expect(worktrees).toEqual([]);
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree directory', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      expect(fs.existsSync(worktreePath)).toBe(true);

      await worktreeManager.removeWorktree(worktreePath, testRepoPath);

      expect(fs.existsSync(worktreePath)).toBe(false);
    });

    it('should delete branch for session worktrees', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);
      await worktreeManager.removeWorktree(worktreePath, testRepoPath);

      const branches = await execGit(['branch', '--list'], testRepoPath);
      expect(branches).not.toContain(`remote-cli/session-${sessionAbbr}`);
    });

    it('should throw error if path is not a worktree', async () => {
      const nonWorktreePath = path.join(tempDir, 'not-a-worktree');
      fs.mkdirSync(nonWorktreePath, { recursive: true });

      await expect(
        worktreeManager.removeWorktree(nonWorktreePath, testRepoPath)
      ).rejects.toThrow('Not a worktree');
    });
  });

  describe('isWorktree', () => {
    it('should return true for worktree directories', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      expect(worktreeManager.isWorktree(worktreePath)).toBe(true);
    });

    it('should return false for main repository', () => {
      expect(worktreeManager.isWorktree(testRepoPath)).toBe(false);
    });

    it('should return false for non-git directories', () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      expect(worktreeManager.isWorktree(nonGitDir)).toBe(false);
    });
  });

  describe('isGitRepository', () => {
    it('should return true for git repositories', () => {
      expect(worktreeManager.isGitRepository(testRepoPath)).toBe(true);
    });

    it('should return true for worktrees', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      expect(worktreeManager.isGitRepository(worktreePath)).toBe(true);
    });

    it('should return false for non-git directories', () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      expect(worktreeManager.isGitRepository(nonGitDir)).toBe(false);
    });
  });

  describe('pruneStaleWorktrees', () => {
    it('should remove worktrees older than threshold', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      // Modify the session file's mtime to make it appear old
      const sessionFile = path.join(worktreePath, '.claude-session');
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      fs.utimesSync(sessionFile, oldDate, oldDate);

      const removedCount = await worktreeManager.pruneStaleWorktrees(testRepoPath, 7);

      expect(removedCount).toBe(1);
      expect(fs.existsSync(worktreePath)).toBe(false);
    });

    it('should preserve recent worktrees', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      const removedCount = await worktreeManager.pruneStaleWorktrees(testRepoPath, 7);

      expect(removedCount).toBe(0);
      expect(fs.existsSync(worktreePath)).toBe(true);
    });

    it('should not remove main worktree', async () => {
      const removedCount = await worktreeManager.pruneStaleWorktrees(testRepoPath, 0);

      expect(removedCount).toBe(0);
      expect(fs.existsSync(testRepoPath)).toBe(true);
    });
  });

  describe('getMainRepoPath', () => {
    it('should return main repository path from worktree', async () => {
      const worktreePath = await worktreeManager.createWorktree(testRepoPath, testSessionId);

      const mainRepoPath = await worktreeManager.getMainRepoPath(worktreePath);

      // Normalize paths using fs.realpathSync to handle symlinks (/private/var -> /var on macOS)
      expect(fs.realpathSync(mainRepoPath)).toBe(fs.realpathSync(testRepoPath));
    });

    it('should throw error for non-worktree paths', async () => {
      const nonWorktreePath = path.join(tempDir, 'not-a-worktree');
      fs.mkdirSync(nonWorktreePath, { recursive: true });

      await expect(
        worktreeManager.getMainRepoPath(nonWorktreePath)
      ).rejects.toThrow('Not a git worktree');
    });
  });
});

/**
 * Helper function to execute git commands
 */
async function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed (exit ${code}): ${stderr}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}
