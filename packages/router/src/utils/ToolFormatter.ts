import { ToolUseInfo, ToolResultInfo } from '../types';

/**
 * Feishu Card 2.0 element types
 */
export interface FeishuCardElement {
  tag: string;
  [key: string]: any;
}

/**
 * Tool emoji mapping
 */
const TOOL_EMOJIS: Record<string, string> = {
  Bash: '⚡',
  Read: '📖',
  Write: '✍️',
  Edit: '✏️',
  Grep: '🔍',
  Glob: '📁',
  Task: '🤖',
  WebFetch: '🌐',
  WebSearch: '🔎',
  TodoWrite: '📝',
  AskUserQuestion: '❓',
  Skill: '🎯',
  EnterPlanMode: '📋',
  ExitPlanMode: '✅',
  NotebookEdit: '📓',
};

/**
 * Get emoji for tool name
 */
export function getToolEmoji(toolName: string): string {
  return TOOL_EMOJIS[toolName] || '🔧';
}

/**
 * Extract context from tool input based on tool type
 */
export function extractToolContext(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return extractBashContext(input);
    case 'Read':
      return extractReadContext(input);
    case 'Write':
      return extractWriteContext(input);
    case 'Edit':
      return extractEditContext(input);
    case 'Grep':
      return extractGrepContext(input);
    case 'Glob':
      return extractGlobContext(input);
    case 'Task':
      return extractTaskContext(input);
    case 'WebFetch':
      return extractWebFetchContext(input);
    case 'WebSearch':
      return extractWebSearchContext(input);
    case 'TodoWrite':
      return extractTodoWriteContext(input);
    case 'AskUserQuestion':
      return extractAskUserQuestionContext(input);
    default:
      return formatGenericContext(input);
  }
}

function extractBashContext(input: Record<string, unknown>): string {
  const command = input.command as string;
  const description = input.description as string;

  if (description && description.length > 0 && description.length < 100) {
    return `**${description}**\n\`\`\`bash\n${truncate(command, 500)}\n\`\`\``;
  }

  return `\`\`\`bash\n${truncate(command, 500)}\n\`\`\``;
}

function extractReadContext(input: Record<string, unknown>): string {
  const filePath = input.file_path as string;
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  let context = `**File:** ${formatFilePath(filePath)}`;

  if (offset !== undefined || limit !== undefined) {
    const rangeInfo = [];
    if (offset !== undefined) rangeInfo.push(`offset: ${offset}`);
    if (limit !== undefined) rangeInfo.push(`limit: ${limit}`);
    context += `\n**Range:** ${rangeInfo.join(', ')}`;
  }

  return context;
}

function extractWriteContext(input: Record<string, unknown>): string {
  const filePath = input.file_path as string;
  const content = input.content as string;
  const lines = content.split('\n').length;
  const chars = content.length;

  return `**File:** ${formatFilePath(filePath)}\n**Size:** ${lines} lines, ${chars} chars`;
}

function extractEditContext(input: Record<string, unknown>): string {
  const filePath = input.file_path as string;
  const oldString = input.old_string as string;
  const newString = input.new_string as string;

  let context = `**File:** ${formatFilePath(filePath)}`;

  if (oldString && newString) {
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;
    context += `\n**Change:** ${oldLines} → ${newLines} lines`;
  }

  return context;
}

function extractGrepContext(input: Record<string, unknown>): string {
  const pattern = input.pattern as string;
  const path = input.path as string | undefined;
  const glob = input.glob as string | undefined;
  const type = input.type as string | undefined;

  let context = `**Pattern:** \`${truncate(pattern, 100)}\``;

  if (path) {
    context += `\n**Path:** ${formatFilePath(path)}`;
  }

  if (glob) {
    context += `\n**Glob:** \`${glob}\``;
  }

  if (type) {
    context += `\n**Type:** ${type}`;
  }

  return context;
}

function extractGlobContext(input: Record<string, unknown>): string {
  const pattern = input.pattern as string;
  const path = input.path as string | undefined;

  let context = `**Pattern:** \`${pattern}\``;

  if (path) {
    context += `\n**Path:** ${formatFilePath(path)}`;
  }

  return context;
}

