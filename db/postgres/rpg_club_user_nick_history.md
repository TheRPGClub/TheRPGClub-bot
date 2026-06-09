# public.rpg_club_user_nick_history

**Type:** BASE TABLE  
**Estimated rows:** 3

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | event_id | bigint | No |  | BY DEFAULT |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | old_nick | character varying(100) | Yes |  |  |  |
| 4 | new_nick | character varying(100) | Yes |  |  |  |
| 5 | changed_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_user_nick_history_user | btree | No | No | user_id, changed_at |
| rpg_club_user_nick_history_pkey | btree | Yes | Yes | event_id |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_user_nick_history_user ON public.rpg_club_user_nick_history USING btree (user_id, changed_at);
CREATE UNIQUE INDEX rpg_club_user_nick_history_pkey ON public.rpg_club_user_nick_history USING btree (event_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16884_1_not_null | event_id IS NOT NULL |
| 2200_16884_2_not_null | user_id IS NOT NULL |
| 2200_16884_5_not_null | changed_at IS NOT NULL |
