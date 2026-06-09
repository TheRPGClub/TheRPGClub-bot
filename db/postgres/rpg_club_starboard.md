# public.rpg_club_starboard

**Type:** BASE TABLE  
**Estimated rows:** 5

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | message_id | character varying(30) | No |  |  |  |
| 2 | channel_id | character varying(30) | No |  |  |  |
| 3 | starboard_message_id | character varying(30) | No |  |  |  |
| 4 | author_id | character varying(30) | No |  |  |  |
| 5 | star_count | integer | No | 0 |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_starboard_pkey | btree | Yes | Yes | message_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_starboard_pkey ON public.rpg_club_starboard USING btree (message_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16799_1_not_null | message_id IS NOT NULL |
| 2200_16799_2_not_null | channel_id IS NOT NULL |
| 2200_16799_3_not_null | starboard_message_id IS NOT NULL |
| 2200_16799_4_not_null | author_id IS NOT NULL |
| 2200_16799_5_not_null | star_count IS NOT NULL |
| 2200_16799_6_not_null | created_at IS NOT NULL |
