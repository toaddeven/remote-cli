# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open source release
- Git worktree support for isolated session workspaces
- Comprehensive documentation in English and Chinese

## [1.0.3] - 2026-02-18

### Fixed
- Fixed failing tests by updating mocks
- Prevented process crash when working directory doesn't exist
- Validated working directory exists before spawning Claude process
- Fixed `/clear` command from stopping Claude process

## [1.0.2] - 2026-02-17

### Added
- Persistent Claude process with stream-json I/O for better performance
- Git worktree integration for session isolation
- Worktree slash commands (`/worktree list`, `/worktree cleanup`, `/main`)
- Auto-detection of nested Claude sessions

### Fixed
- Improved error handling for WebSocket connections
- Fixed session resumption logic

## [1.0.1] - 2026-02-16

### Added
- Feishu message formatting with rich text cards
- Progress indicators for long-running operations
- Directory whitelisting security feature
- Command filtering for dangerous operations

### Fixed
- WebSocket reconnection logic
- Configuration persistence issues

## [1.0.0] - 2026-02-15

### Added
- Initial release of Remote CLI
- Local client package (`@yu_robotics/remote-cli`)
- Router server package (`@yu_robotics/remote-cli-router`)
- WebSocket-based communication between client and router
- Device binding mechanism with Feishu
- Basic CLI commands: `init`, `start`, `stop`, `status`, `config`
- Security features: DirectoryGuard, command filtering
- Message handling with slash command support
- Claude Code integration via Agent SDK
- Comprehensive test suite (80%+ coverage)

### Features
- Remote control Claude Code from mobile via Feishu
- Directory-based security sandbox
- Device authentication and binding
- Real-time message streaming
- Session management and resumption
- Mobile-optimized command interface

[Unreleased]: https://github.com/xiaoyu/remote-cli/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/xiaoyu/remote-cli/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/xiaoyu/remote-cli/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/xiaoyu/remote-cli/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/xiaoyu/remote-cli/releases/tag/v1.0.0
