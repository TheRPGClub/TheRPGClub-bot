CREATE TABLE rpg_club_admin_wizard_sessions (
  session_id VARCHAR(200) NOT NULL,
  command_key VARCHAR(80) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  channel_id VARCHAR(64) NOT NULL,
  guild_id VARCHAR(64),
  status VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL,
  state_json TEXT NOT NULL,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_rpg_club_admin_wizard_sess PRIMARY KEY (session_id),
  CONSTRAINT ck_rpg_club_admin_wiz_sess_status
    CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED'))
);

-- Partial index: only one ACTIVE session per (command_key, owner, channel) at a time.
-- Required for the ON CONFLICT clause in saveSession.
CREATE UNIQUE INDEX ux_rpg_club_admin_wiz_active
  ON rpg_club_admin_wizard_sessions (command_key, owner_user_id, channel_id)
  WHERE status = 'ACTIVE';

CREATE INDEX ix_rpg_club_admin_wiz_owner_status
  ON rpg_club_admin_wizard_sessions (owner_user_id, status, last_updated_at);
