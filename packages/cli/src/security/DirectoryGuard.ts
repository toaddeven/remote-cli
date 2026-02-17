import path from 'path';
import os from 'os';

/**
 * Directory Security Guard
 * Responsible for validating path safety and preventing path traversal attacks
 */
export class DirectoryGuard {
  private allowedDirs: Set<string>;
  private homeDir: string;

  constructor(allowedDirectories: string[]) {
    this.allowedDirs = new Set(allowedDirectories);
    this.homeDir = os.homedir();
  }

  /**
   * Normalize path
   * @param targetPath Target path (supports ~, relative paths, absolute paths)
   * @param cwd Current working directory (for resolving relative paths)
   * @returns Normalized absolute path
   */
  normalizePath(targetPath: string, cwd?: string): string {
    if (!targetPath || targetPath.trim() === '') {
      throw new Error('Path cannot be empty');
    }

    let normalized: string;

    // Handle paths starting with ~
    if (targetPath.startsWith('~/')) {
      normalized = path.join(this.homeDir, targetPath.slice(2));
    }
    // Handle relative paths
    else if (targetPath.startsWith('./') || targetPath.startsWith('../')) {
      const basePath = cwd || process.cwd();
      normalized = path.resolve(basePath, targetPath);
    }
    // Handle absolute paths
    else if (path.isAbsolute(targetPath)) {
      normalized = path.resolve(targetPath);
    }
    // Treat other cases as relative paths
    else {
      const basePath = cwd || process.cwd();
      normalized = path.resolve(basePath, targetPath);
    }

    // Remove trailing slash
    if (normalized.endsWith(path.sep) && normalized !== path.sep) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  /**
   * Check if path is safe
   * @param targetPath Target path
   * @param cwd Current working directory
   * @returns Whether it is safe
   */
  isSafePath(targetPath: string, cwd?: string): boolean {
    try {
      const normalized = this.normalizePath(targetPath, cwd);

      // Check if path is a worktree of an allowed directory
      if (this.isWorktreeOfAllowedDirectory(normalized)) {
        return true;
      }

      // Check if it's a system directory
      const systemDirs = ['/etc', '/var', '/usr', '/bin', '/sbin', '/System', '/Library', '/boot', '/dev', '/proc', '/sys'];
      if (systemDirs.some(sysDir => normalized === sysDir || normalized.startsWith(sysDir + path.sep))) {
        return false;
      }

      // Check if outside user home directory (for absolute paths)
      if (path.isAbsolute(targetPath) && !targetPath.startsWith('~/')) {
        if (!normalized.startsWith(this.homeDir)) {
          return false;
        }
      }

      // Check if in allowed directories list
      if (this.allowedDirs.size === 0) {
        return false;
      }

      for (const allowedDir of this.allowedDirs) {
        const normalizedAllowedDir = this.normalizePath(allowedDir, cwd);

        // Check if it's the allowed directory itself or its subdirectory
        if (normalized === normalizedAllowedDir || normalized.startsWith(normalizedAllowedDir + path.sep)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if path is a worktree of an allowed directory
   * @param targetPath Normalized path to check
   * @returns true if path is worktree of allowed directory
   */
  private isWorktreeOfAllowedDirectory(targetPath: string): boolean {
    // Pattern: /path/to/allowed-dir.worktrees/session-{8-char-hex}
    const match = targetPath.match(/^(.+)\.worktrees[/\\]session-[a-f0-9]{8}$/);
    if (!match) {
      return false;
    }

    const mainRepoPath = match[1];

    // Check if main repo is in whitelist
    for (const allowedDir of this.allowedDirs) {
      const normalizedAllowedDir = this.normalizePath(allowedDir);
      if (mainRepoPath === normalizedAllowedDir) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolve working directory
   * @param targetPath Target path
   * @param cwd Current working directory
   * @returns Normalized working directory
   * @throws If path is not safe
   */
  resolveWorkingDirectory(targetPath: string, cwd?: string): string {
    const normalized = this.normalizePath(targetPath, cwd);

    if (!this.isSafePath(targetPath, cwd)) {
      throw new Error(`Path ${normalized} is not allowed. Please add it to the allowed directories list.`);
    }

    return normalized;
  }

  /**
   * Check if all paths are safe
   * @param paths Path list
   * @param cwd Current working directory
   * @returns Whether all are safe
   */
  areAllPathsSafe(paths: string[], cwd?: string): boolean {
    if (paths.length === 0) {
      return true;
    }

    return paths.every(p => this.isSafePath(p, cwd));
  }

  /**
   * Get allowed directories list
   * @returns Allowed directories list
   */
  getAllowedDirectories(): string[] {
    return Array.from(this.allowedDirs);
  }

  /**
   * Add allowed directory
   * @param directory Directory path
   */
  addAllowedDirectory(directory: string): void {
    if (!this.allowedDirs.has(directory)) {
      this.allowedDirs.add(directory);
    }
  }

  /**
   * Remove allowed directory
   * @param directory Directory path
   */
  removeAllowedDirectory(directory: string): void {
    this.allowedDirs.delete(directory);
  }
}
