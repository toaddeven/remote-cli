# @yu_robotics/remote-cli

Remote control your [Claude Code](https://claude.ai/code) CLI from anywhere using your mobile phone through Feishu (Lark) messaging.

## Features

- **Remote Control**: Control your local development environment from anywhere via mobile
- **Secure**: Directory whitelisting, command filtering, and device authentication
- **Mobile-Optimized**: Simplified commands and rich text formatting for Feishu
- **Claude Code Integration**: Full access to Claude Code's capabilities and context
- **Persistent Process**: Long-running Claude process with bidirectional streaming (no repeated spawn overhead)
- **Git Worktree Isolation**: Each session works in its own git branch and directory, keeping main branch clean

## Prerequisites

- **Node.js** >= 18.0.0
- **Claude Code CLI** installed and configured
- Access to a Feishu (Lark) bot connected to a [remote-cli-router](https://www.npmjs.com/package/@yu_robotics/remote-cli-router) server

## Installation

```bash
npm install -g @yu_robotics/remote-cli
```

## Quick Start

### 1. Initialize

```bash
remote-cli init --server https://your-router-server.com
```

### 2. Bind Device in Feishu

Send the binding code to the Feishu bot:

```
/bind ABC-123-XYZ
```

### 3. Configure Allowed Directories

```bash
remote-cli config add-dir ~/projects ~/work
```

### 4. Start the Service

```bash
remote-cli start
```

### 5. Send Commands via Feishu

```
Help me fix TypeScript errors in ~/projects/my-app
```

## Commands

| Command | Description |
|---------|-------------|
| `remote-cli init -s <url>` | Initialize and generate binding code |
| `remote-cli start` | Start the background service |
| `remote-cli stop` | Stop the service |
| `remote-cli status` | Check service status |
| `remote-cli config show` | View configuration |
| `remote-cli config add-dir <path>` | Add allowed directory |

## Feishu Bot Commands

| Command | Description |
|---------|-------------|
| `/cd <path>` | Change working directory |
| `/status` | Check connection status |
| `/c` or `/continue` | Continue previous conversation |
| `/r` or `/resume` | Resume from last session |
| `/clear` | Clear current session |
| `/main` or `/reset` | Return to main repository (exit worktree) |
| `/worktree list` | Show all worktrees |
| `/worktree cleanup [days]` | Remove worktrees older than N days (default: 7) |
| `/worktree remove <session-id>` | Remove specific worktree |
| `/help` | Show help |

## Git Worktree Integration

Each Claude Code session automatically creates an isolated git worktree to keep your main branch clean:

**Benefits:**
- Changes are made in separate branches (`remote-cli/session-{id}`)
- Experiments can be abandoned without affecting main
- Multiple sessions can work concurrently
- Easy to review changes before merging

**How it works:**
```
/Users/dev/my-project/           # Main repo (whitelisted)
/Users/dev/my-project.worktrees/
  ├── session-a3b4c5d6/          # Session 1
  └── session-b7c8d9e0/          # Session 2
```

**Configuration:**
```bash
# Enable/disable (default: enabled)
remote-cli config worktree.enabled true

# Base branch (default: 'main')
remote-cli config worktree.baseBranch main

# Auto-cleanup after N days (0 = disabled, default: 0)
remote-cli config worktree.autoCleanupDays 7
```

**Usage via Feishu:**
```
# Work normally - worktree created automatically
Fix the login bug in ~/projects/myapp

# List all worktrees
/worktree list

# Return to main when done
/main

# Cleanup old worktrees
/worktree cleanup 7
```

## Security

- **Directory whitelisting**: Only explicitly allowed directories are accessible
- **Command filtering**: Dangerous commands are automatically blocked
- **Device authentication**: Each device has a unique hardware-based ID
- **Binding codes**: Expire after 5 minutes

## Documentation

For full documentation including router server deployment, see the [project README](https://github.com/xiaoyu/remote-cli#readme).

## License

MIT
