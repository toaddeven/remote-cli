import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  sessionId: string | null;
  isMain: boolean;
}

/**
 * Git Worktree Manager
 * Manages git worktrees for isolating Claude Code sessions
 */
export class WorktreeManager {
  constructor() {
    // No parameters needed - will use current branch dynamically
  }

  /**
   * Create a new worktree for a session
   * @param mainRepoPath Path to the main repository
   * @param sessionId Session UUID
   * @returns Path to the created worktree
   */
  async createWorktree(mainRepoPath: string, sessionId: string): Promise<string> {
    // Generate session abbreviation (last 8 chars)
    const sessionAbbr = sessionId.slice(-8);
    const branchName = `remote-cli/session-${sessionAbbr}`;
    const worktreesDir = `${mainRepoPath}.worktrees`;
    const worktreePath = path.join(worktreesDir, `session-${sessionAbbr}`);

    // Ensure worktrees directory exists
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      // Verify it's actually a worktree
      if (this.isWorktree(worktreePath)) {
        return worktreePath;
      }
      // If it's a regular directory, remove it
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    // Prune stale worktree references before creating new one
    await this.pruneWorktreeReferences(mainRepoPath);

    // Get current branch to use as base
    const currentBranch = await this.getCurrentBranch(mainRepoPath);
    const baseBranch = currentBranch || 'HEAD';

    try {
      // Create worktree from current branch
      await this.execGit(
        ['worktree', 'add', '-b', branchName, worktreePath, baseBranch],
        { cwd: mainRepoPath }
      );
    } catch (error) {
      // If branch already exists, try without -b flag
      if (error instanceof Error && error.message.includes('already exists')) {
        await this.execGit(
          ['worktree', 'add', worktreePath, branchName],
          { cwd: mainRepoPath }
        );
      } else {
        throw error;
      }
    }

    // Save session file in worktree
    const sessionFile = path.join(worktreePath, '.claude-session');
    const sessionData = {
      id: sessionId,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

    return worktreePath;
  }

  /**
   * Get worktree path for a session
   * @param mainRepoPath Path to the main repository
   * @param sessionId Session UUID
   * @returns Worktree path if exists, null otherwise
   */
  getWorktreePath(mainRepoPath: string, sessionId: string): string | null {
    const sessionAbbr = sessionId.slice(-8);
    const worktreesDir = `${mainRepoPath}.worktrees`;
    const worktreePath = path.join(worktreesDir, `session-${sessionAbbr}`);

    if (fs.existsSync(worktreePath) && this.isWorktree(worktreePath)) {
      return worktreePath;
    }

    return null;
  }

  /**
   * Get existing worktree for session or create new one
   * @param mainRepoPath Path to the main repository
   * @param sessionId Session UUID
   * @returns Path to the worktree
   */
  async getOrCreateWorktree(mainRepoPath: string, sessionId: string): Promise<string> {
    const existingPath = this.getWorktreePath(mainRepoPath, sessionId);
    if (existingPath) {
      return existingPath;
    }

    return await this.createWorktree(mainRepoPath, sessionId);
  }

  /**
   * List all worktrees for a repository
   * @param mainRepoPath Path to the main repository
   * @returns Array of worktree information
   */
  async listWorktrees(mainRepoPath: string): Promise<WorktreeInfo[]> {
    try {
      const output = await this.execGit(
        ['worktree', 'list', '--porcelain'],
        { cwd: mainRepoPath }
      );
      return this.parseWorktreeList(output);
    } catch (error) {
      // If git worktree list fails, return empty array
      return [];
    }
  }

  /**
   * Remove a worktree
   * @param worktreePath Path to the worktree to remove
   * @param mainRepoPath Path to the main repository (for branch deletion)
   */
  async removeWorktree(worktreePath: string, mainRepoPath?: string): Promise<void> {
    if (!this.isWorktree(worktreePath)) {
      throw new Error(`Not a worktree: ${worktreePath}`);
    }

    // Get branch name before removing worktree
    const branchName = await this.getWorktreeBranch(worktreePath);

    // Remove worktree
    try {
      // Find main repo path if not provided
      if (!mainRepoPath) {
        mainRepoPath = await this.getMainRepoPath(worktreePath);
      }

      await this.execGit(
        ['worktree', 'remove', '--force', worktreePath],
        { cwd: mainRepoPath }
      );
    } catch (error) {
      // If git worktree remove fails, manually delete directory
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Delete branch if it's a remote-cli session branch
    if (branchName && branchName.startsWith('remote-cli/session-') && mainRepoPath) {
      try {
        await this.execGit(['branch', '-D', branchName], { cwd: mainRepoPath });
      } catch {
        // Ignore errors if branch doesn't exist or can't be deleted
      }
    }

    // Prune stale references
    if (mainRepoPath) {
      await this.pruneWorktreeReferences(mainRepoPath);
    }
  }

  /**
   * Check if a directory is a git worktree
   * @param dirPath Directory path to check
   * @returns true if directory is a worktree
   */
  isWorktree(dirPath: string): boolean {
    const gitFile = path.join(dirPath, '.git');
    if (!fs.existsSync(gitFile)) {
      return false;
    }

    const stats = fs.statSync(gitFile);
    if (stats.isFile()) {
      // Worktrees have .git as a file containing "gitdir: ..."
      const content = fs.readFileSync(gitFile, 'utf-8');
      return content.trim().startsWith('gitdir:');
    }

    return false;
  }

  /**
   * Check if a directory is a git repository
   * @param dirPath Directory path to check
   * @returns true if directory contains .git
   */
  isGitRepository(dirPath: string): boolean {
    const gitPath = path.join(dirPath, '.git');
    return fs.existsSync(gitPath);
  }

  /**
   * Prune stale worktrees older than specified age
   * @param mainRepoPath Path to the main repository
   * @param maxAgeDays Maximum age in days (default: 7)
   * @returns Number of worktrees removed
   */
  async pruneStaleWorktrees(mainRepoPath: string, maxAgeDays: number = 7): Promise<number> {
    const worktrees = await this.listWorktrees(mainRepoPath);
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let removedCount = 0;

    for (const worktree of worktrees) {
      // Skip main worktree
      if (worktree.isMain) {
        continue;
      }

      // Check if session file exists and its modification time
      const sessionFile = path.join(worktree.path, '.claude-session');
      if (fs.existsSync(sessionFile)) {
        const stats = fs.statSync(sessionFile);
        const age = now - stats.mtime.getTime();

        if (age > maxAgeMs) {
          try {
            await this.removeWorktree(worktree.path, mainRepoPath);
            removedCount++;
          } catch (error) {
            console.error(`Failed to remove stale worktree ${worktree.path}:`, error);
          }
        }
      }
    }

    return removedCount;
  }

  /**
   * Get main repository path from a worktree path
   * @param worktreePath Path to the worktree
   * @returns Main repository path
   */
  async getMainRepoPath(worktreePath: string): Promise<string> {
    // Parse .git file to find main repo
    const gitFile = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFile)) {
      throw new Error(`Not a git worktree: ${worktreePath}`);
    }

    const content = fs.readFileSync(gitFile, 'utf-8');
    const match = content.match(/gitdir:\s*(.+)/);
    if (!match) {
      throw new Error(`Invalid .git file format: ${worktreePath}`);
    }

    // The gitdir points to .git/worktrees/<name>
    // We need to get the parent .git directory
    const gitdir = match[1].trim();
    const absoluteGitdir = path.isAbsolute(gitdir) ? gitdir : path.resolve(worktreePath, gitdir);

    // Remove /worktrees/<name> to get main .git path
    const mainGitPath = absoluteGitdir.replace(/\/worktrees\/[^/]+$/, '');

    // Main repo is the parent of .git
    return path.dirname(mainGitPath);
  }

