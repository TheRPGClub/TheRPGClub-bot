# public.gamedb_game_platforms

**Type:** BASE TABLE  
**Estimated rows:** 19144

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | platform_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_platforms_pkey | btree | Yes | Yes | game_id, platform_id |
| idx_ggp_game | btree | No | No | game_id |
| idx_ggp_platform | btree | No | No | platform_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_platforms_pkey ON public.gamedb_game_platforms USING btree (game_id, platform_id);
CREATE INDEX idx_ggp_game ON public.gamedb_game_platforms USING btree (game_id);
CREATE INDEX idx_ggp_platform ON public.gamedb_game_platforms USING btree (platform_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16564_1_not_null | game_id IS NOT NULL |
| 2200_16564_2_not_null | platform_id IS NOT NULL |
