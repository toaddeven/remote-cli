# Remote CLI - Control Claude Code from Mobile via Feishu

[![npm version](https://img.shields.io/npm/v/@yu_robotics/remote-cli.svg)](https://www.npmjs.com/package/@yu_robotics/remote-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

Remote control your Claude Code CLI from anywhere using your mobile phone through Feishu (Lark) messaging. Continue coding when away from your computer with a mobile-friendly interface.

[中文文档](README_CN.md)

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Slash Commands](#slash-commands)
- [Security](#security)
- [Architecture](#architecture)
- [Router Server Deployment](#router-server-deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🌍 **Remote Control**: Control your local development environment from anywhere via mobile phone
- 🔒 **Secure**: Directory whitelisting, command filtering, and device authentication
- 📱 **Mobile-Optimized**: Simplified commands and rich text formatting for Feishu
- 🤖 **Claude Code Integration**: Full access to Claude Code's capabilities and context
- ⚡ **Persistent Process**: Long-running Claude process with bidirectional streaming via stdio
- 🌳 **Git Worktree Support**: Isolated workspaces for each session to keep main branch clean
- 🚀 **Easy Setup**: One-command installation and initialization

## Quick Start

```bash
# Install the CLI
npm install -g @yu_robotics/remote-cli

# Initialize and get binding code
remote-cli init --server https://your-router-server.com

# Add allowed directories
remote-cli config add-dir ~/projects

# Start the service
remote-cli start

# Now send the binding code to your Feishu bot
# And start coding from your phone!
```

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 18.0.0
- **npm** or **yarn** package manager
- **Claude Code CLI** installed and configured
- Access to a **Feishu (Lark) bot** (your team should deploy a router server)

## Installation

### From npm (Recommended)

```bash
npm install -g @yu_robotics/remote-cli
```

Or using yarn:

```bash
yarn global add @yu_robotics/remote-cli
```

### From Source

```bash
# Clone the repository
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# Install dependencies
npm install

# Build all packages
npm run build

# Link the CLI globally
cd packages/cli
npm link
```

## Usage

### 1. Initialize

Generate a unique device ID and binding code:

```bash
remote-cli init --server https://your-router-server.com
```

Example output:
```
✔ Initializing remote CLI...
✔ Device ID: dev_darwin_a1b2c3d4e5f6
✔ Binding code: ABC-123-XYZ

Please bind your device in Feishu:
1. Open Feishu and find the bot
2. Send: /bind ABC-123-XYZ
3. Wait for confirmation

Binding code expires in 5 minutes.
```

### 2. Bind Device in Feishu

Open your Feishu app and send the binding code to the bot:

```
/bind ABC-123-XYZ
```

### 3. Configure Security

Add allowed directories where Claude Code can operate:

```bash
# Add a single directory
remote-cli config add-dir ~/projects

# Add multiple directories
remote-cli config add-dir ~/work ~/code/company-repos

# View current configuration
remote-cli config show
```

### 4. Start Service

```bash
remote-cli start
```

### 5. Check Status

```bash
remote-cli status
```

### 6. Stop Service

```bash
remote-cli stop
```

## Slash Commands

Once connected, use these commands in Feishu:

| Command | Description |
|---------|-------------|
| `/cd <directory>` | Change working directory |
| `/c` or `/continue` | Continue previous conversation |
| `/r` or `/resume` | Resume from last session |
| `/clear` | Clear current session |
| `/status` | View device status and current directory |
| `/main` or `/reset` | Return to main repository directory |
| `/worktree list` | Show all worktrees |
| `/worktree cleanup [days]` | Remove old worktrees (default: 7 days) |
| `/help` | Show available commands |

### Example Workflow

1. **Switch to your project:**
   ```
   /cd ~/projects/my-app
   ```

2. **Ask Claude Code to help:**
   ```
   Review the authentication code in src/auth.ts and suggest improvements
   ```

3. **Continue the conversation:**
   ```
   /c
   Now implement those improvements
   ```

4. **Run tests:**
   ```
   Run the test suite and fix any failures
   ```

## Security

### Directory Whitelisting

Only directories explicitly added to the whitelist are accessible:

```bash
remote-cli config add-dir ~/safe/directory
```

### Command Filtering

Dangerous commands are automatically blocked:
- `rm -rf /`
- `sudo` operations on system files
- Direct disk writes (`dd`, `mkfs`)
- Fork bombs and other malicious patterns

### Device Authentication

- Each device generates a **unique ID** based on machine hardware
- Binding codes **expire after 5 minutes**
- Each user can only control **their bound devices**
- Unbind at any time: `/unbind` in Feishu

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────┐
│  Feishu Server  │         │  Developer A's Work PC       │
│                 │         │  (Mac/Linux)                 │
│  Developer A's  │◀───────▶│  ┌─────────────────────────┐ │
│  Phone          │         │  │  remote-cli (local)     │ │
│  Private Chat   │         │  │  - WebSocket Client     │ │
│  with Bot       │         │  │  - Claude Code Executor │ │
└─────────────────┘         │  │  - Security Directory   │ │
        │                   │  │    Guard                │ │
        │                   │  └──────────┬──────────────┘ │
        │                   │             ▼                 │
        │                   │  Local Claude Code CLI        │
        ▼                   │  (Using Agent SDK)            │
┌─────────────────┐         └──────────────────────────────┘
│  Router Server  │
│  (Team Deploy)  │         ┌──────────────────────────────┐
│  ┌───────────┐  │         │  Developer B's Work PC       │
│  │ Webhook   │  │         │  ┌─────────────────────────┐ │
│  │ Handler   │  │◀───────▶│  │  remote-cli (local)     │ │
│  └───────────┘  │         │  └─────────────────────────┘ │
│  ┌───────────┐  │         └──────────────────────────────┘
│  │WebSocket  │  │
│  │   Hub     │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  Binding  │  │
│  │  Registry │  │
│  └───────────┘  │
└─────────────────┘
```

## Router Server Deployment

> **Note**: Most users don't need to deploy the router server. Your team administrator should deploy one router server for the entire team to share.

See [Router Deployment Guide](#router-deployment) for detailed instructions.

Quick deployment:

```bash
# Install router server
npm install -g @yu_robotics/remote-cli-router

# Configure
remote-cli-router config

# Start
remote-cli-router start
```

## Troubleshooting

### Service won't start

```bash
# Check if already running
remote-cli status

# View logs
remote-cli logs

# Restart
remote-cli stop
remote-cli start
```

### Connection issues

```bash
# Check network
ping your-router-server.com

# Verify configuration
remote-cli config show

# Re-initialize
remote-cli init --server https://your-router-server.com --force
```

### Binding code expired

```bash
# Generate new binding code
remote-cli init --force
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Detailed Documentation

### Router Deployment

The router server manages message forwarding between Feishu and local clients.

#### Prerequisites

- A cloud server with at least **1 CPU core** and **1GB RAM**
- **Node.js** >= 18.0.0
- **A domain name** with SSL certificate (HTTPS required)
- **Feishu bot** created and configured

#### Installation

```bash
# Clone repository
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# Install dependencies
npm install

# Build router
npm run build -w @yu_robotics/remote-cli-router

# Link globally
cd packages/router
npm link
```

#### Configuration

```bash
remote-cli-router config
```

You will be prompted for:
- **Feishu App ID** (required)
- **Feishu App Secret** (required)
- Feishu Encrypt Key (optional)
- Feishu Verification Token (optional)
- Server Port (default: 3000)

#### Setup Feishu Bot

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app
3. Enable **Bot** capabilities
4. Configure permissions:
   - `im:message` - Receive messages
   - `im:message.p2p_msg` - Receive private messages
   - `im:message:send_as_bot` - Send messages as bot
5. Configure webhook URL: `https://your-domain.com/webhook/feishu`
6. Subscribe to events: `im.message.receive_v1`
7. Get credentials and publish the app

#### Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Configuration Reference

#### Local Client Config (`~/.remote-cli/config.json`)

```json
{
  "deviceId": "dev_darwin_xxx",
  "serverUrl": "https://your-router-server.com",
  "openId": "ou_xxx",
  "security": {
    "allowedDirectories": [
      "/Users/yourname/projects",
      "/Users/yourname/work"
    ]
  },
  "service": {
    "running": true,
    "startedAt": 1234567890,
    "pid": 12345
  },
  "worktree": {
    "enabled": true,
    "baseBranch": "main",
    "autoCleanupDays": 7
  }
}
```

### Development

```bash
# Clone repository
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Run CLI in development mode
npm run cli:dev

# Run router in development mode
npm run router:dev
```

### Support

- Issues: [GitHub Issues](https://github.com/xiaoyu/remote-cli/issues)
- Discussions: [GitHub Discussions](https://github.com/xiaoyu/remote-cli/discussions)
