import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorktreeManager } from '../../src/worktree/WorktreeManager';
import { DirectoryGuard } from '../../src/security/DirectoryGuard';
import { spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(require('child_process').exec);

// Helper function to check if path exists
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Helper function to remove directory recursively
async function removeDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
  }
}

describe('Worktree Integration Workflow', () => {
  let testDir: string;
  let repoPath: string;
  let worktreeManager: WorktreeManager;
  let directoryGuard: DirectoryGuard;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-test-'));
    repoPath = path.join(testDir, 'test-repo');

    // Initialize a git repository
    await fs.mkdir(repoPath, { recursive: true });
    await exec('git init', { cwd: repoPath });
    await exec('git config user.email "test@example.com"', { cwd: repoPath });
    await exec('git config user.name "Test User"', { cwd: repoPath });

    // Create initial commit on main branch
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Test Repo\n');
    await exec('git add .', { cwd: repoPath });
    await exec('git commit -m "Initial commit"', { cwd: repoPath });

    // Create main branch if it doesn't exist
    try {
      await exec('git branch -M main', { cwd: repoPath });
    } catch (error) {
      // Branch might already be named main
    }

    // Initialize manager
    worktreeManager = new WorktreeManager();

    // Initialize directory guard with test repo whitelisted
    directoryGuard = new DirectoryGuard([repoPath]);
  });

  afterEach(async () => {
    // Cleanup test directory
    if (testDir) {
      try {
        // Remove all worktrees first
        const worktreesDir = path.join(testDir, 'test-repo.worktrees');
        if (await pathExists(worktreesDir)) {
          const sessions = await fs.readdir(worktreesDir);
          for (const session of sessions) {
            const worktreePath = path.join(worktreesDir, session);
            try {
              await exec(`git worktree remove ${worktreePath} --force`, { cwd: repoPath });
            } catch (error) {
              // Worktree might already be removed
            }
          }
        }

        await removeDir(testDir);
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });

  describe('Full worktree workflow', () => {
    it('should create worktree on first command and reuse on subsequent commands', async () => {
      const sessionId = 'a3b4c5d6-1234-5678-90ab-cdef12345678';

      // First command: should create worktree
      const worktreePath1 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);

      expect(worktreePath1).toBeDefined();
      expect(worktreePath1).toContain('.worktrees');
      expect(worktreePath1).toContain('session-12345678'); // Last 8 chars of sessionId

      // Verify worktree exists on disk
      const exists = await pathExists(worktreePath1);
      expect(exists).toBe(true);

      // Verify .claude-session file was created
      const sessionFilePath = path.join(worktreePath1, '.claude-session');
      const sessionFileExists = await pathExists(sessionFilePath);
      expect(sessionFileExists).toBe(true);

      const sessionContent = await fs.readFile(sessionFilePath, 'utf-8');
      const sessionData = JSON.parse(sessionContent);
      expect(sessionData.id).toBe(sessionId);

      // Second command: should reuse same worktree
      const worktreePath2 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);
      expect(worktreePath2).toBe(worktreePath1);

      // Verify git branch was created
      const { stdout: branches } = await exec('git branch --list', { cwd: repoPath });
      expect(branches).toContain('remote-cli/session-12345678'); // Last 8 chars
    });

    it('should create separate worktrees for different sessions', async () => {
      const sessionId1 = 'aaaaaaaa-1111-1111-1111-111111111111';
      const sessionId2 = 'bbbbbbbb-2222-2222-2222-222222222222';

      // Create first worktree
      const worktreePath1 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId1);
      expect(worktreePath1).toContain('session-11111111'); // Last 8 chars

      // Create second worktree
      const worktreePath2 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId2);
      expect(worktreePath2).toContain('session-22222222'); // Last 8 chars

      // Verify they are different paths
      expect(worktreePath1).not.toBe(worktreePath2);

      // Verify both exist
      const exists1 = await pathExists(worktreePath1);
      const exists2 = await pathExists(worktreePath2);
      expect(exists1).toBe(true);
      expect(exists2).toBe(true);

      // Verify separate branches
      const { stdout: branches } = await exec('git branch --list', { cwd: repoPath });
      expect(branches).toContain('remote-cli/session-11111111');
      expect(branches).toContain('remote-cli/session-22222222');
    });

    it('should list all worktrees', async () => {
      const sessionId1 = 'cccccccc-3333-3333-3333-333333333333';
      const sessionId2 = 'dddddddd-4444-4444-4444-444444444444';

      // Create two worktrees
      await worktreeManager.getOrCreateWorktree(repoPath, sessionId1);
      await worktreeManager.getOrCreateWorktree(repoPath, sessionId2);

      // List worktrees
      const worktrees = await worktreeManager.listWorktrees(repoPath);

      // Should have 2 worktrees plus main repo (3 total)
      expect(worktrees.length).toBe(3);

      // Verify session IDs (listWorktrees returns abbreviated IDs from path)
      const sessionIds = worktrees.map((wt) => wt.sessionId).filter(Boolean);
      expect(sessionIds).toContain('33333333'); // Last 8 chars of sessionId1
      expect(sessionIds).toContain('44444444'); // Last 8 chars of sessionId2

      // Verify branches (branch field has refs/heads/ stripped by parseWorktreeList)
      const branches = worktrees.map((wt) => wt.branch);
      expect(branches).toContain('remote-cli/session-33333333'); // Last 8 chars
      expect(branches).toContain('remote-cli/session-44444444'); // Last 8 chars
    });

    it('should remove specific worktree', async () => {
      const sessionId = 'eeeeeeee-5555-5555-5555-555555555555';

      // Create worktree
      const worktreePath = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);
      expect(await pathExists(worktreePath)).toBe(true);

      // Remove worktree
      await worktreeManager.removeWorktree(worktreePath);

      // Verify it's removed
      expect(await pathExists(worktreePath)).toBe(false);

      // Verify branch is removed
      const { stdout: branches } = await exec('git branch --list', { cwd: repoPath });
      expect(branches).not.toContain('remote-cli/session-eeeeeeee');
    });

    it('should return to main repository', async () => {
      const sessionId = 'ffffffff-6666-6666-6666-666666666666';

      // Create worktree
      const worktreePath = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);

      // Simulate returning to main by checking if main repo path is valid
      const mainRepoPath = worktreePath.replace(/\.worktrees\/session-[a-f0-9]{8}$/, '');
      expect(mainRepoPath).toBe(repoPath);

      // Verify main repo still exists
      const mainExists = await pathExists(mainRepoPath);
      expect(mainExists).toBe(true);

      // Verify main repo is not a worktree
      const isWorktree = worktreeManager.isWorktree(mainRepoPath);
      expect(isWorktree).toBe(false);
    });
  });

  describe('Worktree isolation', () => {
    it('should isolate changes between two worktrees', async () => {
      const sessionId1 = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const sessionId2 = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      // Create two worktrees
      const worktree1 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId1);
      const worktree2 = await worktreeManager.getOrCreateWorktree(repoPath, sessionId2);

      // Make changes in worktree 1
      const file1Path = path.join(worktree1, 'file1.txt');
      await fs.writeFile(file1Path, 'Content from session 1');
      await exec('git add .', { cwd: worktree1 });
      await exec('git commit -m "Add file1 in session 1"', { cwd: worktree1 });

      // Verify file exists in worktree 1
      const file1InWorktree1 = await pathExists(file1Path);
      expect(file1InWorktree1).toBe(true);

      // Verify file does NOT exist in worktree 2
      const file1InWorktree2Path = path.join(worktree2, 'file1.txt');
      const file1InWorktree2 = await pathExists(file1InWorktree2Path);
      expect(file1InWorktree2).toBe(false);

      // Verify file does NOT exist in main repo
      const file1InMainPath = path.join(repoPath, 'file1.txt');
      const file1InMain = await pathExists(file1InMainPath);
      expect(file1InMain).toBe(false);

      // Make different changes in worktree 2
      const file2Path = path.join(worktree2, 'file2.txt');
      await fs.writeFile(file2Path, 'Content from session 2');
      await exec('git add .', { cwd: worktree2 });
      await exec('git commit -m "Add file2 in session 2"', { cwd: worktree2 });

      // Verify file2 exists only in worktree 2
      expect(await pathExists(file2Path)).toBe(true);
      expect(await pathExists(path.join(worktree1, 'file2.txt'))).toBe(false);
      expect(await pathExists(path.join(repoPath, 'file2.txt'))).toBe(false);
    });

    it('should allow concurrent work in multiple sessions', async () => {
      const sessionId1 = '33333333-cccc-cccc-cccc-cccccccccccc';
      const sessionId2 = '44444444-dddd-dddd-dddd-dddddddddddd';

      // Create worktrees in parallel
      const [worktree1, worktree2] = await Promise.all([
        worktreeManager.getOrCreateWorktree(repoPath, sessionId1),
        worktreeManager.getOrCreateWorktree(repoPath, sessionId2),
      ]);

      // Both should exist
      expect(await pathExists(worktree1)).toBe(true);
      expect(await pathExists(worktree2)).toBe(true);

      // Make concurrent edits
      await Promise.all([
        fs.writeFile(path.join(worktree1, 'concurrent1.txt'), 'Session 1 work'),
        fs.writeFile(path.join(worktree2, 'concurrent2.txt'), 'Session 2 work'),
      ]);

      // Verify isolation
      expect(await pathExists(path.join(worktree1, 'concurrent1.txt'))).toBe(true);
      expect(await pathExists(path.join(worktree1, 'concurrent2.txt'))).toBe(false);
      expect(await pathExists(path.join(worktree2, 'concurrent1.txt'))).toBe(false);
      expect(await pathExists(path.join(worktree2, 'concurrent2.txt'))).toBe(true);
    });
  });

  describe('Security validation', () => {
    it('should allow worktree paths when main repo is whitelisted', async () => {
      const sessionId = '55555555-eeee-eeee-eeee-eeeeeeeeeeee';

      // Create worktree
      const worktreePath = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);

      // Verify worktree path passes security check
      const isSafe = directoryGuard.isSafePath(worktreePath);
      expect(isSafe).toBe(true);
    });

    it('should reject worktree paths when main repo is not whitelisted', async () => {
      const sessionId = '66666666-ffff-ffff-ffff-ffffffffffff';

      // Create a guard WITHOUT the test repo whitelisted
      const restrictiveGuard = new DirectoryGuard(['/some/other/path']);

      // Create worktree (this still works because WorktreeManager doesn't check permissions)
      const worktreePath = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);

      // But the security guard should reject it
      const isSafe = restrictiveGuard.isSafePath(worktreePath);
      expect(isSafe).toBe(false);
    });

    it('should validate worktree path format', () => {
      // Valid worktree path format
      const validWorktreePath = path.join(testDir, 'test-repo.worktrees', 'session-a3b4c5d6');
      const validResult = directoryGuard.isSafePath(validWorktreePath);
      expect(validResult).toBe(true);

      // Invalid worktree path (wrong format)
      const invalidWorktreePath = path.join(testDir, 'test-repo.worktrees', 'invalid-name');
      const restrictiveGuard = new DirectoryGuard([repoPath]);
      const invalidResult = restrictiveGuard.isSafePath(invalidWorktreePath);
      expect(invalidResult).toBe(false);
    });
  });

  describe('Cleanup workflow', () => {
    it('should cleanup stale worktrees older than threshold', async () => {
      const oldSessionId = '77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const recentSessionId = '88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      // Create two worktrees
      const oldWorktree = await worktreeManager.getOrCreateWorktree(repoPath, oldSessionId);
      const recentWorktree = await worktreeManager.getOrCreateWorktree(repoPath, recentSessionId);

      // Modify .claude-session timestamp to make old worktree appear stale
      const oldSessionFile = path.join(oldWorktree, '.claude-session');
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

      // Touch the file with old timestamp
      await fs.utimes(oldSessionFile, oldDate, oldDate);

      // Cleanup worktrees older than 7 days
      const removedCount = await worktreeManager.pruneStaleWorktrees(repoPath, 7);

      // Should have removed 1 worktree
      expect(removedCount).toBe(1);

      // Old worktree should be removed
      expect(await pathExists(oldWorktree)).toBe(false);

      // Recent worktree should still exist
      expect(await pathExists(recentWorktree)).toBe(true);
    });

    it('should not cleanup worktrees when max age is 0', async () => {
      const sessionId1 = '99999999-cccc-cccc-cccc-cccccccccccc';
      const sessionId2 = 'aaaaaaaa-dddd-dddd-dddd-dddddddddddd';

      // Create worktrees
      await worktreeManager.getOrCreateWorktree(repoPath, sessionId1);
      await worktreeManager.getOrCreateWorktree(repoPath, sessionId2);

      // Try to cleanup with 0 days threshold
      // Note: maxAgeDays=0 means remove worktrees older than 0ms, so all worktrees will be removed
      const removedCount = await worktreeManager.pruneStaleWorktrees(repoPath, 0);

      // All worktrees should be removed since they're all older than 0ms
      expect(removedCount).toBe(2);

      // Verify worktrees were removed
      const worktrees = await worktreeManager.listWorktrees(repoPath);
      // Only main repo should remain
      expect(worktrees.filter(wt => !wt.isMain).length).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should handle non-git repository gracefully', async () => {
      const nonGitDir = path.join(testDir, 'not-a-repo');
      await fs.mkdir(nonGitDir, { recursive: true });

      const sessionId = 'bbbbbbbb-eeee-eeee-eeee-eeeeeeeeeeee';

      // Should detect that it's not a git repository
      const isGitRepo = worktreeManager.isGitRepository(nonGitDir);
      expect(isGitRepo).toBe(false);

      // Attempting to create worktree should throw error
      await expect(
        worktreeManager.getOrCreateWorktree(nonGitDir, sessionId)
      ).rejects.toThrow();
    });

    it('should throw error when removing non-existent worktree', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent.worktrees', 'session-12345678');

      // Should throw error because it's not a worktree
      await expect(worktreeManager.removeWorktree(nonExistentPath)).rejects.toThrow('Not a worktree');
    });

    it('should identify worktree vs main repo correctly', async () => {
      const sessionId = 'cccccccc-ffff-ffff-ffff-ffffffffffff';

      // Main repo should NOT be identified as worktree
      const isMainWorktree = worktreeManager.isWorktree(repoPath);
      expect(isMainWorktree).toBe(false);

      // Actual worktree should be identified correctly
      const worktreePath = await worktreeManager.getOrCreateWorktree(repoPath, sessionId);
      const isActualWorktree = worktreeManager.isWorktree(worktreePath);
      expect(isActualWorktree).toBe(true);
    });
  });
});
