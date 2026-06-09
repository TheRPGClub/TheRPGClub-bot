# public.rpg_club_game_keys

**Type:** BASE TABLE  
**Estimated rows:** 9

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | key_id | bigint | No |  | BY DEFAULT |  |
| 2 | game_title | character varying(200) | No |  |  |  |
| 3 | platform | character varying(50) | No |  |  |  |
| 4 | key_value | character varying(200) | No |  |  |  |
| 5 | donor_user_id | character varying(30) | No |  |  |  |
| 6 | claimed_by_user_id | character varying(30) | Yes |  |  |  |
| 7 | claimed_at | timestamp(6) with time zone | Yes |  |  |  |
| 8 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 9 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 10 | donor_notify_on_claim | boolean | No | false |  | 1 when the donor requests a notification on claim. |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_game_keys_available | btree | No | No | claimed_by_user_id, game_title |
| ix_game_keys_title | btree | No | No | game_title |
| rpg_club_game_keys_pkey | btree | Yes | Yes | key_id |

### Index Definitions

```sql
CREATE INDEX ix_game_keys_available ON public.rpg_club_game_keys USING btree (claimed_by_user_id, game_title);
CREATE INDEX ix_game_keys_title ON public.rpg_club_game_keys USING btree (game_title);
CREATE UNIQUE INDEX rpg_club_game_keys_pkey ON public.rpg_club_game_keys USING btree (key_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16700_10_not_null | donor_notify_on_claim IS NOT NULL |
| 2200_16700_1_not_null | key_id IS NOT NULL |
| 2200_16700_2_not_null | game_title IS NOT NULL |
| 2200_16700_3_not_null | platform IS NOT NULL |
| 2200_16700_4_not_null | key_value IS NOT NULL |
| 2200_16700_5_not_null | donor_user_id IS NOT NULL |
| 2200_16700_8_not_null | created_at IS NOT NULL |
| 2200_16700_9_not_null | updated_at IS NOT NULL |
