# public.ar_internal_metadata

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | key | character varying | No |  |  |  |
| 2 | value | character varying | Yes |  |  |  |
| 3 | created_at | timestamp(6) without time zone | No |  |  |  |
| 4 | updated_at | timestamp(6) without time zone | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ar_internal_metadata_pkey | btree | Yes | Yes | key |

### Index Definitions

```sql
CREATE UNIQUE INDEX ar_internal_metadata_pkey ON public.ar_internal_metadata USING btree (key);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_32775_1_not_null | key IS NOT NULL |
| 2200_32775_3_not_null | created_at IS NOT NULL |
| 2200_32775_4_not_null | updated_at IS NOT NULL |
