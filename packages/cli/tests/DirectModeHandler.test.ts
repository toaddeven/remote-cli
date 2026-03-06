import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeishuClient } from '../src/feishu/FeishuClient';
import {
  createMarkdownElement,
  createToolUseElement,
  createToolResultElement,
  createDividerElement,
  createRedactedThinkingElement,
  createPlanModeElement,
  getToolEmoji,
  truncate,
} from '../src/feishu/ToolFormatter';

// Mock axios for FeishuClient
vi.mock('axios');

describe('Direct Mode - FeishuClient', () => {
  it('should create FeishuClient with app credentials', () => {
    const client = new FeishuClient('test-app-id', 'test-app-secret');
    expect(client).toBeDefined();
  });
});

describe('Direct Mode - ToolFormatter', () => {
  describe('createMarkdownElement', () => {
    it('should create markdown element with content', () => {
      const element = createMarkdownElement('Hello **world**');
      expect(element).toEqual({
        tag: 'markdown',
        content: 'Hello **world**',
      });
    });
  });

  describe('createDividerElement', () => {
    it('should create hr element', () => {
      const element = createDividerElement();
      expect(element).toEqual({ tag: 'hr' });
    });
  });

  describe('createToolUseElement', () => {
    it('should create tool use elements with proper structure', () => {
      const elements = createToolUseElement({
        name: 'Bash',
        id: 'call-test-123',
        input: { command: 'echo hello' },
      });

      expect(elements.length).toBe(2); // divider + collapsible_panel
      expect(elements[0].tag).toBe('hr');
      expect(elements[1].tag).toBe('collapsible_panel');
    });
  });

  describe('createToolResultElement', () => {
    it('should create tool result elements for success', () => {
      const elements = createToolResultElement({
        tool_use_id: 'call-test-123',
        content: 'command output',
        is_error: false,
      });

      expect(elements.length).toBe(1);
      expect(elements[0].tag).toBe('collapsible_panel');
    });

    it('should create tool result elements for error', () => {
      const elements = createToolResultElement({
        tool_use_id: 'call-test-123',
        content: 'error message',
        is_error: true,
      });

      expect(elements.length).toBe(1);
    });
  });

  describe('createRedactedThinkingElement', () => {
    it('should create redacted thinking notification', () => {
      const elements = createRedactedThinkingElement();
      expect(elements.length).toBe(2); // divider + markdown
      expect(elements[1].tag).toBe('markdown');
      expect(elements[1].content).toContain('safety systems');
    });
  });

  describe('createPlanModeElement', () => {
    it('should create plan mode element with plan content', () => {
      const elements = createPlanModeElement('This is the plan\n1. Do this\n2. Do that');
      expect(elements.length).toBe(2); // divider + collapsible_panel
      expect(elements[1].tag).toBe('collapsible_panel');
    });
  });

  describe('getToolEmoji', () => {
    it('should return known emoji for tool names', () => {
      expect(getToolEmoji('Bash')).toBe('⚡');
      expect(getToolEmoji('Read')).toBe('📖');
      expect(getToolEmoji('Write')).toBe('✍️');
      expect(getToolEmoji('Edit')).toBe('✏️');
      expect(getToolEmoji('Grep')).toBe('🔍');
    });

    it('should return default emoji for unknown tools', () => {
      expect(getToolEmoji('UnknownTool')).toBe('🔧');
    });
  });

  describe('truncate', () => {
    it('should return original string if shorter than max length', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate and add ellipsis for long strings', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });
  });
});

describe('Direct Mode - Configuration Types', () => {
  it('should have the right configuration structure', async () => {
    // Just verify the types exist by importing them
    const { Config, DEFAULT_CONFIG } = await import('../src/types/config');

    expect(DEFAULT_CONFIG.feishu).toBeDefined();
    expect(DEFAULT_CONFIG.feishu?.directMode).toBe(false);
  });
});
