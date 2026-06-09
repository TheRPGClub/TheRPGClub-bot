# public.rpg_club_xbox_title_gamedb_map

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | map_id | bigint | No | nextval('rpg_club_xbox_title_gamedb_map_map_id_seq'::regclass) |  |  |
| 2 | xbox_title_id | character varying(40) | No |  |  |  |
| 3 | gamedb_game_id | bigint | Yes |  |  |  |
| 4 | status | character varying(20) | No |  |  |  |
| 5 | created_by | character varying(30) | Yes |  |  |  |
| 6 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 7 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_xbox_title_gamedb_map_status | btree | No | No | status |
| rpg_club_xbox_title_gamedb_map_pkey | btree | Yes | Yes | map_id |
| ux_xbox_title_gamedb_map_title | btree | Yes | No | xbox_title_id |

### Index Definitions

```sql
CREATE INDEX ix_xbox_title_gamedb_map_status ON public.rpg_club_xbox_title_gamedb_map USING btree (status);
CREATE UNIQUE INDEX rpg_club_xbox_title_gamedb_map_pkey ON public.rpg_club_xbox_title_gamedb_map USING btree (map_id);
CREATE UNIQUE INDEX ux_xbox_title_gamedb_map_title ON public.rpg_club_xbox_title_gamedb_map USING btree (xbox_title_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65649_1_not_null | map_id IS NOT NULL |
| 2200_65649_2_not_null | xbox_title_id IS NOT NULL |
| 2200_65649_4_not_null | status IS NOT NULL |
| 2200_65649_6_not_null | created_at IS NOT NULL |
| 2200_65649_7_not_null | updated_at IS NOT NULL |
| ck_xbox_title_gamedb_map_status | ((status)::text = ANY ((ARRAY['MAPPED'::character varying, 'SKIPPED'::character varying])::text[])) |
