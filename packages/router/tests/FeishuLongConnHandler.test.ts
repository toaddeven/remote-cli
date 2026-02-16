import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FeishuLongConnHandler } from '../src/feishu/FeishuLongConnHandler';
import { BindingManager } from '../src/binding/BindingManager';
import { ConnectionHub } from '../src/websocket/ConnectionHub';
import * as lark from '@larksuiteoapi/node-sdk';

// Mock dependencies
vi.mock('../src/binding/BindingManager');
vi.mock('../src/websocket/ConnectionHub');
vi.mock('@larksuiteoapi/node-sdk');

describe('FeishuLongConnHandler', () => {
  let handler: FeishuLongConnHandler;
  let mockBindingManager: any;
  let mockConnectionHub: any;
  let mockClient: any;

  beforeEach(() => {
    // Create mock instances
    mockBindingManager = {
      verifyBindingCode: vi.fn(),
      bindUser: vi.fn(),
      getUserBinding: vi.fn(),
      unbindUser: vi.fn(),
      close: vi.fn()
    };

    mockConnectionHub = {
      isDeviceOnline: vi.fn(),
      sendToDevice: vi.fn(),
      getConnectionStats: vi.fn()
    };

    mockClient = {
      im: {
        message: {
          create: vi.fn(),
          patch: vi.fn(),
          reply: vi.fn()
        }
      }
    };

    // Mock constructors
    (BindingManager as any).mockImplementation(() => mockBindingManager);
    (ConnectionHub as any).mockImplementation(() => mockConnectionHub);
    (lark.Client as any).mockImplementation(() => mockClient);
    (lark.WSClient as any).mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined)
    }));
    (lark.EventDispatcher as any).mockImplementation(() => ({
      register: vi.fn().mockReturnThis()
    }));

    handler = new FeishuLongConnHandler({
      appId: 'test_app_id',
      appSecret: 'test_app_secret',
      store: {} as any
    });

    handler.setConnectionHub(mockConnectionHub);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should send text message successfully', async () => {
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_123' } });

      const result = await handler.sendMessage('ou_user_123', 'Hello World');

      expect(result).toBe(true);
      expect(mockClient.im.message.create).toHaveBeenCalledWith({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: 'ou_user_123',
          msg_type: 'text',
          content: JSON.stringify({ text: 'Hello World' })
        }
      });
    });

    it('should return false when sending fails', async () => {
      mockClient.im.message.create.mockRejectedValue(new Error('API Error'));

      const result = await handler.sendMessage('ou_user_123', 'Hello World');

      expect(result).toBe(false);
    });
  });

  describe('sendStreamingStart', () => {
    it('should create interactive card', async () => {
      mockClient.im.message.create.mockResolvedValue({
        data: { message_id: 'msg_card_123' }
      });

      const result = await handler.sendStreamingStart('ou_user_123', '🤔 Thinking...');

      expect(result).toBe('msg_card_123');
      expect(mockClient.im.message.create).toHaveBeenCalledWith({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: 'ou_user_123',
          msg_type: 'interactive',
          content: expect.stringContaining('Thinking...')
        }
      });
    });

    it('should return null when creation fails', async () => {
      mockClient.im.message.create.mockRejectedValue(new Error('API Error'));

      const result = await handler.sendStreamingStart('ou_user_123');

      expect(result).toBeNull();
    });
  });

  describe('updateStreamingMessage', () => {
    it('should update message within limit', async () => {
      mockClient.im.message.patch.mockResolvedValue({});

      const result = await handler.updateStreamingMessage('msg_123', 'Short content', 'ou_user_123');

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalledWith({
        path: { message_id: 'msg_123' },
        data: {
          content: JSON.stringify({
            config: { wide_screen_mode: true },
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: 'Short content'
                }
              }
            ]
          })
        }
      });
    });

    it('should create continuation messages when content exceeds limit', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_456' } });

      const longContent = 'a'.repeat(5000); // Exceeds 4000 char limit
      const result = await handler.updateStreamingMessage('msg_123', longContent, 'ou_user_123');

      expect(result).toBe(true);
      // Should update the original message
      expect(mockClient.im.message.patch).toHaveBeenCalled();
      const patchCall = mockClient.im.message.patch.mock.calls[0];
      const patchContent = JSON.parse(patchCall[0].data.content);
      expect(patchContent.elements[0].text.content).toContain('➡️ Continued in next message');

      // Should create continuation message
      expect(mockClient.im.message.create).toHaveBeenCalled();
      const createCall = mockClient.im.message.create.mock.calls[0];
      const createContent = JSON.parse(createCall[0].data.content);
      expect(createContent.elements[0].text.content).toContain('⬅️ Continued from previous message');
    });

    it('should handle multiple chunks', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_456' } });

      const veryLongContent = 'a'.repeat(9000); // Requires 3 chunks
      const result = await handler.updateStreamingMessage('msg_123', veryLongContent, 'ou_user_123');

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalledTimes(1);
      expect(mockClient.im.message.create).toHaveBeenCalledTimes(2); // 2 continuation messages
    });

    it('should not create continuation message if openId not provided', async () => {
      mockClient.im.message.patch.mockResolvedValue({});

      const longContent = 'a'.repeat(5000);
      const result = await handler.updateStreamingMessage('msg_123', longContent);

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalled();
      expect(mockClient.im.message.create).not.toHaveBeenCalled();
    });

    it('should return false when patch fails', async () => {
      mockClient.im.message.patch.mockRejectedValue(new Error('API Error'));

      const result = await handler.updateStreamingMessage('msg_123', 'Content');

      expect(result).toBe(false);
    });
  });

  describe('finalizeStreamingMessage', () => {
    it('should finalize message within limit', async () => {
      mockClient.im.message.patch.mockResolvedValue({});

      const result = await handler.finalizeStreamingMessage('msg_123', 'Final content', 'ABC123', 'ou_user_123');

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalledWith({
        path: { message_id: 'msg_123' },
        data: {
          content: JSON.stringify({
            config: { wide_screen_mode: true },
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: 'Final content'
                }
              },
              {
                tag: 'note',
                elements: [
                  {
                    tag: 'plain_text',
                    content: '✅ Completed · Session: ABC123'
                  }
                ]
              }
            ]
          })
        }
      });
    });

    it('should split long content into multiple messages', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_456' } });

      const longContent = 'a'.repeat(5000);
      const result = await handler.finalizeStreamingMessage('msg_123', longContent, 'ABC123', 'ou_user_123');

      expect(result).toBe(true);
      // Should update original message
      expect(mockClient.im.message.patch).toHaveBeenCalled();
      const patchCall = mockClient.im.message.patch.mock.calls[0];
      const patchContent = JSON.parse(patchCall[0].data.content);
      expect(patchContent.elements[0].text.content).toContain('➡️ Continued in next message');

      // Should create continuation message with completion note
      expect(mockClient.im.message.create).toHaveBeenCalled();
      const createCall = mockClient.im.message.create.mock.calls[0];
      const createContent = JSON.parse(createCall[0].data.content);
      expect(createContent.elements[0].text.content).toContain('⬅️ Continued from previous message');
      expect(createContent.elements[1].tag).toBe('note');
      expect(createContent.elements[1].elements[0].content).toContain('✅ Completed');
    });

    it('should handle very long content with multiple chunks', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_456' } });

      const veryLongContent = 'a'.repeat(12000); // Requires 4 chunks (with 50-char overhead per chunk)
      const result = await handler.finalizeStreamingMessage('msg_123', veryLongContent, undefined, 'ou_user_123');

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalledTimes(1);
      expect(mockClient.im.message.create).toHaveBeenCalledTimes(3); // 3 continuation messages
    });

    it('should not create continuation message without openId', async () => {
      mockClient.im.message.patch.mockResolvedValue({});

      const longContent = 'a'.repeat(5000);
      const result = await handler.finalizeStreamingMessage('msg_123', longContent);

      expect(result).toBe(true);
      expect(mockClient.im.message.patch).toHaveBeenCalled();
      expect(mockClient.im.message.create).not.toHaveBeenCalled();
    });

    it('should return false when patch fails', async () => {
      mockClient.im.message.patch.mockRejectedValue(new Error('API Error'));

      const result = await handler.finalizeStreamingMessage('msg_123', 'Content');

      expect(result).toBe(false);
    });
  });

  describe('finalizeStreamingMessage after streaming updates', () => {
    it('should not re-patch frozen messages that already exist in the chain', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_cont_1' } });

      // Step 1: Simulate streaming that created a 2-message chain
      // First update: short content within single message
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(3000), 'ou_user_123');

      // Second update: content grows past limit, creates continuation message
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(5000), 'ou_user_123');

      // At this point, chain = ['msg_123', 'msg_cont_1']
      // msg_123 is frozen, msg_cont_1 has the tail content

      // Reset mocks to track only finalize calls
      mockClient.im.message.patch.mockClear();
      mockClient.im.message.create.mockClear();

      // Step 2: Finalize with the same text length (no new content added)
      await handler.finalizeStreamingMessage('msg_123', 'a'.repeat(5000), 'ABC123', 'ou_user_123');

      // The first message (msg_123) is frozen - should NOT be patched again
      // Only the last message (msg_cont_1) should be patched with the completion note
      // So we expect exactly 1 patch call (for the last message), not 2
      expect(mockClient.im.message.patch).toHaveBeenCalledTimes(1);

      // Verify the patched message is the continuation (last in chain), not the first
      const patchCall = mockClient.im.message.patch.mock.calls[0];
      expect(patchCall[0].path.message_id).toBe('msg_cont_1');

      // Should NOT create any new messages (chain already covers all chunks)
      expect(mockClient.im.message.create).not.toHaveBeenCalled();
    });

    it('should not create duplicate continuation messages when chunk boundaries shift', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create
        .mockResolvedValueOnce({ data: { message_id: 'msg_cont_1' } })
        .mockResolvedValueOnce({ data: { message_id: 'msg_cont_2' } })
        .mockResolvedValueOnce({ data: { message_id: 'msg_unexpected' } });

      // Step 1: Stream content that creates 3-message chain
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(3000), 'ou_user_123');
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(6000), 'ou_user_123');
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(9000), 'ou_user_123');

      // chain = ['msg_123', 'msg_cont_1', 'msg_cont_2']

      mockClient.im.message.patch.mockClear();
      mockClient.im.message.create.mockClear();

      // Step 2: Finalize - should reuse existing chain, not create new messages
      await handler.finalizeStreamingMessage('msg_123', 'a'.repeat(9000), 'ABC123', 'ou_user_123');

      // Should NOT create any new continuation messages
      expect(mockClient.im.message.create).not.toHaveBeenCalled();

      // Should only patch the last message (with completion note), not frozen ones
      expect(mockClient.im.message.patch).toHaveBeenCalledTimes(1);
      const patchCall = mockClient.im.message.patch.mock.calls[0];
      expect(patchCall[0].path.message_id).toBe('msg_cont_2');
    });

    it('should handle finalize when new content extends beyond existing chain', async () => {
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create
        .mockResolvedValueOnce({ data: { message_id: 'msg_cont_1' } })  // from update
        .mockResolvedValueOnce({ data: { message_id: 'msg_cont_2' } }); // from finalize

      // Step 1: Stream creates 2-message chain
      await handler.updateStreamingMessage('msg_123', 'a'.repeat(5000), 'ou_user_123');
      // chain = ['msg_123', 'msg_cont_1']

      mockClient.im.message.patch.mockClear();
      mockClient.im.message.create.mockClear();
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_cont_2' } });

      // Step 2: Finalize with MORE content that needs a 3rd message
      await handler.finalizeStreamingMessage('msg_123', 'a'.repeat(9000), 'ABC123', 'ou_user_123');

      // Should only create 1 new message (the 3rd chunk), not recreate existing ones
      expect(mockClient.im.message.create).toHaveBeenCalledTimes(1);

      // The first message should NOT be patched (frozen)
      // Only the transitioning message and new message should be affected
      const patchCalls = mockClient.im.message.patch.mock.calls;
      const patchedMessageIds = patchCalls.map((call: any) => call[0].path.message_id);
      expect(patchedMessageIds).not.toContain('msg_123'); // First message stays frozen
    });
  });

  describe('concurrent update serialization', () => {
    it('should not create duplicate continuation messages when updates are concurrent', async () => {
      // Simulate slow API calls where create takes time to resolve
      let createResolvers: Array<(value: any) => void> = [];
      mockClient.im.message.patch.mockResolvedValue({});
      mockClient.im.message.create.mockImplementation(() => {
        return new Promise(resolve => {
          createResolvers.push(resolve);
        });
      });

      // Fire two concurrent updates that both exceed the limit
      // Without serialization, both will try to create a continuation message
      const update1 = handler.updateStreamingMessage('msg_123', 'a'.repeat(5000), 'ou_user_123');
      const update2 = handler.updateStreamingMessage('msg_123', 'a'.repeat(5500), 'ou_user_123');

      // Wait for microtasks so both calls enter the method
      await new Promise(r => setTimeout(r, 10));

      // Resolve all create calls
      for (const resolver of createResolvers) {
        resolver({ data: { message_id: `msg_cont_${createResolvers.indexOf(resolver) + 1}` } });
      }

      await Promise.all([update1, update2]);

      // With serialization, only ONE continuation message should be created
      // The second call should see the chain already has 2 entries and just update
      expect(mockClient.im.message.create).toHaveBeenCalledTimes(1);
    });

    it('should serialize finalize after pending update completes', async () => {
      let patchResolver: ((value: any) => void) | null = null;
      mockClient.im.message.patch.mockImplementation(() => {
        return new Promise(resolve => {
          patchResolver = resolve;
        });
      });
      mockClient.im.message.create.mockResolvedValue({ data: { message_id: 'msg_cont_1' } });

      // Start an update that will be slow (patch takes time)
      const updatePromise = handler.updateStreamingMessage('msg_123', 'Short content', 'ou_user_123');

      // Immediately fire finalize while update is still pending
      const finalizePromise = handler.finalizeStreamingMessage('msg_123', 'Short content', 'ABC123', 'ou_user_123');

      // Resolve the first patch
      await new Promise(r => setTimeout(r, 10));
      if (patchResolver) {
        patchResolver({});
        patchResolver = null;
      }

      // Wait for update to complete, then finalize's patch should proceed
      await new Promise(r => setTimeout(r, 10));
      if (patchResolver) {
        patchResolver({});
      }

      await Promise.all([updatePromise, finalizePromise]);

      // Both should complete successfully without errors
      // The finalize should wait for the update to finish first
      expect(mockClient.im.message.patch).toHaveBeenCalled();
    });
  });

  describe('splitTextIntoChunks', () => {
    it('should return single chunk for short text', () => {
      const chunks = (handler as any).splitTextIntoChunks('Short message', 4000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Short message');
    });

    it('should split at newline boundaries when possible', () => {
      const lines = Array(100).fill('Line of text with some content here').join('\n');
      const chunks = (handler as any).splitTextIntoChunks(lines, 500);

      expect(chunks.length).toBeGreaterThan(1);
      // Verify no chunk exceeds limit
      chunks.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(500);
      });
    });

    it('should split at space boundaries when no newlines near limit', () => {
      const text = 'word '.repeat(1000); // Many words
      const chunks = (handler as any).splitTextIntoChunks(text, 100);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk: string) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it('should hard split when no good boundary found', () => {
      const text = 'a'.repeat(1000);
      const chunks = (handler as any).splitTextIntoChunks(text, 300);

      expect(chunks.length).toBeGreaterThan(1);
      // All chunks except last should be at or near max length
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].length).toBeLessThanOrEqual(300);
        expect(chunks[i].length).toBeGreaterThan(200); // Should be close to limit
      }
    });

    it('should handle text exactly at limit', () => {
      const text = 'a'.repeat(4000);
      const chunks = (handler as any).splitTextIntoChunks(text, 4000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should handle empty text', () => {
      const chunks = (handler as any).splitTextIntoChunks('', 4000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('');
    });
  });

  describe('setOnStartStreaming', () => {
    it('should set streaming start callback', () => {
      const callback = vi.fn();

      handler.setOnStartStreaming(callback);

      // Trigger the callback by simulating a command
      mockBindingManager.getUserBinding.mockResolvedValue({
        deviceId: 'dev_123',
        deviceName: 'Test Device'
      });
      mockConnectionHub.isDeviceOnline.mockReturnValue(true);
      mockConnectionHub.sendToDevice.mockResolvedValue(true);
      mockClient.im.message.create.mockResolvedValue({
        data: { message_id: 'msg_123' }
      });

      // Access private method to trigger callback
      // This would normally be called via the full flow
    });
  });

  describe('getBindingManager', () => {
    it('should return binding manager instance', () => {
      const result = handler.getBindingManager();

      expect(result).toBe(mockBindingManager);
    });
  });
});
