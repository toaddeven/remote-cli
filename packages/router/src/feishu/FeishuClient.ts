import axios, { AxiosInstance } from 'axios';

/**
 * Feishu API Client
 * Responsible for interacting with Feishu API, sending messages and managing access tokens
 */
export class FeishuClient {
  private appId: string;
  private appSecret: string;
  private axios: AxiosInstance;
  private accessToken: string = '';
  private tokenExpireTime: number = 0;

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;

    this.axios = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 10000
    });
  }

  /**
   * Get access token (with cache)
   * @returns Access token
   */
  async getAccessToken(): Promise<string> {
    // If token exists and has not expired, return directly
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }

    // Get new token
    const response = await this.axios.post('/auth/v3/tenant_access_token/internal', {
      app_id: this.appId,
      app_secret: this.appSecret
    });

    if (response.data.code !== 0) {
      throw new Error(`Failed to get access token: ${response.data.msg || 'Unknown error'}`);
    }

    this.accessToken = response.data.tenant_access_token!;
    // Token validity period, refresh 5 minutes early
    this.tokenExpireTime = Date.now() + (response.data.expire - 300) * 1000;

    return this.accessToken;
  }

  /**
   * Send text message
   * @param openId Feishu user open_id
   * @param text Message text
   * @returns Whether sending was successful
   */
  async sendTextMessage(openId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axios.post(
        '/im/v1/messages',
        {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text })
        },
        {
          params: { receive_id_type: 'open_id' },
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      return response.data.code === 0;
    } catch (error) {
      console.error('Failed to send text message:', error);
      return false;
    }
  }

  /**
   * Send Markdown message
   * @param openId Feishu user open_id
   * @param markdown Markdown content
   * @returns Whether sending was successful
   */
  async sendMarkdownMessage(openId: string, markdown: string): Promise<boolean> {
    // Feishu text messages support partial Markdown, use text type directly
    return this.sendTextMessage(openId, markdown);
  }

  /**
   * Send card message
   * @param openId Feishu user open_id
   * @param card Card content
   * @returns Whether sending was successful
   */
  async sendCardMessage(openId: string, card: any): Promise<boolean> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axios.post(
        '/im/v1/messages',
        {
          receive_id: openId,
          msg_type: 'interactive',
          content: JSON.stringify(card)
        },
        {
          params: { receive_id_type: 'open_id' },
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      return response.data.code === 0;
    } catch (error) {
      console.error('Failed to send card message:', error);
      return false;
    }
  }

  /**
   * Reply to message
   * @param messageId Message ID to reply to
   * @param text Reply content
   * @returns Whether sending was successful
   */
  async replyToMessage(messageId: string, text: string): Promise<boolean> {
    try {
      const token = await this.getAccessToken();

      const response = await this.axios.post(
        `/im/v1/messages/${messageId}/reply`,
        {
          msg_type: 'text',
          content: JSON.stringify({ text })
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      return response.data.code === 0;
    } catch (error) {
      console.error('Failed to reply to message:', error);
      return false;
    }
  }
}
