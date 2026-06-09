import { dbQuery, dbMutate, dbTransaction, dbMutateConn } from "../db/SqlManager.js";
import { BotVotingInfoSql } from "../db/sql/index.js";

export interface IBotVotingInfoEntry {
  roundNumber: number;
  nominationListId: number | null;
  nextVoteAt: Date;
  fiveDayReminderSent: boolean;
  oneDayReminderSent: boolean;
}

type VotingRow = {
  ROUND_NUMBER: number;
  NOMINATION_LIST_ID: number | null;
  NEXT_VOTE_AT: Date | string;
  FIVE_DAY_REMINDER_SENT: number | null;
  ONE_DAY_REMINDER_SENT: number | null;
};

function mapRowToEntry(row: VotingRow): IBotVotingInfoEntry {
  const roundNumber = Number(row.ROUND_NUMBER);
  const nominationListId =
    row.NOMINATION_LIST_ID === null || row.NOMINATION_LIST_ID === undefined
      ? null
      : Number(row.NOMINATION_LIST_ID);

  const rawDate = row.NEXT_VOTE_AT;
  const nextVoteAt = rawDate instanceof Date ? rawDate : new Date(rawDate as string);

  const fiveDayReminderSent = Boolean(row.FIVE_DAY_REMINDER_SENT ?? 0);
  const oneDayReminderSent = Boolean(row.ONE_DAY_REMINDER_SENT ?? 0);

  if (!Number.isFinite(roundNumber)) {
    throw new Error("Invalid ROUND_NUMBER value in BOT_VOTING_INFO row.");
  }
  if (!(nextVoteAt instanceof Date) || Number.isNaN(nextVoteAt.getTime())) {
    throw new Error("Invalid NEXT_VOTE_AT value in BOT_VOTING_INFO row.");
  }

  return { roundNumber, nominationListId, nextVoteAt, fiveDayReminderSent, oneDayReminderSent };
}

function normalizeRoundNumber(roundNumber: number): number {
  const r = Number(roundNumber);
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error("Invalid round number for BOT_VOTING_INFO.");
  }
  return r;
}

function normalizeDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid Date value for NEXT_VOTE_AT.");
    }
    return value;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date string for NEXT_VOTE_AT.");
  }
  return d;
}

export default class BotVotingInfo {
  static async getAll(): Promise<IBotVotingInfoEntry[]> {
    return dbQuery(
      BotVotingInfoSql.getAll,
      [],
      mapRowToEntry,
    );
  }

  static async getByRound(roundNumber: number): Promise<IBotVotingInfoEntry | null> {
    const round = normalizeRoundNumber(roundNumber);
    const rows = await dbQuery(
      BotVotingInfoSql.getByRound,
      { round },
      mapRowToEntry,
    );
    return rows[0] ?? null;
  }

  static async getCurrentRound(): Promise<IBotVotingInfoEntry | null> {
    const rows = await dbQuery(
      BotVotingInfoSql.getCurrentRound,
      [],
      mapRowToEntry,
    );
    return rows[0] ?? null;
  }

  static async setRoundInfo(
    roundNumber: number,
    nextVoteAt: Date | string,
    nominationListId: number | null,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const nextVote = normalizeDate(nextVoteAt);

    await dbTransaction(async (conn) => {
      const rowsAffected = await dbMutateConn(
        conn,
        BotVotingInfoSql.updateRoundInfo,
        { round, nominationListId, nextVoteAt: nextVote },
      );
      if (rowsAffected > 0) return;
      await dbMutateConn(
        conn,
        BotVotingInfoSql.insertRoundInfo,
        { round, nominationListId, nextVoteAt: nextVote },
      );
    });
  }

  static async markReminderSent(
    roundNumber: number,
    reminder: "fiveDay" | "oneDay",
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const column =
      reminder === "fiveDay" ? "FIVE_DAY_REMINDER_SENT" : "ONE_DAY_REMINDER_SENT";

    const count = await dbMutate(
      BotVotingInfoSql.markReminderSent(column),
      { round },
    );
    if (count === 0) {
      throw new Error(
        `No BOT_VOTING_INFO row found for round ${round} when updating ${column}.`,
      );
    }
  }

  static async updateNextVoteAt(
    roundNumber: number,
    nextVoteAt: Date | string,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const nextVote = normalizeDate(nextVoteAt);
    const count = await dbMutate(
      BotVotingInfoSql.updateNextVoteAt,
      { round, nextVoteAt: nextVote },
    );
    if (count === 0) {
      throw new Error(
        `No BOT_VOTING_INFO row found for round ${round} when updating NEXT_VOTE_AT.`,
      );
    }
  }

  static async updateNominationListId(
    roundNumber: number,
    nominationListId: number | null,
  ): Promise<void> {
    const round = normalizeRoundNumber(roundNumber);
    const count = await dbMutate(
      BotVotingInfoSql.updateNominationListId,
      { round, nominationListId },
    );
    if (count === 0) {
      throw new Error(
        `No BOT_VOTING_INFO row found for round ${round}` +
        ` when updating NOMINATION_LIST_ID.`,
      );
    }
  }

  static async deleteRound(roundNumber: number): Promise<number> {
    const round = normalizeRoundNumber(roundNumber);
    return dbMutate(
      BotVotingInfoSql.deleteRound,
      { round },
    );
  }
}
