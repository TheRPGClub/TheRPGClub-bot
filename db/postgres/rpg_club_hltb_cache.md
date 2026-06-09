# public.rpg_club_hltb_cache

**Type:** BASE TABLE  
**Estimated rows:** 88

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | cache_id | bigint | No |  | BY DEFAULT |  |
| 2 | gamedb_game_id | bigint | No |  |  |  |
| 3 | hltb_name | character varying(255) | Yes |  |  |  |
| 4 | hltb_url | character varying(512) | Yes |  |  |  |
| 5 | hltb_image_url | character varying(512) | Yes |  |  |  |
| 6 | main | character varying(50) | Yes |  |  |  |
| 7 | main_sides | character varying(50) | Yes |  |  |  |
| 8 | completionist | character varying(50) | Yes |  |  |  |
| 9 | single_player | character varying(50) | Yes |  |  |  |
| 10 | co_op | character varying(50) | Yes |  |  |  |
| 11 | vs | character varying(50) | Yes |  |  |  |
| 12 | source_query | character varying(255) | Yes |  |  |  |
| 13 | scraped_at | timestamp(6) without time zone | Yes | CURRENT_TIMESTAMP |  |  |
| 14 | updated_at | timestamp(6) without time zone | Yes | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_hltb_cache_pkey | btree | Yes | Yes | cache_id |
| uq_hltb_game_id | btree | Yes | No | gamedb_game_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_hltb_cache_pkey ON public.rpg_club_hltb_cache USING btree (cache_id);
CREATE UNIQUE INDEX uq_hltb_game_id ON public.rpg_club_hltb_cache USING btree (gamedb_game_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16745_1_not_null | cache_id IS NOT NULL |
| 2200_16745_2_not_null | gamedb_game_id IS NOT NULL |
