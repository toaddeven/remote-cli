# Remote CLI - Control Claude Code from Mobile via Feishu

Remote control your Claude Code CLI from anywhere using your mobile phone through Feishu (Lark) messaging. Continue coding when away from your computer with a mobile-friendly interface.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Local Client Deployment](#local-client-deployment)
- [Usage](#usage)
- [Router Server Deployment](#router-server-deployment)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Features

- 🌍 **Remote Control**: Control your local environment from anywhere via mobile phone
- 🔒 **Secure**: Directory whitelisting, command filtering, and device authentication
- 📱 **Mobile-Optimized**: Simplified commands and rich text formatting for Feishu
- 🤖 **Claude Code Integration**: Full access to Claude Code's capabilities and context
- ⚡ **Persistent Process**: Long-running Claude process with bidirectional streaming via stdio (no repeated spawn overhead)
- 🚀 **Easy Setup**: One-command installation and initialization

## Prerequisites

Before you begin, ensure you have:

- **Node.js** >= 18.0.0
- **npm** or **yarn** package manager
- **Claude Code CLI** installed and configured (see [Claude Code documentation](https://claude.ai/code))
- Access to a **Feishu (Lark) bot** for messaging

## Local Client Deployment

The local client runs on your development machine and connects to the router server. Most users only need this part.

### 1. Installation

#### Option A: Install from npm (After Publishing)

Once the package is published to npm, you can install it globally:

```bash
npm install -g @xiaoyu/remote-cli
```

Or using yarn:

```bash
yarn global add @xiaoyu/remote-cli
```

#### Option B: Install from Source (Local Development)

If you're installing from source code before npm publishing:

```bash
# Clone the repository
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# Install dependencies
npm install

# Build the CLI package
npm run build -w @xiaoyu/remote-cli

# Link the package globally for local development
cd packages/cli
npm link

# Verify installation
remote-cli --version
```

Alternatively, install directly from the built package:

```bash
# After building, install globally from the package directory
cd packages/cli
npm install -g .
```

To uninstall the locally installed version later:

```bash
npm uninstall -g @xiaoyu/remote-cli
# or if you used npm link:
cd packages/cli
npm unlink
```

### 2. Initialization

Initialize the CLI and generate a binding code:

```bash
remote-cli init --server https://your-router-server.com
# Or use the short form:
remote-cli init -s https://your-router-server.com
```

This command will:
- Generate a unique device ID based on your machine
- Create a binding code (e.g., `ABC-123-XYZ`)
- Initialize the configuration file at `~/.remote-cli/config.json`
- Set up default security settings

**Example output:**
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

### 3. Bind Device in Feishu

Open your Feishu app and send the binding code to the bot:

```
/bind ABC-123-XYZ
```

You'll receive a confirmation message when successfully bound.

### 4. Configure Security Settings

Add allowed directories where Claude Code can operate:

```bash
# Add a single directory
remote-cli config add-dir ~/projects

# Add multiple directories
remote-cli config add-dir ~/work ~/code/company-repos
```

View current configuration:

```bash
remote-cli config show
```

**Important**: Only directories in the whitelist can be accessed. This prevents accidental operations outside your project folders.

### 5. Start the Service

Start the remote CLI service as a background daemon:

```bash
remote-cli start
```

**Example output:**
```
✔ Starting remote CLI service...
✔ Connected to router server
✔ Service started (PID: 12345)
✔ Ready to receive commands from Feishu
```

The service will:
- Run in the background
- Auto-reconnect on network interruptions
- Start automatically on system boot (optional, see below)

### 6. Check Status

Verify the service is running:

```bash
remote-cli status
```

**Example output:**
```
Remote CLI Status:
  Status: Running ✓
  Device ID: dev_darwin_a1b2c3d4e5f6
  Server: https://your-router-server.com
  Connected: Yes
  Uptime: 2 hours 15 minutes
  Bound User: ou_xxx

Security Settings:
  Allowed Directories:
    - /Users/yourname/projects
    - /Users/yourname/work
```

### 7. Optional: Enable Auto-Start on Boot

To start the service automatically when your computer boots:

```bash
remote-cli autostart enable
```

To disable auto-start:

```bash
remote-cli autostart disable
```

### 8. Stop the Service

When needed, stop the service:

```bash
remote-cli stop
```

## Usage

Once the local client is running and bound to your Feishu account, you can control Claude Code from your mobile phone.

### Basic Commands

Send messages to the Feishu bot to interact with Claude Code:

**Execute Claude Code commands:**
```
Help me fix TypeScript errors in ~/projects/my-app
```

**Change working directory:**
```
/cd ~/projects/another-app
```

**Check status:**
```
/status
```

**Continue previous conversation:**
```
/c
```
or
```
/continue
```

**Resume from last session:**
```
/r
```
or
```
/resume
```

**Clear current session:**
```
/clear
```

**Get help:**
```
/help
```

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

### Security Notes

- Commands are only executed in **allowed directories**
- Dangerous bash commands are **automatically blocked**
- Every command is executed in a **sandboxed environment**
- You can only control **your own device**

## Router Server Deployment

> **Note**: Most users don't need to deploy the router server. Your team administrator should deploy one router server for the entire team to share.

The router server manages message forwarding between Feishu and local clients. It should be deployed on a cloud server accessible to all team members.

### Prerequisites

- A cloud server with at least **1 CPU core** and **1GB RAM**
- **Node.js** >= 18.0.0
- **A domain name** with SSL certificate (HTTPS required for Feishu webhooks)
- **Feishu bot** created and configured
- No external database required (uses built-in JSON file storage)

### 1. Clone Repository

```bash
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build and Link Router Server

Build the router package and create a global command:

```bash
cd packages/router
npm run build
npm link
```

This creates a global `remote-cli-router` command. Verify the installation:

```bash
which remote-cli-router
# Should show the command path

remote-cli-router --help
# Should display available commands
```

### 4. Configure Router Server

Run the interactive configuration:

```bash
remote-cli-router config
```

You will be prompted for:
- **Feishu App ID** (required)
- **Feishu App Secret** (required)
- Feishu Encrypt Key (optional)
- Feishu Verification Token (optional)
- Server Port (default: 3000)
- Server Host (default: 0.0.0.0)
- WebSocket Heartbeat Interval (default: 30000ms)

Configuration will be saved to `~/.remote-cli-router/config.json`.

**View current configuration:**
```bash
remote-cli-router config show
```

**Reset to defaults:**
```bash
remote-cli-router config reset
```

### 5. Setup Feishu Bot

1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create a new app (or use existing)
3. Enable **Bot** capabilities
4. Configure permissions:
   - `im:message` - Receive messages
   - `im:message.p2p_msg` - Receive private messages
   - `im:message:send_as_bot` - Send messages as bot
5. Configure webhook URL: `https://your-domain.com/webhook/feishu`
6. Subscribe to events: `im.message.receive_v1`
7. Get credentials (App ID, App Secret, Encrypt Key, Verification Token)
8. Publish the app

### 6. Start the Router Server

Start the router server:

```bash
remote-cli-router start
```

The server will:
- Start HTTP server on configured port (default: 3000)
- Start WebSocket server on `/ws` endpoint
- Begin accepting connections from local clients
- Handle Feishu webhook callbacks at `/webhook/feishu`

For development mode with auto-reload:

```bash
npm run router:dev
```

To run in the background with PM2:

```bash
pm2 start remote-cli-router --name router -- start
pm2 logs router
```

#### Docker Deployment

You can containerize the router server with Docker:

```bash
docker-compose up -d
```

The router uses JSON file storage (no external database needed), so make sure to mount a persistent volume for `~/.remote-cli-router/`.

### 8. Configure Reverse Proxy (Nginx)

Create Nginx configuration for SSL:

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

Reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 9. Verify Router Server

Check if the server is running:

```bash
curl https://your-domain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "connections": 0
}
```

## Security

### Directory Whitelisting

Only directories explicitly added to the whitelist are accessible:

```bash
remote-cli config add-dir ~/safe/directory
```

Attempting to access directories outside the whitelist will be **blocked**.

### Command Filtering

Dangerous commands are automatically blocked, including:
- `rm -rf /`
- `sudo` operations on system files
- Direct disk writes (`dd`, `mkfs`)
- Fork bombs and other malicious patterns

### Device Authentication

- Each device generates a **unique ID** based on machine hardware
- Binding codes **expire after 5 minutes**
- Each user can only control **their bound devices**
- Unbind at any time: `/unbind` in Feishu

### Best Practices

1. **Use specific directories**: Only add project folders to the whitelist
2. **Regular audits**: Review allowed directories periodically
3. **Separate accounts**: Use different Feishu accounts for work and personal
4. **Monitor logs**: Check `remote-cli logs` for suspicious activity

## Technical Details

### Claude Process Execution Modes

The CLI supports two execution modes for Claude Code:

#### 1. Persistent Mode (Default)

Uses `--input-format=stream-json` and `--output-format=stream-json` to maintain a long-running Claude process:

- **Process**: Starts Claude once and keeps it running
- **Communication**: Bidirectional JSON streaming via stdin/stdout
- **Benefits**: No process spawn overhead, faster response times, maintains conversation context seamlessly
- **Auto-detection**: Automatically falls back to spawn mode if running inside a Claude Code session (to avoid nested session errors)

```typescript
// The executor uses stream-json format for real-time communication
const args = [
  '--input-format=stream-json',
  '--output-format=stream-json',
  '--include-partial-messages',
];
```

#### 2. Spawn Mode (Fallback)

Uses `--print` mode with `--resume` for one-shot execution:

- **Process**: Spawns a new Claude process for each command
- **Communication**: Standard output capture
- **Use case**: Used when running inside Claude Code or when persistent mode fails

### Session Management

Sessions are automatically persisted using:

1. **Local session file**: `.claude-session` in the working directory
2. **Claude's native sessions**: Stored in `~/.claude/sessions/`

When resuming, the executor:
1. Checks the local session file first
2. Falls back to the most recently modified session in Claude's sessions directory
3. Creates a new session if none exists

## Troubleshooting

### Local Client Issues

**Service won't start:**
```bash
# Check if port is already in use
remote-cli status

# View detailed logs
remote-cli logs

# Try restarting
remote-cli stop
remote-cli start
```

**Connection issues:**
```bash
# Check network connectivity
ping your-router-server.com

# Verify server URL configuration
remote-cli config show

# Re-initialize if needed
remote-cli init --server https://your-router-server.com --force
```

**Binding code expired:**
```bash
# Generate a new binding code
remote-cli init --force
```

**Not receiving messages from Feishu:**
1. Verify the service is running: `remote-cli status`
2. Check if device is bound: Should show "Bound User: ou_xxx"
3. Verify the router server is accessible
4. Check logs: `remote-cli logs`

### Router Server Issues

**Feishu webhook not responding:**
1. Verify webhook URL is correct in Feishu console
2. Check SSL certificate is valid
3. Verify Nginx is routing correctly
4. Check server logs: `pm2 logs remote-cli-router`

**WebSocket connection drops:**
1. Check firewall settings
2. Verify WebSocket timeout configuration
3. Monitor network stability
4. Check Nginx WebSocket proxy settings

### Getting Help

- Check logs: `remote-cli logs --tail 100`
- View configuration: `remote-cli config show`
- Enable debug mode: `remote-cli start --debug`
- Report issues: [GitHub Issues](https://github.com/xiaoyu/remote-cli/issues)

## Configuration Reference

### Local Client Config (`~/.remote-cli/config.json`)

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
  }
}
```

### Router Server Configuration

The router server uses interactive configuration stored at `~/.remote-cli-router/config.json`. Run `remote-cli-router config` to set up.

| Setting | Description | Default |
|---------|-------------|---------|
| `port` | Server port | `3000` |
| `host` | Server host | `0.0.0.0` |
| `feishuAppId` | Feishu app ID | Required |
| `feishuAppSecret` | Feishu app secret | Required |
| `feishuEncryptKey` | Feishu encrypt key | Optional |
| `feishuVerificationToken` | Feishu verification token | Optional |
| `wsHeartbeatInterval` | WebSocket heartbeat (ms) | `30000` |

## Development

See [CLAUDE.md](CLAUDE.md) for development guidelines and architecture documentation.

### Building from Source

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
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## Support

- Documentation: [PLAN.md](PLAN.md) for detailed implementation plan
- Issues: [GitHub Issues](https://github.com/xiaoyu/remote-cli/issues)
- Discussions: [GitHub Discussions](https://github.com/xiaoyu/remote-cli/discussions)
