# Remote CLI - 通过飞书远程控制 Claude Code

[![npm version](https://img.shields.io/npm/v/@yu_robotics/remote-cli.svg)](https://www.npmjs.com/package/@yu_robotics/remote-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

通过飞书（Lark）消息从手机上远程控制你的 Claude Code CLI。即使不在电脑前，也能继续编程。

[English Documentation](README.md)

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用方法](#使用方法)
- [快捷命令](#快捷命令)
- [安全机制](#安全机制)
- [系统架构](#系统架构)
- [路由服务器部署](#路由服务器部署)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 功能特性

- 🌍 **远程控制**：通过手机随时随地控制本地开发环境
- 🔒 **安全可靠**：目录白名单、命令过滤、设备认证三重保护
- 📱 **移动优化**：为飞书定制的简化命令和富文本格式
- 🤖 **Claude Code 集成**：完整使用 Claude Code 的能力和上下文
- ⚡ **持久进程**：通过 stdio 双向流保持 Claude 进程长期运行
- 🚀 **简单 setup**：一键安装和初始化

## 快速开始

```bash
# 安装 CLI
npm install -g @yu_robotics/remote-cli

# 初始化并获取绑定码
remote-cli init --server https://your-router-server.com

# 添加允许的目录
remote-cli config add-dir ~/projects

# 启动服务
remote-cli start

# 现在将绑定码发送给飞书机器人
# 然后就可以用手机开始编程了！
```

## 环境要求

开始前，请确保你已安装：

- **Node.js** >= 18.0.0
- **npm** 或 **yarn** 包管理器
- **Claude Code CLI** 并已配置
- 可访问的**飞书机器人**（团队应部署一个路由服务器）

## 安装

### 从 npm 安装（推荐）

```bash
npm install -g @yu_robotics/remote-cli
```

或使用 yarn：

```bash
yarn global add @yu_robotics/remote-cli
```

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# 安装依赖
npm install

# 构建所有包
npm run build

# 全局链接 CLI
cd packages/cli
npm link
```

## 使用方法

### 1. 初始化

生成唯一的设备 ID 和绑定码：

```bash
remote-cli init --server https://your-router-server.com
```

示例输出：
```
✔ Initializing remote CLI...
✔ Device ID: dev_darwin_a1b2c3d4e5f6
✔ Binding code: ABC-123-XYZ

请在飞书中绑定设备：
1. 打开飞书，找到机器人
2. 发送：/bind ABC-123-XYZ
3. 等待确认

绑定码将在 5 分钟后过期。
```

### 2. 在飞书中绑定设备

打开飞书应用，向机器人发送绑定码：

```
/bind ABC-123-XYZ
```

### 3. 配置安全设置

添加允许 Claude Code 操作的目录：

```bash
# 添加单个目录
remote-cli config add-dir ~/projects

# 添加多个目录
remote-cli config add-dir ~/work ~/code/company-repos

# 查看当前配置
remote-cli config show
```

### 4. 启动服务

```bash
remote-cli start
```

### 5. 查看状态

```bash
remote-cli status
```

### 6. 停止服务

```bash
remote-cli stop
```

## 快捷命令

连接后，在飞书中可以使用以下命令：

| 命令 | 说明 |
|---------|-------------|
| `/cd <目录>` | 切换工作目录 |
| `/c` 或 `/continue` | 继续上一次的对话 |
| `/r` 或 `/resume` | 恢复上一个会话 |
| `/clear` | 清除当前会话 |
| `/status` | 查看设备状态和当前目录 |
| `/help` | 显示可用命令 |

### 示例工作流程

1. **切换到项目：**
   ```
   /cd ~/projects/my-app
   ```

2. **让 Claude Code 帮忙：**
   ```
   审查 src/auth.ts 中的认证代码并提出改进建议
   ```

3. **继续对话：**
   ```
   /c
   现在实现这些改进
   ```

4. **运行测试：**
   ```
   运行测试套件并修复失败的测试
   ```

## 安全机制

### 目录白名单

只有显式添加到白名单的目录才能访问：

```bash
remote-cli config add-dir ~/safe/directory
```

### 命令过滤

危险命令会被自动拦截：
- `rm -rf /`
- 系统文件的 `sudo` 操作
- 直接磁盘写入（`dd`、`mkfs`）
- Fork 炸弹等恶意模式

### 设备认证

- 每台设备基于机器硬件生成**唯一 ID**
- 绑定码**5 分钟后过期**
- 每个用户只能控制**自己绑定的设备**
- 随时解绑：在飞书中发送 `/unbind`

## 系统架构

```
┌─────────────────┐         ┌──────────────────────────────┐
│   飞书服务器     │         │      开发者 A 的工作电脑        │
│                 │         │      (Mac/Linux)             │
│   开发者 A 的    │◀───────▶│  ┌─────────────────────────┐ │
│   手机          │         │  │  remote-cli (本地)       │ │
│   与机器人私聊   │         │  │  - WebSocket 客户端      │ │
│                 │         │  │  - Claude Code 执行器    │ │
└─────────────────┘         │  │  - 安全目录守卫           │ │
        │                   │  └──────────┬──────────────┘ │
        │                   │             ▼                 │
        │                   │  本地 Claude Code CLI        │
        ▼                   │  (使用 Agent SDK)            │
┌─────────────────┐         └──────────────────────────────┘
│   路由服务器     │
│  (团队部署)      │         ┌──────────────────────────────┐
│  ┌───────────┐  │         │      开发者 B 的工作电脑        │
│  │ Webhook   │  │         │  ┌─────────────────────────┐ │
│  │ 处理器    │  │◀───────▶│  │  remote-cli (本地)       │ │
│  └───────────┘  │         │  └─────────────────────────┘ │
│  ┌───────────┐  │         └──────────────────────────────┘
│  │ WebSocket │  │
│  │   中心    │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │   绑定    │  │
│  │   注册表   │  │
│  └───────────┘  │
└─────────────────┘
```

## 路由服务器部署

> **注意**：大多数用户不需要部署路由服务器。团队管理员应该部署一个路由服务器供整个团队共享。

详见下方的[路由部署指南](#路由部署指南)。

快速部署：

```bash
# 安装路由服务器
npm install -g @yu_robotics/remote-cli-router

# 配置
remote-cli-router config

# 启动
remote-cli-router start
```

## 常见问题

### 服务无法启动

```bash
# 检查是否已在运行
remote-cli status

# 查看日志
remote-cli logs

# 重启
remote-cli stop
remote-cli start
```

### 连接问题

```bash
# 检查网络
ping your-router-server.com

# 验证配置
remote-cli config show

# 重新初始化
remote-cli init --server https://your-router-server.com --force
```

### 绑定码过期

```bash
# 生成新的绑定码
remote-cli init --force
```

## 贡献指南

我们欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

## 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

---

## 详细文档

### 路由部署指南

路由服务器负责在飞书和本地客户端之间转发消息。

#### 环境要求

- 至少 **1 核 CPU** 和 **1GB 内存** 的云服务器
- **Node.js** >= 18.0.0
- **域名**和 SSL 证书（需要 HTTPS）
- 已创建和配置的**飞书机器人**

#### 安装

```bash
# 克隆仓库
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# 安装依赖
npm install

# 构建路由服务器
npm run build -w @yu_robotics/remote-cli-router

# 全局链接
cd packages/router
npm link
```

#### 配置

```bash
remote-cli-router config
```

你将需要输入：
- **飞书 App ID**（必需）
- **飞书 App Secret**（必需）
- 飞书 Encrypt Key（可选）
- 飞书 Verification Token（可选）
- 服务器端口（默认：3000）

#### 设置飞书机器人

1. 访问[飞书开放平台](https://open.feishu.cn/)
2. 创建新应用
3. 启用**机器人**能力
4. 配置权限：
   - `im:message` - 接收消息
   - `im:message.p2p_msg` - 接收私聊消息
   - `im:message:send_as_bot` - 以机器人身份发送消息
5. 配置 webhook URL：`https://your-domain.com/webhook/feishu`
6. 订阅事件：`im.message.receive_v1`
7. 获取凭证并发布应用

#### Nginx 配置

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

### 配置参考

#### 本地客户端配置（`~/.remote-cli/config.json`）

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

### 开发

```bash
# 克隆仓库
git clone https://github.com/xiaoyu/remote-cli.git
cd remote-cli

# 安装依赖
npm install

# 构建所有包
npm run build

# 运行测试
npm test

# 以开发模式运行 CLI
npm run cli:dev

# 以开发模式运行路由服务器
npm run router:dev
```

### 支持

- 问题反馈：[GitHub Issues](https://github.com/xiaoyu/remote-cli/issues)
- 讨论交流：[GitHub Discussions](https://github.com/xiaoyu/remote-cli/discussions)
