import oracledb from "oracledb";
import { oraQuery, oraMutate } from "../db/SqlManager.js";

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
    `INSERT INTO RPG_CLUB_PUBLIC_REMINDERS (
       CHANNEL_ID,
       MESSAGE,
       DUE_AT,
       RECUR_EVERY,
       RECUR_UNIT,
       ENABLED,
       CREATED_BY
     ) VALUES (
       :channelId,
       :message,
       :dueAt,
       :recurEvery,
       :recurUnit,
       1,
       :createdBy
     )
     RETURNING REMINDER_ID INTO :id`,
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
  return oraQuery(
    `SELECT REMINDER_ID,
            CHANNEL_ID,
            MESSAGE,
            DUE_AT,
            RECUR_EVERY,
            RECUR_UNIT,
            ENABLED,
            CREATED_BY
       FROM RPG_CLUB_PUBLIC_REMINDERS
      WHERE ENABLED = 1
      ORDER BY DUE_AT ASC
      FETCH FIRST :limit ROWS ONLY`,
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
  const result = await oraMutate(
    `DELETE FROM RPG_CLUB_PUBLIC_REMINDERS WHERE REMINDER_ID = :id`,
    { id: reminderId },
  );
  return (result.rowsAffected ?? 0) > 0;
}

export async function updateReminderDueDate(
  reminderId: number,
  nextDue: Date,
): Promise<void> {
  await oraMutate(
    `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET DUE_AT = :nextDue
      WHERE REMINDER_ID = :id`,
    { nextDue, id: reminderId },
  );
}

export async function disableReminder(reminderId: number): Promise<void> {
  await oraMutate(
    `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET ENABLED = 0
      WHERE REMINDER_ID = :id`,
    { id: reminderId },
  );
}
