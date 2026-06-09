# public.gamedb_collections

**Type:** BASE TABLE  
**Estimated rows:** 0

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | collection_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(255) | No |  |  |  |
| 3 | igdb_collection_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_collections_igdb_collection_id_key | btree | Yes | No | igdb_collection_id |
| gamedb_collections_pkey | btree | Yes | Yes | collection_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_collections_igdb_collection_id_key ON public.gamedb_collections USING btree (igdb_collection_id);
CREATE UNIQUE INDEX gamedb_collections_pkey ON public.gamedb_collections USING btree (collection_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16523_1_not_null | collection_id IS NOT NULL |
| 2200_16523_2_not_null | name IS NOT NULL |
