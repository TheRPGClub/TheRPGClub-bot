-- Create journal_message_contexts table for Postgres.
-- The Oracle equivalent was created in 20260516_create_journal_message_contexts.sql,
-- but that script uses PL/SQL syntax and was never applied to the Postgres database.
CREATE TABLE IF NOT EXISTS journal_message_contexts (
  channel_id     VARCHAR(30)  NOT NULL,
  message_id     VARCHAR(30)  NOT NULL,
  created_at_ms  BIGINT       NOT NULL,
  owner_user_id  VARCHAR(30)  NOT NULL,
  game_id        BIGINT       NOT NULL,
  CONSTRAINT pk_journal_message_contexts PRIMARY KEY (channel_id, message_id)
);
