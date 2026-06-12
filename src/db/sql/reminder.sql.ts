import type { ISqlEntry } from "./types.js";

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