function extractTaskContext(input: Record<string, unknown>): string {
  const subagentType = input.subagent_type as string;
  const description = input.description as string;
  const prompt = input.prompt as string;

  let context = `**Agent:** ${subagentType}`;

  if (description) {
    context += `\n**Task:** ${truncate(description, 100)}`;
  }

  if (prompt && prompt.length < 200) {
    context += `\n**Prompt:** ${truncate(prompt, 150)}`;
  }

  return context;
}

function extractWebFetchContext(input: Record<string, unknown>): string {
  const url = input.url as string;
  const prompt = input.prompt as string | undefined;

  let context = `**URL:** ${url}`;

  if (prompt && prompt.length < 150) {
    context += `\n**Prompt:** ${truncate(prompt, 100)}`;
  }

  return context;
}

function extractWebSearchContext(input: Record<string, unknown>): string {
  const query = input.query as string;

  return `**Query:** ${truncate(query, 150)}`;
}

function extractTodoWriteContext(input: Record<string, unknown>): string {
  const todos = input.todos as Array<{ content: string; status: string }> | undefined;

  if (!todos || todos.length === 0) {
    return '**Updating todo list**';
  }

  return `**Todos:** ${todos.length} items`;
}

function extractAskUserQuestionContext(input: Record<string, unknown>): string {
  const questions = input.questions as Array<{ question: string }> | undefined;

  if (!questions || questions.length === 0) {
    return '**Asking user question**';
  }

  if (questions.length === 1) {
    return `**Question:** ${truncate(questions[0].question, 150)}`;
  }

  return `**Questions:** ${questions.length} items`;
}

function formatGenericContext(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return '_(no parameters)_';
  }

  const summary = keys.slice(0, 3).map(key => {
    const value = input[key];
    const valueStr = typeof value === 'string' ? truncate(value, 50) : JSON.stringify(value);
    return `**${key}:** ${valueStr}`;
  }).join('\n');

  if (keys.length > 3) {
    return `${summary}\n_...and ${keys.length - 3} more_`;
  }

  return summary;
}

/**
 * Format file path for display (shorten home directory)
 */
export function formatFilePath(filePath: string): string {
  const homeDir = process.env.HOME || '/Users';
  if (filePath.startsWith(homeDir)) {
    return `~${filePath.slice(homeDir.length)}`;
  }
  return filePath;
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Create a Feishu Card 2.0 divider element
 */
export function createDividerElement(): FeishuCardElement {
  return { tag: 'hr' };
}

/**
 * Create a Feishu Card 2.0 markdown element
 */
export function createMarkdownElement(content: string): FeishuCardElement {
  return {
    tag: 'markdown',
    content,
  };
}

/**
 * Create a Feishu Card 2.0 tool use element
 */
export function createToolUseElement(toolInfo: ToolUseInfo): FeishuCardElement[] {
  const { name, input, id } = toolInfo;
  const emoji = getToolEmoji(name);
  const context = extractToolContext(name, input);

  // Build markdown content
  let content = `<text_tag color='blue'>${emoji} TOOL USE</text_tag> · **${name}**`;

  if (id) {
    content += ` · \`${id.slice(0, 8)}\``;
  }

  content += `\n\n${context}`;

  return [
    createDividerElement(),
    createMarkdownElement(content),
  ];
}

/**
 * Create a Feishu Card 2.0 tool result element
 */
export function createToolResultElement(resultInfo: ToolResultInfo): FeishuCardElement[] {
  const { tool_use_id, content, is_error } = resultInfo;

  // Determine status
  const statusColor = is_error ? 'red' : 'green';
  const statusIcon = is_error ? 'close-circle-filled' : 'check-circle-filled';
  const statusText = is_error ? 'ERROR' : 'SUCCESS';

  // Build markdown content
  let markdownContent = `<text_tag color='${statusColor}'>${statusText}</text_tag>`;

  if (tool_use_id) {
    markdownContent += ` · \`${tool_use_id.slice(0, 8)}\``;
  }

  // Add result content if present and not too long
  if (content) {
    const truncated = truncate(content, 500);
    markdownContent += `\n\n\`\`\`\n${truncated}\n\`\`\``;
  }

  // Create status div with icon
  const statusDiv: FeishuCardElement = {
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: statusText,
    },
    icon: {
      tag: 'standard_icon',
      token: statusIcon,
      color: statusColor,
    },
  };

  return [
    createMarkdownElement(markdownContent),
    statusDiv,
  ];
}
