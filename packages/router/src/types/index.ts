/**
 * Common type definitions
 */

// Binding code (valid for 5 minutes)
export interface BindingCode {
  code: string;           // "ABC-123-XYZ"
  deviceId: string;       // "dev_mac_xxx"
  createdAt: number;      // Creation timestamp
  expiresAt: number;      // Expiration timestamp
}

// Binding record (stored in Redis)
export interface UserBinding {
  openId: string;         // Feishu user open_id
  deviceId: string;       // Device unique identifier
  deviceName: string;     // "MacBook-Pro-xxx"
  boundAt: number;        // Binding time
  lastActiveAt: number;   // Last active time
}

// WebSocket message type
export enum MessageType {
  COMMAND = 'command',             // Command message
  RESPONSE = 'response',           // Response message
  BINDING_REQUEST = 'binding_request',  // Binding request
  BINDING_CONFIRM = 'binding_confirm',  // Binding confirmation
  HEARTBEAT = 'heartbeat',         // Heartbeat
  ERROR = 'error',                 // Error
  NOTIFICATION = 'notification'    // Notification message to Feishu
}

// WebSocket message interface
export interface WSMessage {
  type: MessageType;
  messageId: string;
  timestamp: number;
  data: any;
}

// Command message
export interface CommandMessage extends WSMessage {
  type: MessageType.COMMAND;
  data: {
    openId: string;
    content: string;
    workingDir?: string;
  };
}

// Response message
export interface ResponseMessage extends WSMessage {
  type: MessageType.RESPONSE;
  data: {
    success: boolean;
    output?: string;
    error?: string;
  };
}
