# public.gamedb_game_themes

**Type:** BASE TABLE  
**Estimated rows:** 14558

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | theme_id | bigint | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_themes_pkey | btree | Yes | Yes | game_id, theme_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_themes_pkey ON public.gamedb_game_themes USING btree (game_id, theme_id);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gt_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |
| fk_gt_theme | theme_id | public.gamedb_themes(theme_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16567_1_not_null | game_id IS NOT NULL |
| 2200_16567_2_not_null | theme_id IS NOT NULL |
