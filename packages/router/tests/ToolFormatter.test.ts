import { describe, it, expect } from 'vitest';
import {
  getToolEmoji,
  extractToolContext,
  createDividerElement,
  createMarkdownElement,
  createToolUseElement,
  createToolResultElement,
  formatFilePath,
  truncate,
} from '../src/utils/ToolFormatter';
import { ToolUseInfo, ToolResultInfo } from '../src/types';

describe('ToolFormatter', () => {
  describe('getToolEmoji', () => {
    it('should return correct emoji for known tools', () => {
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

  describe('formatFilePath', () => {
    it('should replace home directory with ~', () => {
      const homeDir = process.env.HOME || '/Users';
      const filePath = `${homeDir}/workspace/test.ts`;
      expect(formatFilePath(filePath)).toBe('~/workspace/test.ts');
    });

    it('should keep non-home paths unchanged', () => {
      const filePath = '/tmp/test.ts';
      expect(formatFilePath(filePath)).toBe('/tmp/test.ts');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      const str = 'Hello';
      expect(truncate(str, 10)).toBe('Hello');
    });

    it('should truncate long strings', () => {
      const str = 'This is a very long string';
      expect(truncate(str, 10)).toBe('This is...');
    });

    it('should handle exact length', () => {
      const str = 'Exactly10!';
      expect(truncate(str, 10)).toBe('Exactly10!');
    });
  });

  describe('extractToolContext', () => {
    it('should extract Bash context', () => {
      const input = {
        command: 'npm test',
        description: 'Run tests',
      };
      const context = extractToolContext('Bash', input);
      expect(context).toContain('Run tests');
      expect(context).toContain('npm test');
    });

    it('should extract Read context', () => {
      const input = {
        file_path: '/Users/test/file.ts',
        offset: 10,
        limit: 20,
      };
      const context = extractToolContext('Read', input);
      expect(context).toContain('File:');
      expect(context).toContain('offset: 10');
      expect(context).toContain('limit: 20');
    });

    it('should extract Write context', () => {
      const input = {
        file_path: '/Users/test/file.ts',
        content: 'Line 1\nLine 2\nLine 3',
      };
      const context = extractToolContext('Write', input);
      expect(context).toContain('File:');
      expect(context).toContain('3 lines');
    });

    it('should extract Grep context', () => {
      const input = {
        pattern: 'function.*test',
        path: '/Users/test',
        glob: '*.ts',
      };
      const context = extractToolContext('Grep', input);
      expect(context).toContain('Pattern:');
      expect(context).toContain('function.*test');
      expect(context).toContain('Glob:');
    });
  });

  describe('createDividerElement', () => {
    it('should create a divider element', () => {
      const divider = createDividerElement();
      expect(divider).toEqual({ tag: 'hr' });
    });
  });

  describe('createMarkdownElement', () => {
    it('should create a markdown element', () => {
      const markdown = createMarkdownElement('# Hello World');
      expect(markdown).toEqual({
        tag: 'markdown',
        content: '# Hello World',
      });
    });
  });

  describe('createToolUseElement', () => {
    it('should create tool use elements', () => {
      const toolUse: ToolUseInfo = {
        name: 'Read',
        id: 'tool_abc123',
        input: {
          file_path: '/Users/test/file.ts',
        },
      };

      const elements = createToolUseElement(toolUse);

      expect(elements).toHaveLength(2);
      expect(elements[0]).toEqual({ tag: 'hr' });
      expect(elements[1].tag).toBe('markdown');
      expect(elements[1].content).toContain('TOOL USE');
      expect(elements[1].content).toContain('Read');
      expect(elements[1].content).toContain('tool_abc'); // Truncated ID (8 chars)
    });

    it('should include emoji in tool use element', () => {
      const toolUse: ToolUseInfo = {
        name: 'Bash',
        id: 'tool_xyz',
        input: { command: 'echo hello' },
      };

      const elements = createToolUseElement(toolUse);
      expect(elements[1].content).toContain('⚡'); // Bash emoji
    });
  });

  describe('createToolResultElement', () => {
    it('should create success tool result elements', () => {
      const toolResult: ToolResultInfo = {
        tool_use_id: 'tool_abc123',
        content: 'Command succeeded',
        is_error: false,
      };

      const elements = createToolResultElement(toolResult);

      expect(elements).toHaveLength(2);
      // First element should be the status markdown
      expect(elements[0].tag).toBe('markdown');
      expect(elements[0].content).toContain('SUCCESS');
      expect(elements[0].content).toContain('tool_abc'); // Truncated ID (8 chars)
      // Second element should be the content in markdown
      expect(elements[1].tag).toBe('markdown');
      expect(elements[1].content).toContain('Command succeeded');
    });

    it('should create error tool result elements', () => {
      const toolResult: ToolResultInfo = {
        tool_use_id: 'tool_xyz',
        content: 'Command failed',
        is_error: true,
      };

      const elements = createToolResultElement(toolResult);

      expect(elements).toHaveLength(2);
      // First element should be the status markdown
      expect(elements[0].tag).toBe('markdown');
      expect(elements[0].content).toContain('ERROR');
      // Second element should be the error message in markdown
      expect(elements[1].tag).toBe('markdown');
      expect(elements[1].content).toContain('Command failed');
    });

    it('should truncate long result content', () => {
      const longContent = 'x'.repeat(1000);
      const toolResult: ToolResultInfo = {
        tool_use_id: 'tool_xyz',
        content: longContent,
        is_error: false,
      };

      const elements = createToolResultElement(toolResult);
      // elements[0] is the status markdown, elements[1] is the content markdown
      expect(elements).toHaveLength(2);
      expect(elements[1].tag).toBe('markdown');
      expect(elements[1].content.length).toBeLessThan(longContent.length);
      expect(elements[1].content).toContain('...');
    });
  });
});
