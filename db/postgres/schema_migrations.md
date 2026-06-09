# public.schema_migrations

**Type:** BASE TABLE  
**Estimated rows:** 50

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | version | character varying | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| schema_migrations_pkey | btree | Yes | Yes | version |

### Index Definitions

```sql
CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_32768_1_not_null | version IS NOT NULL |
