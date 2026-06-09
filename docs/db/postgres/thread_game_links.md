# public.thread_game_links

**Type:** BASE TABLE  
**Estimated rows:** 49

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | thread_id | character varying(50) | No |  |  |  |
| 2 | gamedb_game_id | bigint | No |  |  |  |
| 3 | linked_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_thread_game_links_game | btree | No | No | gamedb_game_id |
| thread_game_links_pkey | btree | Yes | Yes | thread_id, gamedb_game_id |

### Index Definitions

```sql
CREATE INDEX ix_thread_game_links_game ON public.thread_game_links USING btree (gamedb_game_id);
CREATE UNIQUE INDEX thread_game_links_pkey ON public.thread_game_links USING btree (thread_id, gamedb_game_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65609_1_not_null | thread_id IS NOT NULL |
| 2200_65609_2_not_null | gamedb_game_id IS NOT NULL |
| 2200_65609_3_not_null | linked_at IS NOT NULL |
