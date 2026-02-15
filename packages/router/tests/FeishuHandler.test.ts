import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FeishuHandler } from '../src/webhook/FeishuHandler';
import { BindingManager } from '../src/binding/BindingManager';
import { ConnectionHub } from '../src/websocket/ConnectionHub';
import { FeishuClient } from '../src/feishu/FeishuClient';
import crypto from 'crypto';

// Mock dependencies
vi.mock('../src/binding/BindingManager');
vi.mock('../src/websocket/ConnectionHub');
vi.mock('../src/feishu/FeishuClient');

describe('FeishuHandler', () => {
  let handler: FeishuHandler;
  let mockBindingManager: any;
  let mockConnectionHub: any;
  let mockFeishuClient: any;
  const encryptKey = 'test_encrypt_key_1234567890';

  beforeEach(() => {
    // Create mock instances
    mockBindingManager = {
      verifyBindingCode: vi.fn(),
      bindUser: vi.fn(),
      getUserBinding: vi.fn(),
      unbindUser: vi.fn()
    };

    mockConnectionHub = {
      isDeviceOnline: vi.fn(),
      sendToDevice: vi.fn(),
      getOnlineDevices: vi.fn()
    };

    mockFeishuClient = {
      sendTextMessage: vi.fn(),
      replyToMessage: vi.fn()
    };

    // Mock constructors
    (BindingManager as any).mockImplementation(() => mockBindingManager);
    (ConnectionHub as any).mockImplementation(() => mockConnectionHub);
    (FeishuClient as any).mockImplementation(() => mockFeishuClient);

    handler = new FeishuHandler({
      appId: 'test_app_id',
      appSecret: 'test_app_secret',
      encryptKey,
      redisUrl: 'redis://localhost:6379'
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('signature verification', () => {
    it('should verify valid signature', () => {
      const timestamp = String(Date.now());
      const nonce = 'test_nonce';
      const body = JSON.stringify({ test: 'data' });

      // Calculate expected signature
      const signature = crypto
        .createHmac('sha256', encryptKey)
        .update(timestamp + nonce + encryptKey + body)
        .digest('hex');

      const result = handler.verifySignature(timestamp, nonce, body, signature);
      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const timestamp = '1234567890';
      const nonce = 'test_nonce';
      const body = JSON.stringify({ test: 'data' });
      const invalidSignature = 'invalid_signature';

      const result = handler.verifySignature(timestamp, nonce, body, invalidSignature);
      expect(result).toBe(false);
    });

    it('should reject expired timestamp', () => {
      const oldTimestamp = String(Date.now() - 6 * 60 * 1000); // 6 minutes ago
      const nonce = 'test_nonce';
      const body = JSON.stringify({ test: 'data' });

      const signature = crypto
        .createHmac('sha256', encryptKey)
        .update(oldTimestamp + nonce + encryptKey + body)
        .digest('hex');

      const result = handler.verifySignature(oldTimestamp, nonce, body, signature);
      expect(result).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    it('should handle url_verification challenge', async () => {
      const event = {
        type: 'url_verification',
        challenge: 'test_challenge_code'
      };

      const result = await handler.handleWebhook(event);

      expect(result).toEqual({
        challenge: 'test_challenge_code'
      });
    });

    it('should handle message event', async () => {
      const event = {
        header: {
          event_type: 'im.message.receive_v1'
        },
        event: {
          sender: {
            sender_id: {
              open_id: 'ou_user_123'
            }
          },
          message: {
            message_id: 'msg_123',
            message_type: 'text',
            content: JSON.stringify({ text: 'Hello' })
          }
        }
      };

      mockBindingManager.getUserBinding.mockResolvedValue({
        deviceId: 'dev_123',
        openId: 'ou_user_123',
        deviceName: 'Test Device'
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(true);
      mockConnectionHub.sendToDevice.mockResolvedValue(true);

      const result = await handler.handleWebhook(event);

      expect(result).toEqual({ success: true });
      expect(mockBindingManager.getUserBinding).toHaveBeenCalledWith('ou_user_123');
      expect(mockConnectionHub.sendToDevice).toHaveBeenCalledWith(
        'dev_123',
        expect.objectContaining({
          type: 'command',
          data: expect.objectContaining({
            openId: 'ou_user_123',
            content: 'Hello'
          })
        })
      );
    });

    it('should handle unknown event type gracefully', async () => {
      const event = {
        header: {
          event_type: 'unknown.event.type'
        }
      };

      const result = await handler.handleWebhook(event);

      expect(result).toEqual({ success: true });
    });
  });

  describe('handleBindCommand', () => {
    it('should bind user with valid code', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const bindingCode = 'ABC-123-XYZ';

      mockBindingManager.verifyBindingCode.mockResolvedValue({
        code: bindingCode,
        deviceId: 'dev_mac_123',
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000
      });

      mockBindingManager.bindUser.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleBindCommand(openId, messageId, bindingCode);

      expect(mockBindingManager.verifyBindingCode).toHaveBeenCalledWith(bindingCode);
      expect(mockBindingManager.bindUser).toHaveBeenCalledWith(
        openId,
        'dev_mac_123',
        'MacBook-Pro'
      );
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('Binding successful')
      );
    });

    it('should reject invalid binding code', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const invalidCode = 'INVALID-CODE';

      mockBindingManager.verifyBindingCode.mockResolvedValue(null);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleBindCommand(openId, messageId, invalidCode);

      expect(mockBindingManager.verifyBindingCode).toHaveBeenCalledWith(invalidCode);
      expect(mockBindingManager.bindUser).not.toHaveBeenCalled();
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('Invalid')
      );
    });

    it('should handle binding errors gracefully', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const bindingCode = 'ABC-123-XYZ';

      mockBindingManager.verifyBindingCode.mockResolvedValue({
        code: bindingCode,
        deviceId: 'dev_mac_123',
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000
      });

      mockBindingManager.bindUser.mockRejectedValue(new Error('Redis error'));
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleBindCommand(openId, messageId, bindingCode);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('Failed')
      );
    });
  });

  describe('handleRegularCommand', () => {
    it('should forward command to online device', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const content = 'list files in current directory';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(true);
      mockConnectionHub.sendToDevice.mockResolvedValue(true);

      await handler.handleRegularCommand(openId, messageId, content);

      expect(mockBindingManager.getUserBinding).toHaveBeenCalledWith(openId);
      expect(mockConnectionHub.isDeviceOnline).toHaveBeenCalledWith('dev_mac_123');
      expect(mockConnectionHub.sendToDevice).toHaveBeenCalledWith(
        'dev_mac_123',
        expect.objectContaining({
          type: 'command',
          data: {
            openId,
            content
          }
        })
      );
    });

    it('should notify user if device is offline', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const content = 'test command';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(false);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleRegularCommand(openId, messageId, content);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('offline')
      );
    });

    it('should notify user if not bound', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const content = 'test command';

      mockBindingManager.getUserBinding.mockResolvedValue(null);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleRegularCommand(openId, messageId, content);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringMatching(/not bound|no binding/)
      );
    });

    it('should handle send failure', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';
      const content = 'test command';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(true);
      mockConnectionHub.sendToDevice.mockResolvedValue(false);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleRegularCommand(openId, messageId, content);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('Failed to send')
      );
    });
  });

  describe('handleStatusCommand', () => {
    it('should show device status when bound and online', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now() - 86400000 // 1 day ago
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(true);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleStatusCommand(openId, messageId);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('MacBook-Pro')
      );
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('online')
      );
    });

    it('should show offline status when device is offline', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockConnectionHub.isDeviceOnline.mockReturnValue(false);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleStatusCommand(openId, messageId);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('offline')
      );
    });

    it('should show not bound message when user is not bound', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockBindingManager.getUserBinding.mockResolvedValue(null);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleStatusCommand(openId, messageId);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringMatching(/not bound|no binding/)
      );
    });
  });

  describe('handleUnbindCommand', () => {
    it('should unbind user successfully', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockBindingManager.getUserBinding.mockResolvedValue({
        openId,
        deviceId: 'dev_mac_123',
        deviceName: 'MacBook-Pro',
        boundAt: Date.now()
      });

      mockBindingManager.unbindUser.mockResolvedValue(true);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleUnbindCommand(openId, messageId);

      expect(mockBindingManager.unbindUser).toHaveBeenCalledWith(openId);
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringMatching(/Unbind successful|Unbound/)
      );
    });

    it('should handle when user is not bound', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockBindingManager.getUserBinding.mockResolvedValue(null);
      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleUnbindCommand(openId, messageId);

      expect(mockBindingManager.unbindUser).not.toHaveBeenCalled();
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringMatching(/not bound|no binding/)
      );
    });
  });

  describe('parseMessageContent', () => {
    it('should parse text message', () => {
      const message = {
        message_type: 'text',
        content: JSON.stringify({ text: 'Hello World' })
      };

      const result = handler.parseMessageContent(message);
      expect(result).toBe('Hello World');
    });

    it('should handle malformed JSON', () => {
      const message = {
        message_type: 'text',
        content: 'invalid json'
      };

      const result = handler.parseMessageContent(message);
      expect(result).toBe('');
    });

    it('should handle non-text message types', () => {
      const message = {
        message_type: 'image',
        content: JSON.stringify({ image_key: 'img_123' })
      };

      const result = handler.parseMessageContent(message);
      expect(result).toBe('');
    });

    it('should trim whitespace', () => {
      const message = {
        message_type: 'text',
        content: JSON.stringify({ text: '  Hello World  ' })
      };

      const result = handler.parseMessageContent(message);
      expect(result).toBe('Hello World');
    });
  });

  describe('isCommand', () => {
    it('should identify /bind command', () => {
      expect(handler.isCommand('/bind ABC-123-XYZ')).toBe(true);
    });

    it('should identify /status command', () => {
      expect(handler.isCommand('/status')).toBe(true);
    });

    it('should identify /unbind command', () => {
      expect(handler.isCommand('/unbind')).toBe(true);
    });

    it('should identify /help command', () => {
      expect(handler.isCommand('/help')).toBe(true);
    });

    it('should not identify regular text as command', () => {
      expect(handler.isCommand('Hello, how are you?')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(handler.isCommand('')).toBe(false);
    });
  });

  describe('handleHelpCommand', () => {
    it('should send help message', async () => {
      const openId = 'ou_user_123';
      const messageId = 'msg_123';

      mockFeishuClient.replyToMessage.mockResolvedValue(true);

      await handler.handleHelpCommand(openId, messageId);

      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('/bind')
      );
      expect(mockFeishuClient.replyToMessage).toHaveBeenCalledWith(
        messageId,
        expect.stringContaining('/status')
      );
    });
  });

  describe('error handling', () => {
    it('should handle errors in handleWebhook gracefully', async () => {
      const event = {
        header: {
          event_type: 'im.message.receive_v1'
        },
        event: {
          sender: {
            sender_id: {
              open_id: 'ou_user_123'
            }
          },
          message: {
            message_id: 'msg_123',
            message_type: 'text',
            content: JSON.stringify({ text: 'Hello' })
          }
        }
      };

      mockBindingManager.getUserBinding.mockRejectedValue(new Error('Database error'));

      const result = await handler.handleWebhook(event);

      // Should not throw, should return success: false or handle gracefully
      expect(result).toBeDefined();
    });
  });
});
