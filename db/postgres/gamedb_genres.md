# public.gamedb_genres

**Type:** BASE TABLE  
**Estimated rows:** 23

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | genre_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(100) | No |  |  |  |
| 3 | igdb_genre_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_genres_igdb_genre_id_key | btree | Yes | No | igdb_genre_id |
| gamedb_genres_pkey | btree | Yes | Yes | genre_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_genres_igdb_genre_id_key ON public.gamedb_genres USING btree (igdb_genre_id);
CREATE UNIQUE INDEX gamedb_genres_pkey ON public.gamedb_genres USING btree (genre_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16580_1_not_null | genre_id IS NOT NULL |
| 2200_16580_2_not_null | name IS NOT NULL |
