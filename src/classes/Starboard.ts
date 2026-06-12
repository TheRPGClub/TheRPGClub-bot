import { apiGet, apiPost } from "../services/RpgClubApiClient.js";

export type StarboardRecord = {
  messageId: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: string;
};

type StarboardApiResponse = {
  data: {
    message_id: string;
    channel_id: string;
    author_id: string;
    content: string;
    created_at: string;
  };
};

export type StarboardInsertParams = {
  messageId: string;
  channelId: string;
  authorId: string;
  content: string;
};

export default class Starboard {
  static async getByMessageId(messageId: string): Promise<StarboardRecord | null> {
    const response = await apiGet<StarboardApiResponse>(
      `/api/v1/starboard/${messageId}`,
    );
    if (!response) return null;
    const d = response.data;
    return {
      messageId: d.message_id,
      channelId: d.channel_id,
      authorId: d.author_id,
      content: d.content,
      createdAt: d.created_at,
    };
  }

  static async insert(params: StarboardInsertParams): Promise<void> {
    await apiPost("/api/v1/starboard", {
      data: {
        message_id: params.messageId,
        channel_id: params.channelId,
        author_id: params.authorId,
        content: params.content,
      },
    });
  }
}
