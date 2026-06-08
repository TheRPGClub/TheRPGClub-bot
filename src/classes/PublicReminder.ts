import oracledb from "oracledb";
import { dbQuery, dbMutate, oraMutate, getSql } from "../db/SqlManager.js";
import { getDialect } from "../db/dialect.js";
import { PublicReminderSql } from "../db/sql/index.js";

const dialect = getDialect();

export type RecurrenceUnit = "minutes" | "hours" | "days" | "weeks" | "months" | "years";

export interface IPublicReminder {
  reminderId: number;
  channelId: string;
  message: string;
  dueAt: Date;
  recurEvery: number | null;
  recurUnit: RecurrenceUnit | null;
  enabled: boolean;
  createdBy: string | null;
}

export async function createReminder(
  channelId: string,
  message: string,
  dueAt: Date,
  recurEvery: number | null,
  recurUnit: RecurrenceUnit | null,
  createdBy: string | null,
): Promise<IPublicReminder> {
  const result = await oraMutate(
    getSql(PublicReminderSql.create, dialect),
    {
      channelId,
      message,
      dueAt,
      recurEvery,
      recurUnit,
      createdBy,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  const id = (result.outBinds as any)?.id?.[0] ?? 0;
  return {
    reminderId: Number(id),
    channelId,
    message,
    dueAt,
    recurEvery,
    recurUnit,
    enabled: true,
    createdBy,
  };
}

export async function listUpcomingReminders(limit: number = 20): Promise<IPublicReminder[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return dbQuery(
    PublicReminderSql.listUpcoming,
    { limit: safeLimit },
    (row: {
      REMINDER_ID: number;
      CHANNEL_ID: string;
      MESSAGE: string;
      DUE_AT: Date | string;
      RECUR_EVERY: number | null;
      RECUR_UNIT: RecurrenceUnit | null;
      ENABLED: number;
      CREATED_BY: string | null;
    }): IPublicReminder => ({
      reminderId: Number(row.REMINDER_ID),
      channelId: row.CHANNEL_ID,
      message: row.MESSAGE,
      dueAt: row.DUE_AT instanceof Date ? row.DUE_AT : new Date(row.DUE_AT),
      recurEvery: row.RECUR_EVERY ?? null,
      recurUnit: (row.RECUR_UNIT as RecurrenceUnit | null) ?? null,
      enabled: (row.ENABLED ?? 0) === 1,
      createdBy: row.CREATED_BY ?? null,
    }),
  );
}

export async function deleteReminder(reminderId: number): Promise<boolean> {
  const count = await dbMutate(
    PublicReminderSql.delete,
    { id: reminderId },
  );
  return count > 0;
}

export async function updateReminderDueDate(
  reminderId: number,
  nextDue: Date,
): Promise<void> {
  await dbMutate(
    PublicReminderSql.updateDueDate,
    { nextDue, id: reminderId },
  );
}

export async function disableReminder(reminderId: number): Promise<void> {
  await dbMutate(
    PublicReminderSql.disable,
    { id: reminderId },
  );
}
