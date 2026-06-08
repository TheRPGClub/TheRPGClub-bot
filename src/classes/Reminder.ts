import oracledb from "oracledb";
import type { Connection } from "oracledb";
import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { getSql } from "../db/SqlManager.js";
import { ReminderSql } from "../db/sql/index.js";

const dialect = getDialect();

export interface IReminderRecord {
  reminderId: number;
  userId: string;
  remindAt: Date;
  content: string;
  isNoisy: boolean;
  sentAt: Date | null;
  failureCount: number;
  failedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

function normalizeReminderId(value: number): number {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid reminder id.");
  }
  return id;
}

function normalizeDate(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid date value.");
    }
    return value;
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    throw new Error("Invalid date value.");
  }
  return asDate;
}

function normalizeContent(value: string): string {
  const trimmed = (value ?? "").toString().trim();
  if (!trimmed.length) {
    return "Reminder";
  }
  if (trimmed.length <= 400) {
    return trimmed;
  }
  return trimmed.slice(0, 400);
}

type ReminderRow = {
  REMINDER_ID: number;
  USER_ID: string;
  REMIND_AT: Date | string;
  CONTENT: string;
  IS_NOISY: number;
  SENT_AT: Date | string | null;
  FAILURE_COUNT: number;
  FAILED_AT: Date | string | null;
  CREATED_AT: Date | string | null;
  UPDATED_AT: Date | string | null;
};

function mapRowToReminder(row: ReminderRow): IReminderRecord {
  const reminderId = normalizeReminderId(row.REMINDER_ID);
  const remindAt = normalizeDate(row.REMIND_AT);
  const content = normalizeContent(row.CONTENT);
  const isNoisy = Boolean(row.IS_NOISY);

  const sentAt =
    row.SENT_AT === null || row.SENT_AT === undefined ? null : normalizeDate(row.SENT_AT);
  const failedAt =
    row.FAILED_AT === null || row.FAILED_AT === undefined ? null : normalizeDate(row.FAILED_AT);
  const createdAt =
    row.CREATED_AT === null || row.CREATED_AT === undefined
      ? null
      : normalizeDate(row.CREATED_AT);
  const updatedAt =
    row.UPDATED_AT === null || row.UPDATED_AT === undefined
      ? null
      : normalizeDate(row.UPDATED_AT);

  return {
    reminderId,
    userId: row.USER_ID,
    remindAt,
    content,
    isNoisy,
    sentAt,
    failureCount: row.FAILURE_COUNT ?? 0,
    failedAt,
    createdAt,
    updatedAt,
  };
}

export default class Reminder {
  static async create(
    userId: string,
    remindAt: Date | string,
    content: string,
    isNoisy: boolean = false,
  ): Promise<IReminderRecord> {
    const normalizedDate = normalizeDate(remindAt);
    const normalizedContent = normalizeContent(content);
    const noisyVal = isNoisy ? 1 : 0;

    const result = await oraMutate(
      getSql(ReminderSql.create, dialect),
      {
        userId,
        remindAt: normalizedDate,
        content: normalizedContent,
        noisyVal,
        reminderId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );

    const out = (result.outBinds ?? {}) as { reminderId?: number[] };
    const reminderId = normalizeReminderId(out.reminderId?.[0] ?? 0);

    const inserted = await Reminder.getById(reminderId);
    if (!inserted) {
      throw new Error(`Failed to read inserted reminder ${reminderId}.`);
    }
    return inserted;
  }

  static async listByUser(userId: string): Promise<IReminderRecord[]> {
    return oraQuery(
      getSql(ReminderSql.listByUser, dialect),
      { userId },
      mapRowToReminder,
    );
  }

  static async getById(
    reminderId: number,
    opts?: { connection?: Connection },
  ): Promise<IReminderRecord | null> {
    const id = normalizeReminderId(reminderId);
    const rows = await oraQuery(
      getSql(ReminderSql.getById, dialect),
      { reminderId: id },
      mapRowToReminder,
      opts?.connection,
    );
    return rows[0] ?? null;
  }

  static async delete(reminderId: number, userId: string): Promise<boolean> {
    const id = normalizeReminderId(reminderId);
    const result = await oraMutate(
      getSql(ReminderSql.delete, dialect),
      { reminderId: id, userId },
    );
    return (result.rowsAffected ?? 0) > 0;
  }

  static async snooze(
    reminderId: number,
    userId: string,
    remindAt: Date | string,
  ): Promise<IReminderRecord | null> {
    const id = normalizeReminderId(reminderId);
    const normalizedDate = normalizeDate(remindAt);

    const result = await oraMutate(
      getSql(ReminderSql.snooze, dialect),
      { reminderId: id, userId, remindAt: normalizedDate },
    );

    if ((result.rowsAffected ?? 0) === 0) {
      return null;
    }
    return Reminder.getById(reminderId);
  }

  static async markSent(reminderId: number): Promise<void> {
    const id = normalizeReminderId(reminderId);
    const result = await oraMutate(
      getSql(ReminderSql.markSent, dialect),
      { reminderId: id },
    );
    if ((result.rowsAffected ?? 0) === 0) {
      throw new Error(`No reminder found for id ${id} when marking as sent.`);
    }
  }

  static async recordFailure(reminderId: number): Promise<void> {
    const id = normalizeReminderId(reminderId);
    await oraMutate(
      getSql(ReminderSql.recordFailure, dialect),
      { reminderId: id },
    );
  }

  static async markFailedPermanently(reminderId: number): Promise<void> {
    const id = normalizeReminderId(reminderId);
    await oraMutate(
      getSql(ReminderSql.markFailedPermanently, dialect),
      { reminderId: id },
    );
  }

  static async getDueUndelivered(
    cutoff: Date = new Date(),
    limit = 20,
  ): Promise<IReminderRecord[]> {
    const normalizedDate = normalizeDate(cutoff);
    const safeLimit = Math.max(1, Math.min(limit, 100));

    return oraQuery(
      getSql(ReminderSql.getDueUndelivered, dialect),
      { cutoff: normalizedDate, limit: safeLimit },
      mapRowToReminder,
    );
  }
}
