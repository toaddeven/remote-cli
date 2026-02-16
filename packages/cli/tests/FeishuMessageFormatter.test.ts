import { describe, it, expect } from 'vitest';
import {
  formatToolUseMessage,
  formatToolResultMessage,
  createResponseSeparator,
  createToolUseCard,
  createToolResultCard,
  type ToolUseInfo,
  type ToolResultInfo
} from '../src/utils/FeishuMessageFormatter';

describe('FeishuMessageFormatter', () => {
  describe('formatToolUseMessage', () => {
    it('should format tool use with compact indicator', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_123',
        input: {
          command: 'ls -la',
          description: 'List files'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('💻'); // Bash emoji
      expect(result).toContain('⏳'); // Loading indicator
      expect(result).toContain('**Bash**'); // Tool name in bold
      expect(result).toContain('...'); // Ellipsis
      expect(result).not.toContain('>'); // Should NOT use blockquote format
    });

    it('should use correct emoji for different tools', () => {
      const tools: { name: string; emoji: string }[] = [
        { name: 'Bash', emoji: '💻' },
        { name: 'Read', emoji: '📖' },
        { name: 'Write', emoji: '✍️' },
        { name: 'Edit', emoji: '📝' },
        { name: 'Grep', emoji: '🔍' },
        { name: 'Glob', emoji: '📁' },
        { name: 'Task', emoji: '🤖' },
      ];

      for (const tool of tools) {
        const toolUse: ToolUseInfo = {
          name: tool.name,
          id: 'tool_123',
          input: {}
        };
        const result = formatToolUseMessage(toolUse);
        expect(result).toContain(tool.emoji);
      }
    });

    it('should use default emoji for unknown tools', () => {
      const toolUse: ToolUseInfo = {
        name: 'UnknownTool',
        id: 'tool_333',
        input: {}
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🔧'); // Default emoji
      expect(result).toContain('**UnknownTool**'); // Tool name in bold
    });

    it('should not include parameter details in compact format', () => {
      const toolUse: ToolUseInfo = {
        name: 'Write',
        id: 'tool_111',
        input: {
          param1: 'value1',
          param2: 'value2',
          param3: 'value3',
          param4: 'value4',
          param5: 'value5'
        }
      };

      const result = formatToolUseMessage(toolUse);

      // Should not contain parameter details
      expect(result).not.toContain('param1');
      expect(result).not.toContain('value1');
      // Should be compact
      expect(result.length).toBeLessThan(50);
    });
  });

  describe('formatToolResultMessage', () => {
    it('should format successful tool result with compact checkmark', () => {
      const result: ToolResultInfo = {
        id: 'tool_123',
        content: 'Operation completed successfully',
        isError: false
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('✅');
      expect(formatted).toContain('Done');
      expect(formatted).not.toContain('Operation completed successfully'); // No details on success
      expect(formatted).not.toContain('>'); // Should NOT use blockquote format
    });

    it('should format failed tool result with error details', () => {
      const result: ToolResultInfo = {
        id: 'tool_456',
        content: 'Error: Something went wrong',
        isError: true
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('❌');
      expect(formatted).toContain('**Failed**');
      expect(formatted).toContain('Error: Something went wrong'); // Error details shown
    });

    it('should truncate long error content', () => {
      const longContent = 'a'.repeat(300);
      const result: ToolResultInfo = {
        id: 'tool_789',
        content: longContent,
        isError: true
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('❌');
      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(250); // Truncated length
    });

    it('should not truncate success content (not shown anyway)', () => {
      const longContent = 'a'.repeat(300);
      const result: ToolResultInfo = {
        id: 'tool_789',
        content: longContent,
        isError: false
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toBe('✅ Done'); // Compact format, no content
    });
  });

  describe('createToolUseCard', () => {
    it('should create valid Feishu card structure', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_123',
        input: {
          command: 'npm test',
          description: 'Run tests'
        }
      };

      const card = createToolUseCard(toolUse);

      expect(card).toHaveProperty('config');
      expect(card.config.wide_screen_mode).toBe(true);
      expect(card).toHaveProperty('header');
      expect(card.header.template).toBe('blue');
      expect(card.header.title.content).toContain('Bash');
      expect(card).toHaveProperty('elements');
      expect(Array.isArray(card.elements)).toBe(true);
    });

    it('should include tool ID in note section', () => {
      const toolUse: ToolUseInfo = {
        name: 'Read',
        id: 'tool_unique_id',
        input: { file_path: '/test.txt' }
      };

      const card = createToolUseCard(toolUse);

      const noteElement = card.elements.find((el: any) => el.tag === 'note');
      expect(noteElement).toBeDefined();
      expect(noteElement.elements[0].content).toContain('tool_unique_id');
    });
  });

  describe('createToolResultCard', () => {
    it('should create green card for success', () => {
      const result: ToolResultInfo = {
        id: 'tool_123',
        content: 'Success',
        isError: false
      };

      const card = createToolResultCard(result);

      expect(card.header.template).toBe('green');
      expect(card.header.title.content).toContain('✅');
      expect(card.header.title.content).toContain('Success');
    });

    it('should create red card for failure', () => {
      const result: ToolResultInfo = {
        id: 'tool_456',
        content: 'Failed',
        isError: true
      };

      const card = createToolResultCard(result);

      expect(card.header.template).toBe('red');
      expect(card.header.title.content).toContain('❌');
      expect(card.header.title.content).toContain('Failed');
    });

    it('should truncate content to Feishu limit (4000 chars)', () => {
      const longContent = 'x'.repeat(5000);
      const result: ToolResultInfo = {
        id: 'tool_789',
        content: longContent,
        isError: false
      };

      const card = createToolResultCard(result);

      const divElement = card.elements.find((el: any) => el.tag === 'div');
      expect(divElement.text.content.length).toBeLessThanOrEqual(4000);
    });
  });

  describe('createResponseSeparator', () => {
    it('should create simple visual separator', () => {
      const separator = createResponseSeparator();

      expect(separator).toBe('\n\n'); // Simple double newline separator
    });
  });
});
