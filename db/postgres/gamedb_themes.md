# public.gamedb_themes

**Type:** BASE TABLE  
**Estimated rows:** 22

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | theme_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(100) | No |  |  |  |
| 3 | igdb_theme_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_themes_igdb_theme_id_key | btree | Yes | No | igdb_theme_id |
| gamedb_themes_pkey | btree | Yes | Yes | theme_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_themes_igdb_theme_id_key ON public.gamedb_themes USING btree (igdb_theme_id);
CREATE UNIQUE INDEX gamedb_themes_pkey ON public.gamedb_themes USING btree (theme_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16626_1_not_null | theme_id IS NOT NULL |
| 2200_16626_2_not_null | name IS NOT NULL |
