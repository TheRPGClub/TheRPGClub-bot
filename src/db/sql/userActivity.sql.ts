import type { ISqlEntry } from "./types.js";

export const UserActivityIconSql = {
  mergeActivity: {
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
    postgres: `INSERT INTO rpg_club_user_channel_counts
              (user_id, channel_id, message_count, last_scanned_at, created_at, updated_at)
              VALUES (:userId, :channelId, :count, :scanned, NOW(), NOW())
              ON CONFLICT (user_id, channel_id) DO UPDATE SET
                message_count = COALESCE(rpg_club_user_channel_counts.message_count, 0) + :count,
                last_scanned_at = :scanned,
                updated_at = NOW()`,
  } satisfies ISqlEntry,

  getScannedChannelIds: {
    postgres: `SELECT DISTINCT channel_id FROM rpg_club_user_channel_counts`,
  } satisfies ISqlEntry,

  getChannelScanMeta: {
    postgres: `SELECT channel_id, last_scanned_at FROM rpg_club_user_channel_counts`,
  } satisfies ISqlEntry,
};
