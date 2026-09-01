import { apiGet, apiPost } from "../services/RpgClubApiClient.js";

export type StarboardRecord = {
  messageId: string;
  channelId: string;
  starboardMessageId: string;
  authorId: string;
  starCount: number;
  createdAt: string;
};

type StarboardApiResponse = {
  data: {
    message_id: string;
    channel_id: string;
    starboard_message_id: string;
    author_id: string;
    star_count: number;
    created_at: string;
  };
};

export type StarboardInsertParams = {
  messageId: string;
  channelId: string;
  starboardMessageId: string;
  authorId: string;
  starCount: number;
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
      starboardMessageId: d.starboard_message_id,
      authorId: d.author_id,
      starCount: Number(d.star_count ?? 0),
      createdAt: d.created_at,
    };
  }

  static async insert(params: StarboardInsertParams): Promise<void> {
    await apiPost("/api/v1/starboard", {
      data: {
        message_id: params.messageId,
        channel_id: params.channelId,
        starboard_message_id: params.starboardMessageId,
        author_id: params.authorId,
        star_count: params.starCount,
      },
    });
  }
}
