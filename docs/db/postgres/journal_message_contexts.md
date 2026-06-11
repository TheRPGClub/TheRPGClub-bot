# public.journal_message_contexts

**Type:** BASE TABLE

Tracks active journal message contexts so they can be restored after a bot restart.
Each row maps a Discord message (identified by channel + message ID) to the owner
and game whose journal view is rendered in that message.

## Columns

| # | Column | Type | Nullable | Description |
| - | ------ | ---- | -------- | ----------- |
| 1 | channel_id | character varying(30) | No | Discord channel snowflake |
| 2 | message_id | character varying(30) | No | Discord message snowflake |
| 3 | created_at_ms | bigint | No | Unix epoch ms when the context was first created |
| 4 | owner_user_id | character varying(30) | No | Discord user snowflake of the journal owner |
| 5 | game_id | bigint | No | GameDB game ID |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| pk_journal_message_contexts | btree | Yes | Yes | channel_id, message_id |
