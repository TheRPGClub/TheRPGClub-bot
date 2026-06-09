# public.rpg_club_steam_app_gamedb_map

**Type:** BASE TABLE  
**Estimated rows:** 1752

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | map_id | bigint | No |  | BY DEFAULT |  |
| 2 | steam_app_id | bigint | No |  |  |  |
| 3 | gamedb_game_id | bigint | Yes |  |  |  |
| 4 | status | character varying(20) | No |  |  |  |
| 5 | created_by | character varying(30) | Yes |  |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_steam_app_gamedb_map_status | btree | No | No | status |
| rpg_club_steam_app_gamedb_map_pkey | btree | Yes | Yes | map_id |
| rpg_club_steam_app_gamedb_map_steam_app_id_key | btree | Yes | No | steam_app_id |

### Index Definitions

```sql
CREATE INDEX ix_steam_app_gamedb_map_status ON public.rpg_club_steam_app_gamedb_map USING btree (status);
CREATE UNIQUE INDEX rpg_club_steam_app_gamedb_map_pkey ON public.rpg_club_steam_app_gamedb_map USING btree (map_id);
CREATE UNIQUE INDEX rpg_club_steam_app_gamedb_map_steam_app_id_key ON public.rpg_club_steam_app_gamedb_map USING btree (steam_app_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16804_1_not_null | map_id IS NOT NULL |
| 2200_16804_2_not_null | steam_app_id IS NOT NULL |
| 2200_16804_4_not_null | status IS NOT NULL |
| 2200_16804_6_not_null | created_at IS NOT NULL |
| 2200_16804_7_not_null | updated_at IS NOT NULL |
| ck_steam_app_gamedb_map_status | ((status)::text = ANY (ARRAY[('MAPPED'::character varying)::text, ('SKIPPED'::character varying)::text])) |
