-- Drop the 4-column non-partial unique index created by the original Oracle-style migration.
-- The ON CONFLICT clause in saveSession requires a partial index on 3 columns WHERE status = 'ACTIVE'.
DROP INDEX IF EXISTS ux_rpg_club_admin_wiz_active;

CREATE UNIQUE INDEX ux_rpg_club_admin_wiz_active
  ON rpg_club_admin_wizard_sessions (command_key, owner_user_id, channel_id)
  WHERE status = 'ACTIVE';
