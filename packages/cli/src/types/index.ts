/**
 * Incoming message from router server
 */
export interface IncomingMessage {
  type: 'command' | 'status' | 'ping';
  messageId: string;
  content?: string;
  workingDirectory?: string;
  openId?: string;
  timestamp: number;
  /** Whether this is a passthrough slash command */
  isSlashCommand?: boolean;
}

/**
 * Outgoing message to router server
 */
export interface OutgoingMessage {
  type: 'result' | 'progress' | 'status' | 'pong';
  messageId: string;
  success?: boolean;
  output?: string;
  error?: string;
  message?: string;
  status?: any;
  timestamp: number;
  workingDirectory?: string;
  openId?: string;
}
