import type { ISqlEntry } from "./types.js";

const REMINDER_COLS =
  "REMINDER_ID, USER_ID, REMIND_AT, CONTENT, IS_NOISY, SENT_AT," +
  " FAILURE_COUNT, FAILED_AT, CREATED_AT, UPDATED_AT";

const REMINDER_COLS_PG =
  "reminder_id, user_id, remind_at, content, is_noisy, sent_at," +
  " failure_count, failed_at, created_at, updated_at";

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
    postgres: `INSERT INTO user_reminders (
         user_id, remind_at, content, is_noisy, sent_at, failure_count,
         failed_at, created_at, updated_at
       ) VALUES (
         :userId, :remindAt, :content, :noisyVal, NULL, 0, NULL,
         NOW(), NOW()
       )
       RETURNING reminder_id`,
  } satisfies ISqlEntry,

  listByUser: {
    oracle: `SELECT ${REMINDER_COLS}
         FROM USER_REMINDERS
        WHERE USER_ID = :userId
        ORDER BY REMIND_AT`,
    postgres: `SELECT ${REMINDER_COLS_PG}
         FROM user_reminders
        WHERE user_id = :userId
        ORDER BY remind_at`,
  } satisfies ISqlEntry,

  getById: {
    oracle: `SELECT ${REMINDER_COLS}
         FROM USER_REMINDERS
        WHERE REMINDER_ID = :reminderId`,
    postgres: `SELECT ${REMINDER_COLS_PG}
         FROM user_reminders
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  delete: {
    oracle: `DELETE FROM USER_REMINDERS
        WHERE REMINDER_ID = :reminderId
          AND USER_ID = :userId`,
    postgres: `DELETE FROM user_reminders
        WHERE reminder_id = :reminderId
          AND user_id = :userId`,
  } satisfies ISqlEntry,

  snooze: {
    oracle: `UPDATE USER_REMINDERS
          SET REMIND_AT = :remindAt,
              SENT_AT = NULL,
              FAILURE_COUNT = 0,
              FAILED_AT = NULL,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId
          AND USER_ID = :userId`,
    postgres: `UPDATE user_reminders
          SET remind_at = :remindAt,
              sent_at = NULL,
              failure_count = 0,
              failed_at = NULL,
              updated_at = NOW()
        WHERE reminder_id = :reminderId
          AND user_id = :userId`,
  } satisfies ISqlEntry,

  markSent: {
    oracle: `UPDATE USER_REMINDERS
          SET SENT_AT = SYSTIMESTAMP,
              FAILURE_COUNT = 0,
              FAILED_AT = NULL,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: `UPDATE user_reminders
          SET sent_at = NOW(),
              failure_count = 0,
              failed_at = NULL,
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  recordFailure: {
    oracle: `UPDATE USER_REMINDERS
          SET FAILURE_COUNT = FAILURE_COUNT + 1,
              FAILED_AT = SYSTIMESTAMP,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: `UPDATE user_reminders
          SET failure_count = failure_count + 1,
              failed_at = NOW(),
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  markFailedPermanently: {
    oracle: `UPDATE USER_REMINDERS
          SET SENT_AT = SYSTIMESTAMP,
              UPDATED_AT = SYSTIMESTAMP
        WHERE REMINDER_ID = :reminderId`,
    postgres: `UPDATE user_reminders
          SET sent_at = NOW(),
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

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
    postgres: `SELECT ${REMINDER_COLS_PG}
         FROM user_reminders
        WHERE remind_at <= :cutoff
          AND sent_at IS NULL
          AND failure_count < 5
        ORDER BY remind_at
        LIMIT :limit`,
  } satisfies ISqlEntry,
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
    postgres: `INSERT INTO rpg_club_public_reminders (
       channel_id,
       message,
       due_at,
       recur_every,
       recur_unit,
       enabled,
       created_by
     ) VALUES (
       :channelId,
       :message,
       :dueAt,
       :recurEvery,
       :recurUnit,
       true,
       :createdBy
     )
     RETURNING reminder_id`,
  } satisfies ISqlEntry,

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
    postgres: `SELECT reminder_id,
            channel_id,
            message,
            due_at,
            recur_every,
            recur_unit,
            enabled,
            created_by
       FROM rpg_club_public_reminders
      WHERE enabled = true
      ORDER BY due_at ASC
      LIMIT :limit`,
  } satisfies ISqlEntry,

  delete: {
    oracle: `DELETE FROM RPG_CLUB_PUBLIC_REMINDERS WHERE REMINDER_ID = :id`,
    postgres: `DELETE FROM rpg_club_public_reminders WHERE reminder_id = :id`,
  } satisfies ISqlEntry,

  updateDueDate: {
    oracle: `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET DUE_AT = :nextDue
      WHERE REMINDER_ID = :id`,
    postgres: `UPDATE rpg_club_public_reminders
        SET due_at = :nextDue
      WHERE reminder_id = :id`,
  } satisfies ISqlEntry,

  disable: {
    oracle: `UPDATE RPG_CLUB_PUBLIC_REMINDERS
        SET ENABLED = 0
      WHERE REMINDER_ID = :id`,
    postgres: `UPDATE rpg_club_public_reminders
        SET enabled = false
      WHERE reminder_id = :id`,
  } satisfies ISqlEntry,
};
