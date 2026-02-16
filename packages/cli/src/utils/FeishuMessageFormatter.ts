/**
 * Feishu Message Formatter
 * Formats tool use and tool result messages into beautiful Feishu interactive cards
 */

/**
 * Tool use information
 */
export interface ToolUseInfo {
  name: string;
  id: string;
  input: Record<string, any>;
}

/**
 * Tool result information
 */
export interface ToolResultInfo {
  id: string;
  content: string;
  isError: boolean;
}

/**
 * Format tool use message as a compact indicator
 * Only shows minimal info - details will be shown on error
 * @param toolUse Tool use information
 * @returns Formatted compact message string
 */
export function formatToolUseMessage(toolUse: ToolUseInfo): string {
  const emoji = getToolEmoji(toolUse.name);
  // Compact single-line format without blockquote prefix
  return `${emoji} **${toolUse.name}**...`;
}

/**
 * Format tool result message as a status indicator with visual indentation
 * Only shows details when there's an error
 * @param result Tool result information
 * @returns Formatted message string with quote-style indentation
 */
export function formatToolResultMessage(result: ToolResultInfo): string {
  // On error, show detailed information
  if (result.isError) {
    // Truncate long error content
    const content = result.content.length > 200
      ? result.content.substring(0, 200) + '...'
      : result.content;
    return `❌ **Failed**: ${content}`;
  }

  // On success, just show a compact checkmark
  return `✅ Done`;
}

/**
 * Create a visual separator between tool executions
 * @returns Formatted separator string
 */
export function createToolSeparator(): string {
  return '\n────────────────────\n';
}

/**
 * Create a visual separator between tool execution and final response
 * @returns Formatted separator string
 */
export function createResponseSeparator(): string {
  return '\n\n';
}


/**
 * Create Feishu interactive card for tool use
 * This can be used to create a collapsible card with full details
 */
export function createToolUseCard(toolUse: ToolUseInfo): any {
  const emoji = getToolEmoji(toolUse.name);

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: `${emoji} ${toolUse.name}`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: formatToolParamsMarkdown(toolUse.input),
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `ID: ${toolUse.id}`,
          },
        ],
      },
    ],
  };
}

/**
 * Create Feishu interactive card for tool result
 */
export function createToolResultCard(result: ToolResultInfo): any {
  const color = result.isError ? 'red' : 'green';
  const emoji = result.isError ? '❌' : '✅';
  const status = result.isError ? 'Failed' : 'Success';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: color,
      title: {
        tag: 'plain_text',
        content: `${emoji} Tool ${status}`,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: result.content.substring(0, 4000), // Feishu limit
        },
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `ID: ${result.id}`,
          },
        ],
      },
    ],
  };
}

/**
 * Get emoji for tool based on tool name
 */
function getToolEmoji(toolName: string): string {
  const emojiMap: Record<string, string> = {
    'Bash': '💻',
    'Read': '📖',
    'Write': '✍️',
    'Edit': '📝',
    'Grep': '🔍',
    'Glob': '📁',
    'Task': '🤖',
    'WebFetch': '🌐',
    'WebSearch': '🔎',
    'AskUserQuestion': '❓',
    'TodoWrite': '📋',
  };

  return emojiMap[toolName] || '🔧';
}

/**
 * Format tool parameters in a compact way
 */
function formatToolParams(input: Record<string, any>): string {
  const entries = Object.entries(input);

  if (entries.length === 0) {
    return '';
  }

  // Show only the most important parameters compactly
  const lines: string[] = [];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      // For strings, show first 50 chars
      const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
      lines.push(`  ${key}: ${displayValue}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`  ${key}: ${value}`);
    } else {
      // For objects/arrays, show type only
      lines.push(`  ${key}: [${Array.isArray(value) ? 'array' : 'object'}]`);
    }

    // Limit to 3 parameters for compactness
    if (lines.length >= 3) {
      const remaining = entries.length - 3;
      if (remaining > 0) {
        lines.push(`  ... and ${remaining} more`);
      }
      break;
    }
  }

  return lines.join('\n');
}

/**
 * Format tool parameters as markdown for card display
 */
function formatToolParamsMarkdown(input: Record<string, any>): string {
  const entries = Object.entries(input);

  if (entries.length === 0) {
    return '*No parameters*';
  }

  const lines: string[] = ['**Parameters:**'];
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      // Use code blocks for strings
      lines.push(`- **${key}**: \`${value.substring(0, 100)}${value.length > 100 ? '...' : ''}\``);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`- **${key}**: ${value}`);
    } else {
      // For complex types, use JSON
      const jsonStr = JSON.stringify(value, null, 2);
      lines.push(`- **${key}**:\n\`\`\`json\n${jsonStr.substring(0, 200)}${jsonStr.length > 200 ? '\n...' : ''}\n\`\`\``);
    }
  }

  return lines.join('\n');
}
