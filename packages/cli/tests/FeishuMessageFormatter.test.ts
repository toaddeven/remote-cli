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
    it('should format tool use with emoji and parameters', () => {
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
      expect(result).toContain('🔧 **Tool:**'); // New format includes Tool: prefix
      expect(result).toContain('Bash'); // Tool name
      expect(result).toContain('command: ls -la');
      expect(result).toContain('description: List files');
      expect(result).toContain('>'); // Should use blockquote format
    });

    it('should truncate long string parameters', () => {
      const toolUse: ToolUseInfo = {
        name: 'Read',
        id: 'tool_456',
        input: {
          file_path: '/very/long/path/that/should/be/truncated/because/it/is/longer/than/fifty/characters/in/total/length.txt'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('📖'); // Read emoji
      expect(result).toContain('...');
      expect(result.indexOf('file_path')).toBeGreaterThan(-1);
      // Should be truncated to 50 chars
      const filePath = result.split('file_path: ')[1];
      expect(filePath.length).toBeLessThanOrEqual(54); // 50 + "..."
    });

    it('should handle array and object parameters', () => {
      const toolUse: ToolUseInfo = {
        name: 'Task',
        id: 'tool_789',
        input: {
          todos: [1, 2, 3],
          config: { key: 'value' }
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🤖'); // Task emoji
      expect(result).toContain('todos: [array]');
      expect(result).toContain('config: [object]');
    });

    it('should limit to 3 parameters and show remaining count', () => {
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

      expect(result).toContain('param1');
      expect(result).toContain('param2');
      expect(result).toContain('param3');
      expect(result).toContain('... and 2 more');
    });

    it('should handle empty parameters', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_222',
        input: {}
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('💻');
      expect(result).toContain('Bash'); // Tool name should be present
      expect(result).toContain('🔧 **Tool:**'); // New format
    });

    it('should use default emoji for unknown tools', () => {
      const toolUse: ToolUseInfo = {
        name: 'UnknownTool',
        id: 'tool_333',
        input: {}
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🔧'); // Default emoji
      expect(result).toContain('UnknownTool'); // Tool name should be present
    });
  });

  describe('formatToolResultMessage', () => {
    it('should format successful tool result', () => {
      const result: ToolResultInfo = {
        id: 'tool_123',
        content: 'Operation completed successfully',
        isError: false
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('✅');
      expect(formatted).toContain('**Done**'); // Changed from Success to Done
      expect(formatted).toContain('Operation completed successfully');
      expect(formatted).toContain('>'); // Should use blockquote format
    });

    it('should format failed tool result', () => {
      const result: ToolResultInfo = {
        id: 'tool_456',
        content: 'Error: Something went wrong',
        isError: true
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('❌');
      expect(formatted).toContain('**Failed**');
      expect(formatted).toContain('Error: Something went wrong');
    });

    it('should truncate long content', () => {
      const longContent = 'a'.repeat(200);
      const result: ToolResultInfo = {
        id: 'tool_789',
        content: longContent,
        isError: false
      };

      const formatted = formatToolResultMessage(result);

      expect(formatted).toContain('✅');
      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(longContent.length);
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
    it('should create visual separator with proper formatting', () => {
      const separator = createResponseSeparator();

      expect(separator).toContain('---'); // Markdown horizontal rule
      expect(separator).toContain('🎯'); // Target emoji
      expect(separator).toContain('Response'); // Response heading
      expect(separator).toContain('##'); // Heading level 2
      expect(separator.startsWith('\n\n')).toBe(true); // Should start with newlines
    });
  });
});
