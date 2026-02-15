# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Language Requirement

**CRITICAL: All code, comments, documentation, commit messages, variable names, and any text in this repository MUST be written in English only.**

- NO Chinese characters are allowed in any source files, comments, or documentation
- All JSDoc comments must be in English
- All error messages and user-facing strings must be in English
- Commit messages must be in English
- Variable names, function names, and identifiers must use English words
- Code review comments and PR descriptions must be in English

This is a **strictly enforced** rule - any pull request containing Chinese text will be rejected.

## Project Overview

This is a remote CLI tool that allows developers to control Claude Code CLI from their mobile phones via Feishu (飞书) messaging. The system enables developers to write code remotely when away from their computers, providing a mobile-friendly interface to Claude Code's capabilities.

**Core Architecture:**
- **Monorepo structure** with two main packages:
  - `packages/cli`: Local client that runs on the developer's machine
  - `packages/router`: Routing server that manages user binding and message forwarding (planned, not yet implemented)
- **Local client** connects to a router server via WebSocket and executes Claude Code commands
- **Security model**: Directory whitelisting + command filtering + device authentication

## Development Commands

### Building
```bash
# Build all packages
npm run build

# Build specific workspace
npm run build -w @anthropic/remote-cli        # CLI package
npm run build -w @anthropic/remote-cli-router # Router package (when implemented)
```

### Testing
```bash
# Run all tests
npm test

# Run tests for CLI package only
npm test -w @anthropic/remote-cli

# Run tests with coverage
npm run test:coverage -w @anthropic/remote-cli

# Run a single test file
npm test -- DirectoryGuard.test.ts

# Run tests for a specific command
npm test -- commands/init.test.ts

# Run integration tests
npm test -- integration/full-workflow.test.ts
```

### Development Mode
```bash
# Run CLI in dev mode (with file watching)
npm run cli:dev

# Run router in dev mode (when implemented)
npm run router:dev
```

## Architecture Decisions

### ConfigManager Pattern (CRITICAL for Tests)

The ConfigManager uses a **static factory pattern** that reads configuration from disk on initialization:

```typescript
// Each call creates a NEW instance reading from disk
const config1 = await ConfigManager.initialize();
config1.set('key', 'value');
await config1.save();

// This will see the NEW value because it reads from disk again
const config2 = await ConfigManager.initialize();
config2.get('key'); // Returns 'value'
```

**Why this matters for tests:**
- Commands like `startCommand()` and `stopCommand()` modify config and save it to disk
- Any `config` variable you hold in memory becomes **stale** after commands run
- You MUST call `ConfigManager.initialize()` again to see updated values
- Example: After `startCommand()`, reload config to verify `service.running` changed:
  ```typescript
  await startCommand();
  // OLD: const running = config.get('service.running'); // WRONG - stale!
  // NEW: Must reload
  const freshConfig = await ConfigManager.initialize();
  const running = freshConfig.get('service.running'); // Correct
  ```

### Test Isolation on macOS

The CLI uses `os.homedir()` to locate the config directory (`~/.remote-cli/`). On macOS, `os.homedir()` does NOT respect `process.env.HOME` changes. Tests must mock it:

```typescript
import os from 'os';
import { vi } from 'vitest';

// Mock os.homedir() to respect process.env.HOME for isolated tests
vi.spyOn(os, 'homedir').mockImplementation(() => process.env.HOME || os.homedir());
```

Without this mock, tests will write to the real home directory and contaminate each other.

### Security Architecture

**DirectoryGuard** is the gatekeeper for all file system operations:
1. **Path normalization**: Converts `~`, relative paths, and absolute paths to canonical form
2. **Whitelist enforcement**: Only allows operations within directories specified in `config.security.allowedDirectories`
3. **Path traversal prevention**: Blocks `../../etc/passwd` style attacks

The security model has **three layers**:
1. **Directory whitelist**: `DirectoryGuard.isAllowed()` checks working directories
2. **Command filtering**: `CommandFilter` blocks dangerous bash commands (planned, not yet implemented)
3. **Device authentication**: Router server binds devices to specific users (planned, not yet implemented)

## Key Implementation Patterns

### Message Flow (Planned Architecture)
```
User's Phone → Feishu → Router Server → WebSocket → Local CLI → Claude Code
                                                                      ↓
User's Phone ← Feishu ← Router Server ← WebSocket ← Local CLI ← Results
```

### Error Handling
- Commands return `{ success: boolean, message?: string, data?: any }`
- Always provide user-friendly error messages
- For validation errors, include what was expected vs what was provided

### Testing Strategy
The test suite follows TDD principles:
- **Unit tests**: Test individual components (`DirectoryGuard`, `ConfigManager`, `WebSocketClient`)
- **Command tests**: Test CLI commands in isolation with mocked dependencies
- **Integration tests**: Test complete workflows (init → start → stop)
- **Coverage requirement**: 80%+ per testing.md

Integration tests validate:
- Full user journey (init, start, status, stop)
- Config persistence across operations
- Error handling (network failures, missing configs)
- Binding flow simulation

## File Structure Conventions

### Source Code Organization
```
packages/cli/src/
  commands/      # CLI command implementations (init, start, stop, etc.)
  client/        # WebSocket client and message handling
  config/        # Configuration management
  executor/      # Claude Code integration (planned)
  security/      # Directory guard and command filtering
  types/         # TypeScript type definitions
```

### Test Organization
```
packages/cli/tests/
  *.test.ts              # Unit tests (named after source file)
  commands/              # Command-specific tests
  integration/           # Full workflow integration tests
```

## Implementation Notes

### Router Server (Planned)
The router server package structure is defined but not yet implemented. It will include:
- `webhook/FeishuHandler.ts`: Handle Feishu webhook callbacks
- `websocket/ConnectionHub.ts`: Manage WebSocket connections from local clients
- `binding/BindingManager.ts`: Manage user-device bindings with Redis
- `feishu/FeishuClient.ts`: Feishu API wrapper for sending messages

### WebSocket Protocol (Planned)
Messages between router and CLI will use this format:
```typescript
{
  type: "command" | "response" | "error" | "binding",
  messageId: string,
  content: string,
  timestamp: number
}
```

## Common Pitfalls

1. **Forgetting to reload ConfigManager**: Always call `initialize()` again after commands that modify config
2. **Not mocking os.homedir()**: Tests will fail on macOS without the homedir mock
3. **Path handling**: Always use DirectoryGuard for path validation - never trust user input directly
4. **WebSocketClient state**: The client maintains connection state - always check `isConnected` before sending

## References

- See [PLAN.md](PLAN.md) for complete implementation plan with architecture diagrams, security design, and deployment strategies
- Claude Agent SDK: `@anthropic-ai/claude-agent-sdk` version ^0.2.0
- Testing requirements: Minimum 80% coverage (unit + integration + E2E)
