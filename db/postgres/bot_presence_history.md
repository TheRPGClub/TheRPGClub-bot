# public.bot_presence_history

**Type:** BASE TABLE  
**Estimated rows:** 4

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | id | bigint | No |  | BY DEFAULT |  |
| 2 | activity_name | character varying(1020) | No |  |  |  |
| 3 | set_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |
| 4 | set_by_user_id | character varying(128) | Yes |  |  |  |
| 5 | set_by_username | character varying(256) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| bot_presence_history_pkey | btree | Yes | Yes | id |
| ix_bot_presence_history_set_at | btree | No | No | set_at |

### Index Definitions

```sql
CREATE UNIQUE INDEX bot_presence_history_pkey ON public.bot_presence_history USING btree (id);
CREATE INDEX ix_bot_presence_history_set_at ON public.bot_presence_history USING btree (set_at);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16511_1_not_null | id IS NOT NULL |
| 2200_16511_2_not_null | activity_name IS NOT NULL |
| 2200_16511_3_not_null | set_at IS NOT NULL |
