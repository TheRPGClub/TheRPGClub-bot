import type { ISqlEntry } from "./types.js";

export const AdminWizardSessionSql = {
  getActive: {
    oracle: `SELECT SESSION_ID,
            COMMAND_KEY,
            OWNER_USER_ID,
            CHANNEL_ID,
            GUILD_ID,
            STATUS,
            STATE_JSON,
            LAST_UPDATED_AT,
            CREATED_AT,
            UPDATED_AT
       FROM RPG_CLUB_ADMIN_WIZARD_SESSIONS
      WHERE COMMAND_KEY = :commandKey
        AND OWNER_USER_ID = :ownerUserId
        AND CHANNEL_ID = :channelId
        AND STATUS = 'ACTIVE'
      ORDER BY LAST_UPDATED_AT DESC
      FETCH FIRST 1 ROWS ONLY`,
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
    oracle: `MERGE INTO RPG_CLUB_ADMIN_WIZARD_SESSIONS t
      USING (
        SELECT :commandKey AS COMMAND_KEY,
               :ownerUserId AS OWNER_USER_ID,
               :channelId AS CHANNEL_ID,
               :guildId AS GUILD_ID,
               :stateJson AS STATE_JSON,
               :lastUpdatedAt AS LAST_UPDATED_AT
          FROM dual
      ) src
         ON (t.COMMAND_KEY = src.COMMAND_KEY
             AND t.OWNER_USER_ID = src.OWNER_USER_ID
             AND t.CHANNEL_ID = src.CHANNEL_ID
             AND t.STATUS = 'ACTIVE')
    WHEN MATCHED THEN
      UPDATE SET t.STATE_JSON = src.STATE_JSON,
                 t.GUILD_ID = src.GUILD_ID,
                 t.LAST_UPDATED_AT = src.LAST_UPDATED_AT
    WHEN NOT MATCHED THEN
      INSERT (SESSION_ID, COMMAND_KEY, OWNER_USER_ID, CHANNEL_ID, GUILD_ID, STATUS,
              STATE_JSON, LAST_UPDATED_AT)
      VALUES (
        :sessionId,
        src.COMMAND_KEY,
        src.OWNER_USER_ID,
        src.CHANNEL_ID,
        src.GUILD_ID,
        'ACTIVE',
        src.STATE_JSON,
        src.LAST_UPDATED_AT
      )`,
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
    oracle: `DELETE FROM RPG_CLUB_ADMIN_WIZARD_SESSIONS
        WHERE COMMAND_KEY = :commandKey
          AND OWNER_USER_ID = :ownerUserId
          AND CHANNEL_ID = :channelId
          AND STATUS = :status`,
    postgres: `DELETE FROM rpg_club_admin_wizard_sessions
        WHERE command_key = :commandKey
          AND owner_user_id = :ownerUserId
          AND channel_id = :channelId
          AND status = :status`,
  } satisfies ISqlEntry,

  updateStatus: {
    oracle: `UPDATE RPG_CLUB_ADMIN_WIZARD_SESSIONS
          SET STATUS = :status,
              LAST_UPDATED_AT = :lastUpdatedAt
        WHERE COMMAND_KEY = :commandKey
          AND OWNER_USER_ID = :ownerUserId
          AND CHANNEL_ID = :channelId
          AND STATUS = 'ACTIVE'`,
    postgres: `UPDATE rpg_club_admin_wizard_sessions
          SET status = :status,
              last_updated_at = :lastUpdatedAt
        WHERE command_key = :commandKey
          AND owner_user_id = :ownerUserId
          AND channel_id = :channelId
          AND status = 'ACTIVE'`,
  } satisfies ISqlEntry,
};
