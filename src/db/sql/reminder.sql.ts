import type { SqlEntry } from "./types.js";

const REMINDER_COLS =
  "REMINDER_ID, USER_ID, REMIND_AT, CONTENT, IS_NOISY, SENT_AT," +
  " FAILURE_COUNT, FAILED_AT, CREATED_AT, UPDATED_AT";

export const ReminderSql = {
  create: {
    oracle: `INSERT INTO USER_REMINDERS (
         USER_ID, REMIND_AT, CONTENT, IS_NOISY, SENT_AT, FAILURE_COUNT,
         FAILED_AT, CREATED_AT, UPDATED_AT
       ) VALUES (
         :userId, :remindAt, :content, :noisyVal, NULL, 0, NULL,
         SYSTIMESTAMP, SYSTIMESTAMP
       )
       RETURNING REMINDER_ID INTO :reminderId`,
    postgres: ``,
  } satisfies SqlEntry,

  listByUser: {
    oracle: `SELECT ${REMINDER_COLS}
         FROM USER_REMINDERS
        WHERE USER_ID = :userId
        ORDER BY REMIND_AT`,
    postgres: ``,
  } satisfies SqlEntry,

  getById: {
    oracle: `SELECT ${REMINDER_COLS}
         FROM USER_REMINDERS
        WHERE REMINDER_ID = :reminderId`,
    postgres: ``,
  } satisfies SqlEntry,

  delete: {
    oracle: `DELETE FROM USER_REMINDERS
        WHERE REMINDER_ID = :reminderId
          AND USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  snooze: {
    oracle: `UPDATE USER_REMINDERS
          SET REMIND_AT = :remindAt,
              SENT_AT = NULL,
              FAILURE_COUNT = 0,
              FAILED_AT = NULL,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId
          AND USER_ID = :userId`,
    postgres: ``,
  } satisfies SqlEntry,

  markSent: {
    oracle: `UPDATE USER_REMINDERS
          SET SENT_AT = SYSTIMESTAMP,
              FAILURE_COUNT = 0,
              FAILED_AT = NULL,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: ``,
  } satisfies SqlEntry,

  recordFailure: {
    oracle: `UPDATE USER_REMINDERS
          SET FAILURE_COUNT = FAILURE_COUNT + 1,
              FAILED_AT = SYSTIMESTAMP,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: ``,
  } satisfies SqlEntry,

  markFailedPermanently: {
    oracle: `UPDATE USER_REMINDERS
          SET SENT_AT = SYSTIMESTAMP,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: ``,
  } satisfies SqlEntry,

  getDueUndelivered: {
    oracle: `SELECT ${REMINDER_COLS}
         FROM (
           SELECT ${REMINDER_COLS}
             FROM USER_REMINDERS
            WHERE REMIND_AT <= :cutoff
              AND SENT_AT IS NULL
              AND FAILURE_COUNT < 5
            ORDER BY REMIND_AT
         )
        WHERE ROWNUM <= :limit`,
    postgres: ``,
  } satisfies SqlEntry,
};

export const PublicReminderSql = {
  create: {
    oracle: `INSERT INTO RPG_CLUB_PUBLIC_REMINDERS (
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
    postgres: ``,
  } satisfies SqlEntry,

  listUpcoming: {
    oracle: `SELECT REMINDER_ID,
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
    postgres: ``,
  } satisfies SqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_PUBLIC_REMINDERS WHERE REMINDER_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  updateDueDate: {
    oracle: `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET DUE_AT = :nextDue
      WHERE REMINDER_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,

  disable: {
    oracle: `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET ENABLED = 0
      WHERE REMINDER_ID = :id`,
    postgres: ``,
  } satisfies SqlEntry,
};