  /**
   * Get current branch name of a repository
   * @param repoPath Path to the repository
   * @returns Branch name or null if detached HEAD
   */
  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = await this.execGit(['branch', '--show-current'], { cwd: repoPath });
      const branch = result.trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  /**
   * Prune stale worktree references
   * @param mainRepoPath Path to the main repository
   */
  private async pruneWorktreeReferences(mainRepoPath: string): Promise<void> {
    try {
      await this.execGit(['worktree', 'prune'], { cwd: mainRepoPath });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get branch name of a worktree
   * @param worktreePath Path to the worktree
   * @returns Branch name or null if not found
   */
  private async getWorktreeBranch(worktreePath: string): Promise<string | null> {
    try {
      const output = await this.execGit(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: worktreePath }
      );
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Parse git worktree list --porcelain output
   * @param output Output from git worktree list --porcelain
   * @returns Array of worktree information
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const lines = output.trim().split('\n');
    let current: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        // Save previous worktree if exists
        if (current.path) {
          worktrees.push(this.finalizeWorktreeInfo(current));
        }
        current = { path: line.substring(9), isMain: false };
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        // Bare repository (not a working tree)
        current.isMain = true;
      } else if (line === '') {
        // Empty line separates worktrees
        if (current.path) {
          worktrees.push(this.finalizeWorktreeInfo(current));
        }
        current = {};
      }
    }

    // Add last worktree if exists
    if (current.path) {
      worktrees.push(this.finalizeWorktreeInfo(current));
    }

    return worktrees;
  }

  /**
   * Finalize worktree info by extracting session ID
   * @param info Partial worktree info
   * @returns Complete worktree info
   */
  private finalizeWorktreeInfo(info: Partial<WorktreeInfo>): WorktreeInfo {
    // Extract session ID from path
    const match = info.path!.match(/session-([a-f0-9]{8})$/);
    const sessionId = match ? match[1] : null;

    // Detect main worktree (first in list, no session ID in path)
    const isMain = info.isMain || !sessionId;

    return {
      path: info.path!,
      branch: info.branch || 'unknown',
      commit: info.commit || 'unknown',
      sessionId,
      isMain,
    };
  }

  /**
   * Execute git command
   * @param args Git command arguments
   * @param options Spawn options
   * @returns Command stdout
   */
  private async execGit(args: string[], options: { cwd: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        ...options,
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
}
