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
 * Intelligently extracts key information based on tool type
 * @param toolUse Tool use information
 * @returns Formatted compact message string
 */
export function formatToolUseMessage(toolUse: ToolUseInfo): string {
  const emoji = getToolEmoji(toolUse.name);
  const input = toolUse.input;

  // Build the message with tool name
  let message = `${emoji} **${toolUse.name}**`;

  // Extract context based on tool type and available fields
  const context = extractToolContext(toolUse.name, input);

  if (context) {
    message += ` - ${context}`;
  }

  return message;
}

/**
 * Extract human-readable context from tool input based on tool type
 * @param toolName Name of the tool
 * @param input Tool input parameters
 * @returns Formatted context string or null
 */
function extractToolContext(toolName: string, input: Record<string, any>): string | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  // Tool-specific handling - some tools have special logic
  switch (toolName) {
    case 'Bash':
      return extractBashContext(input);

    case 'Read':
    case 'Write':
    case 'Edit':
      if (typeof input.file_path === 'string' && input.file_path) {
        return formatFilePath(input.file_path, 50);
      }
      break;

    case 'Grep':
      if (typeof input.pattern === 'string' && input.pattern) {
        const path = typeof input.path === 'string' ? input.path : '.';
        return `\`${truncate(input.pattern, 30)}\` in ${formatFilePath(path, 25)}`;
      }
      break;

    case 'Glob':
      if (typeof input.pattern === 'string' && input.pattern) {
        return `\`${truncate(input.pattern, 40)}\``;
      }
      break;

    case 'WebFetch':
      if (typeof input.url === 'string' && input.url) {
        return `\`${truncate(input.url, 50)}\``;
      }
      break;

    case 'WebSearch':
      if (typeof input.query === 'string' && input.query) {
        return `\`${truncate(input.query, 50)}\``;
      }
      break;

    case 'Task':
      return extractTaskContext(input);

    case 'TodoWrite':
      if (Array.isArray(input.todos)) {
        return `${input.todos.length} item(s)`;
      }
      break;

    case 'AskUserQuestion':
      if (typeof input.question === 'string' && input.question) {
        return truncate(input.question, 50);
      }
      break;
  }

  // Generic fallback: description field (most tools have this)
  if (typeof input.description === 'string' && input.description) {
    return truncate(input.description, 50);
  }

  // Fallback: prompt field
  if (typeof input.prompt === 'string' && input.prompt) {
    return truncate(input.prompt, 50);
  }

  // Fallback: try to find informative string fields
  const informativePatterns = [
    /path|file|dir|folder/i,
    /url|link|href/i,
    /name|title/i,
    /content|text|body/i,
    /message|note/i,
  ];

  const stringFields = Object.entries(input)
    .filter(([key, value]) => {
      // Skip internal/meta fields and generic params
      const skipFields = ['id', 'tool_use_id', 'timestamp', 'type', 'param1', 'param2', 'param3', 'arg1', 'arg2'];
      if (skipFields.includes(key)) return false;

      if (typeof value !== 'string' || value.length === 0) return false;
      if (value.length > 100) return false; // Too long

      // Only include if key matches informative patterns
      return informativePatterns.some(pattern => pattern.test(key));
    })
    .map(([key, value]) => ({ key, value: value as string }));

  if (stringFields.length > 0) {
    // Pick the first reasonable string field
    const field = stringFields[0];
    return `\`${truncate(field.value, 50)}\``;
  }

  return null;
}

/**
 * Extract context for Bash tool - shows both description and command
 * @param input Tool input parameters
 * @returns Formatted context string
 */
function extractBashContext(input: Record<string, any>): string | null {
  const hasDescription = typeof input.description === 'string' && input.description;
  const hasCommand = typeof input.command === 'string' && input.command;

  if (hasDescription && hasCommand) {
    // Show both: description (command)
    const desc = truncate(input.description, 35);
    const cmd = truncate(input.command, 30);
    return `${desc} (\`${cmd}\`)`;
  }

  if (hasDescription) {
    return truncate(input.description, 50);
  }

  if (hasCommand) {
    return `\`${truncate(input.command, 50)}\``;
  }

  return null;
}

/**
 * Extract context for Task tool
 * @param input Tool input parameters
 * @returns Formatted context string
 */
function extractTaskContext(input: Record<string, any>): string | null {
  const hasPrompt = typeof input.prompt === 'string' && input.prompt;
  const hasSubagent = typeof input.subagent_type === 'string' && input.subagent_type;

  if (hasPrompt && hasSubagent) {
    return `[${input.subagent_type}] ${truncate(input.prompt, 40)}`;
  }

  if (hasPrompt) {
    return truncate(input.prompt, 50);
  }

  if (hasSubagent) {
    return `[${input.subagent_type}]`;
  }

  return null;
}

/**
 * Format file path for display - shows filename with smart truncation for long paths
 * For long paths: keeps the beginning and filename, truncates the middle
 * @param filePath Full file path
 * @param maxLength Maximum length for the displayed path
 * @returns Formatted path string
 */
function formatFilePath(filePath: string, maxLength: number): string {
  if (filePath.length <= maxLength) {
    return `\`${filePath}\``;
  }

  // Extract filename (last part after / or \)
  const separator = filePath.includes('/') ? '/' : '\\';
  const parts = filePath.split(separator);
  const fileName = parts[parts.length - 1];

  // If filename itself is too long, truncate it
  if (fileName.length > maxLength - 5) {
    return `\`${truncate(fileName, maxLength - 5)}\``;
  }

  // Keep the start of the path and the filename, truncate middle
  const prefixLength = maxLength - fileName.length - 5; // 5 for "..." + separators
  if (prefixLength > 5) {
    const prefix = filePath.substring(0, prefixLength);
    return `\`${prefix}.../${fileName}\``;
  }

  // Fallback: just show truncated full path
  return `\`${truncate(filePath, maxLength)}\``;
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
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
