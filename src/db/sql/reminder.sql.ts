import type { ISqlEntry } from "./types.js";

const REMINDER_COLS_PG =
  "reminder_id, user_id, remind_at, content, is_noisy, sent_at," +
  " failure_count, failed_at, created_at, updated_at";

export const ReminderSql = {
  create: {
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
    postgres: `SELECT ${REMINDER_COLS_PG}
         FROM user_reminders
        WHERE user_id = :userId
        ORDER BY remind_at`,
  } satisfies ISqlEntry,

  getById: {
    postgres: `SELECT ${REMINDER_COLS_PG}
         FROM user_reminders
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  delete: {
    postgres: `DELETE FROM user_reminders
        WHERE reminder_id = :reminderId
          AND user_id = :userId`,
  } satisfies ISqlEntry,

  snooze: {
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
    postgres: `UPDATE user_reminders
          SET sent_at = NOW(),
              failure_count = 0,
              failed_at = NULL,
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  recordFailure: {
    postgres: `UPDATE user_reminders
          SET failure_count = failure_count + 1,
              failed_at = NOW(),
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  markFailedPermanently: {
    postgres: `UPDATE user_reminders
          SET sent_at = NOW(),
              updated_at = NOW()
        WHERE reminder_id = :reminderId`,
  } satisfies ISqlEntry,

  getDueUndelivered: {
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
    postgres: `DELETE FROM rpg_club_public_reminders WHERE reminder_id = :id`,
  } satisfies ISqlEntry,

  updateDueDate: {
    postgres: `UPDATE rpg_club_public_reminders
        SET due_at = :nextDue
      WHERE reminder_id = :id`,
  } satisfies ISqlEntry,

  disable: {
    postgres: `UPDATE rpg_club_public_reminders
        SET enabled = false
      WHERE reminder_id = :id`,
  } satisfies ISqlEntry,
};
