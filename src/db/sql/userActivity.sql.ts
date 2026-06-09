import type { ISqlEntry } from "./types.js";

export const UserActivityIconSql = {
  mergeActivity: {
    oracle: `MERGE INTO RPG_CLUB_USER_ACTIVITY_ICONS t
USING (
  SELECT
    :userId AS USER_ID,
    :username AS USERNAME,
    :activityName AS ACTIVITY_NAME,
    :activityNameNorm AS ACTIVITY_NAME_NORM,
    :iconType AS ICON_TYPE,
    :sourceRef AS SOURCE_REF,
    :iconUrl AS ICON_URL
  FROM dual
) s
ON (
  t.USER_ID = s.USER_ID
  AND t.ACTIVITY_NAME_NORM = s.ACTIVITY_NAME_NORM
  AND t.ICON_TYPE = s.ICON_TYPE
  AND t.SOURCE_REF = s.SOURCE_REF
)
WHEN MATCHED THEN
  UPDATE SET
    t.USERNAME = s.USERNAME,
    t.ICON_URL = s.ICON_URL,
    t.LAST_SEEN_AT = SYSTIMESTAMP,
    t.SEEN_COUNT = t.SEEN_COUNT + 1
WHEN NOT MATCHED THEN
  INSERT (
    USER_ID, USERNAME, ACTIVITY_NAME, ACTIVITY_NAME_NORM,
    ICON_TYPE, SOURCE_REF, ICON_URL,
    FIRST_SEEN_AT, LAST_SEEN_AT, SEEN_COUNT
  )
  VALUES (
    s.USER_ID, s.USERNAME, s.ACTIVITY_NAME, s.ACTIVITY_NAME_NORM,
    s.ICON_TYPE, s.SOURCE_REF, s.ICON_URL,
    SYSTIMESTAMP, SYSTIMESTAMP, 1
  )`,
    postgres: `INSERT INTO rpg_club_user_activity_icons
  (user_id, username, activity_name, activity_name_norm, icon_type, source_ref, icon_url,
   first_seen_at, last_seen_at, seen_count)
  VALUES (:userId, :username, :activityName, :activityNameNorm, :iconType, :sourceRef, :iconUrl,
          NOW(), NOW(), 1)
  ON CONFLICT (user_id, activity_name_norm, icon_type, source_ref) DO UPDATE SET
    username = EXCLUDED.username,
    icon_url = EXCLUDED.icon_url,
    last_seen_at = NOW(),
    seen_count = rpg_club_user_activity_icons.seen_count + 1`,
  } satisfies ISqlEntry,

  getRecentForUsers: (userGroupClauses: string) =>
    ({
      oracle: `SELECT
         USER_ID,
         ACTIVITY_NAME,
         ICON_TYPE,
         SOURCE_REF,
         ICON_URL,
         LAST_SEEN_AT
       FROM RPG_CLUB_USER_ACTIVITY_ICONS
       WHERE (${userGroupClauses})
         AND LAST_SEEN_AT >= SYSTIMESTAMP - NUMTODSINTERVAL(:days, 'DAY')
         AND (:activityNameNorm IS NULL OR ACTIVITY_NAME_NORM = :activityNameNorm)
         AND (:iconType IS NULL OR ICON_TYPE = :iconType)
       ORDER BY LAST_SEEN_AT DESC`,
      postgres: `SELECT
         user_id,
         activity_name,
         icon_type,
         source_ref,
         icon_url,
         last_seen_at
       FROM rpg_club_user_activity_icons
       WHERE (${userGroupClauses})
         AND last_seen_at >= NOW() - (:days * INTERVAL '1 day')
         AND (:activityNameNorm IS NULL OR activity_name_norm = :activityNameNorm)
         AND (:iconType IS NULL OR icon_type = :iconType)
       ORDER BY last_seen_at DESC`,
    }) satisfies ISqlEntry,
};

export const UserChannelMessageCountSql = {
  upsertChannelCounts: {
    oracle: `MERGE INTO RPG_CLUB_USER_CHANNEL_COUNTS t
            USING (
              SELECT :userId AS user_id,
                     :channelId AS channel_id,
                     :count AS message_count,
                     :scanned AS scanned
                FROM dual
            ) s
               ON (t.USER_ID = s.user_id AND t.CHANNEL_ID = s.channel_id)
             WHEN MATCHED THEN
               UPDATE SET t.MESSAGE_COUNT = NVL(t.MESSAGE_COUNT, 0) + s.message_count,
                          t.LAST_SCANNED_AT = s.scanned,
                          t.UPDATED_AT = SYSTIMESTAMP
             WHEN NOT MATCHED THEN
               INSERT (USER_ID, CHANNEL_ID, MESSAGE_COUNT, LAST_SCANNED_AT,
                       CREATED_AT, UPDATED_AT)
               VALUES (s.user_id, s.channel_id, s.message_count, s.scanned,
                       SYSTIMESTAMP, SYSTIMESTAMP)`,
    postgres: `INSERT INTO rpg_club_user_channel_counts
              (user_id, channel_id, message_count, last_scanned_at, created_at, updated_at)
              VALUES (:userId, :channelId, :count, :scanned, NOW(), NOW())
              ON CONFLICT (user_id, channel_id) DO UPDATE SET
                message_count = COALESCE(rpg_club_user_channel_counts.message_count, 0) + :count,
                last_scanned_at = :scanned,
                updated_at = NOW()`,
  } satisfies ISqlEntry,

  getScannedChannelIds: {
    oracle: `SELECT DISTINCT CHANNEL_ID FROM RPG_CLUB_USER_CHANNEL_COUNTS`,
    postgres: `SELECT DISTINCT channel_id FROM rpg_club_user_channel_counts`,
  } satisfies ISqlEntry,

  getChannelScanMeta: {
    oracle: `SELECT CHANNEL_ID, LAST_SCANNED_AT FROM RPG_CLUB_USER_CHANNEL_COUNTS`,
    postgres: `SELECT channel_id, last_scanned_at FROM rpg_club_user_channel_counts`,
  } satisfies ISqlEntry,
};
