# public.rpg_club_user_channel_counts

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | user_id | character varying(30) | No |  |  |  |
| 2 | channel_id | character varying(30) | No |  |  |  |
| 3 | message_count | bigint | No | 0 |  |  |
| 4 | last_scanned_at | timestamp(6) with time zone | Yes |  |  |  |
| 5 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 6 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_user_channel_counts_pkey | btree | Yes | Yes | user_id, channel_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_user_channel_counts_pkey ON public.rpg_club_user_channel_counts USING btree (user_id, channel_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16878_1_not_null | user_id IS NOT NULL |
| 2200_16878_2_not_null | channel_id IS NOT NULL |
| 2200_16878_3_not_null | message_count IS NOT NULL |
| 2200_16878_5_not_null | created_at IS NOT NULL |
| 2200_16878_6_not_null | updated_at IS NOT NULL |
