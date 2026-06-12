import type { ISqlEntry } from "./types.js";

export const AdminWizardSessionSql = {
  getActive: {
    postgres: `SELECT session_id,
            command_key,
            owner_user_id,
            channel_id,
            guild_id,
            status,
            state_json,
            last_updated_at,
            created_at,
            updated_at
       FROM rpg_club_admin_wizard_sessions
      WHERE command_key = :commandKey
        AND owner_user_id = :ownerUserId
        AND channel_id = :channelId
        AND status = 'ACTIVE'
      ORDER BY last_updated_at DESC
      LIMIT 1`,
  } satisfies ISqlEntry,

  saveSession: {
    postgres: `INSERT INTO rpg_club_admin_wizard_sessions
        (session_id, command_key, owner_user_id, channel_id, guild_id, status, state_json, last_updated_at)
       VALUES (:sessionId, :commandKey, :ownerUserId, :channelId, :guildId, 'ACTIVE', :stateJson, :lastUpdatedAt)
       ON CONFLICT (command_key, owner_user_id, channel_id) WHERE status = 'ACTIVE'
       DO UPDATE SET
         state_json = EXCLUDED.state_json,
         guild_id = EXCLUDED.guild_id,
         last_updated_at = EXCLUDED.last_updated_at`,
  } satisfies ISqlEntry,

  deleteHistorical: {
    postgres: `DELETE FROM rpg_club_admin_wizard_sessions
        WHERE command_key = :commandKey
          AND owner_user_id = :ownerUserId
          AND channel_id = :channelId
          AND status = :status`,
  } satisfies ISqlEntry,

  updateStatus: {
    postgres: `UPDATE rpg_club_admin_wizard_sessions
          SET status = :status,
              last_updated_at = :lastUpdatedAt
        WHERE command_key = :commandKey
          AND owner_user_id = :ownerUserId
          AND channel_id = :channelId
          AND status = 'ACTIVE'`,
  } satisfies ISqlEntry,
};
