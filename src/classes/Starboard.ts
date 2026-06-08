import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { StarboardSql } from "../db/sql/index.js";

const dialect = getDialect();

export type StarboardRecord = {
  messageId: string;
  channelId: string;
  starboardMessageId: string;
  authorId: string;
  starCount: number;
  createdAt: Date;
};

export default class Starboard {
  static async getByMessageId(messageId: string): Promise<StarboardRecord | null> {
    const rows = await oraQuery(
      getSql(StarboardSql.getByMessageId, dialect),
      { messageId },
      (row: {
        MESSAGE_ID: string;
        CHANNEL_ID: string;
        STARBOARD_MESSAGE_ID: string;
        AUTHOR_ID: string;
        STAR_COUNT: number;
        CREATED_AT: Date | string;
      }): StarboardRecord => ({
        messageId: row.MESSAGE_ID,
        channelId: row.CHANNEL_ID,
        starboardMessageId: row.STARBOARD_MESSAGE_ID,
        authorId: row.AUTHOR_ID,
        starCount: Number(row.STAR_COUNT ?? 0),
        createdAt: row.CREATED_AT instanceof Date
          ? row.CREATED_AT
          : new Date(row.CREATED_AT),
      }),
    );
    return rows[0] ?? null;
  }

  static async insert(record: Omit<StarboardRecord, "createdAt">): Promise<void> {
    await oraMutate(
      getSql(StarboardSql.insert, dialect),
      {
        messageId: record.messageId,
        channelId: record.channelId,
        starboardMessageId: record.starboardMessageId,
        authorId: record.authorId,
        starCount: record.starCount,
      },
    );
  }
}
