# public.journal_message_contexts

**Type:** BASE TABLE

Tracks active journal message contexts so they can be restored after a bot restart.
Each row maps a Discord message (identified by channel + message ID) to the owner
and game whose journal view is rendered in that message.

## Columns

**channel_id** `character varying(30)` NOT NULL -- Discord channel snowflake

**message_id** `character varying(30)` NOT NULL -- Discord message snowflake

**created_at_ms** `bigint` NOT NULL -- Unix epoch ms when the context was first created

**owner_user_id** `character varying(30)` NOT NULL -- Discord user snowflake of the journal owner

**game_id** `bigint` NOT NULL -- GameDB game ID

## Indexes

**pk_journal_message_contexts** -- btree, unique, primary key on (channel_id, message_id)
