import { describe, it, expect } from 'vitest';
import {
  formatToolUseMessage,
  formatToolResultMessage,
  createResponseSeparator,
  createToolUseCard,
  createToolResultCard,
  createDividerElement,
  createMarkdownElement,
  type ToolUseInfo,
  type ToolResultInfo,
  type DividerElement,
  type MarkdownElement
} from '../src/utils/FeishuMessageFormatter';

describe('FeishuMessageFormatter', () => {
  describe('formatToolUseMessage', () => {
    it('should format tool use with description when available', () => {
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
      expect(result).toContain('**Bash**'); // Tool name in bold
      expect(result).toContain('List files'); // Description shown
      expect(result).not.toContain('>'); // Should NOT use blockquote format
    });

    it('should format tool use with command when no description', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_123',
        input: {
          command: 'npm test',
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('💻'); // Bash emoji
      expect(result).toContain('**Bash**'); // Tool name in bold
      expect(result).toContain('`npm test`'); // Command shown in code format
    });

    it('should truncate long commands', () => {
      const longCommand = 'a'.repeat(100);
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_123',
        input: {
          command: longCommand,
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('💻'); // Bash emoji
      expect(result).toContain('...'); // Truncated indicator
      expect(result.length).toBeLessThan(80); // Should be truncated
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
          input: { description: 'Test' }
        };
        const result = formatToolUseMessage(toolUse);
        expect(result).toContain(tool.emoji);
      }
    });

    it('should use default emoji for unknown tools', () => {
      const toolUse: ToolUseInfo = {
        name: 'UnknownTool',
        id: 'tool_333',
        input: { description: 'Test' }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🔧'); // Default emoji
      expect(result).toContain('**UnknownTool**'); // Tool name in bold
      expect(result).toContain('Test'); // Description shown
    });

    it('should show ellipsis when no command or description', () => {
      const toolUse: ToolUseInfo = {
        name: 'Write',
        id: 'tool_111',
        input: {
          param1: 'value1',
          param2: 'value2',
        }
      };

      const result = formatToolUseMessage(toolUse);

      // Should not contain other parameter details
      expect(result).not.toContain('param1');
      expect(result).not.toContain('value1');
    });

    it('should format Read tool with file path', () => {
      const toolUse: ToolUseInfo = {
        name: 'Read',
        id: 'tool_222',
        input: {
          file_path: '/path/to/file.txt'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('📖'); // Read emoji
      expect(result).toContain('**Read**');
      expect(result).toContain('`/path/to/file.txt`');
    });

    it('should format Grep tool with pattern and path', () => {
      const toolUse: ToolUseInfo = {
        name: 'Grep',
        id: 'tool_333',
        input: {
          pattern: 'searchTerm',
          path: '/src'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🔍'); // Grep emoji
      expect(result).toContain('**Grep**');
      expect(result).toContain('`searchTerm`');
      expect(result).toContain('in');
      expect(result).toContain('`/src`');
    });

    it('should format WebFetch tool with URL', () => {
      const toolUse: ToolUseInfo = {
        name: 'WebFetch',
        id: 'tool_444',
        input: {
          url: 'https://example.com/api'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🌐'); // WebFetch emoji
      expect(result).toContain('**WebFetch**');
      expect(result).toContain('`https://example.com/api`');
    });

    it('should format Task tool with prompt', () => {
      const toolUse: ToolUseInfo = {
        name: 'Task',
        id: 'tool_555',
        input: {
          prompt: 'Analyze this code',
          subagent_type: 'code-reviewer'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('🤖'); // Task emoji
      expect(result).toContain('**Task**');
      expect(result).toContain('Analyze this code');
    });

    it('should format TodoWrite tool with todo count', () => {
      const toolUse: ToolUseInfo = {
        name: 'TodoWrite',
        id: 'tool_666',
        input: {
          todos: [
            { content: 'Task 1', status: 'in_progress' },
            { content: 'Task 2', status: 'pending' }
          ]
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('📋'); // TodoWrite emoji
      expect(result).toContain('**TodoWrite**');
      expect(result).toContain('2 item(s)');
    });

    it('should format AskUserQuestion tool with question', () => {
      const toolUse: ToolUseInfo = {
        name: 'AskUserQuestion',
        id: 'tool_777',
        input: {
          question: 'Which option do you prefer?'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('❓'); // AskUserQuestion emoji
      expect(result).toContain('**AskUserQuestion**');
      expect(result).toContain('Which option do you prefer?');
    });

    it('should truncate long descriptions', () => {
      const longDescription = 'a'.repeat(100);
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_888',
        input: {
          description: longDescription
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('...'); // Truncated indicator
      expect(result.length).toBeLessThan(70); // Should be truncated
    });

    it('should show both description and command for Bash tool', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_999',
        input: {
          command: 'ls -la',
          description: 'List directory contents'
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('List directory contents');
      expect(result).toContain('ls -la'); // Command should also appear with description
      expect(result).toContain('(');
      expect(result).toContain(')');
    });

    it('should format long file paths with smart truncation', () => {
      const longPath = '/Users/username/projects/my-awesome-project/src/components/deep/nested/directory/very-long-file-name.ts';
      const toolUse: ToolUseInfo = {
        name: 'Read',
        id: 'tool_111',
        input: {
          file_path: longPath
        }
      };

      const result = formatToolUseMessage(toolUse);

      expect(result).toContain('📖'); // Read emoji
      expect(result).toContain('**Read**');
      expect(result).toContain('very-long-file-name.ts'); // Filename should be visible
      expect(result).toContain('...'); // Truncation indicator
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

      const mdElement = card.elements.find((el: any) => el.tag === 'markdown');
      expect(mdElement.content.length).toBeLessThanOrEqual(4000);
    });
  });

  describe('createResponseSeparator', () => {
    it('should create simple visual separator', () => {
      const separator = createResponseSeparator();

      expect(separator).toBe('\n\n'); // Simple double newline separator
    });
  });

  describe('createDividerElement', () => {
    it('should create a divider element with hr tag', () => {
      const divider: DividerElement = createDividerElement();

      expect(divider.tag).toBe('hr');
    });
  });

  describe('createMarkdownElement', () => {
    it('should create a markdown element with content', () => {
      const content = '**Bold text** and `code`';
      const element: MarkdownElement = createMarkdownElement(content);

      expect(element.tag).toBe('markdown');
      expect(element.content).toBe(content);
    });

    it('should handle empty content', () => {
      const element: MarkdownElement = createMarkdownElement('');

      expect(element.tag).toBe('markdown');
      expect(element.content).toBe('');
    });
  });
});
