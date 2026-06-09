# public.help

**Type:** BASE TABLE  
**Estimated rows:** 978

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | topic | character varying(50) | No |  |  |  |
| 2 | seq | bigint | No |  |  |  |
| 3 | info | character varying(80) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| help_pkey | btree | Yes | Yes | topic, seq |

### Index Definitions

```sql
CREATE UNIQUE INDEX help_pkey ON public.help USING btree (topic, seq);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16643_1_not_null | topic IS NOT NULL |
| 2200_16643_2_not_null | seq IS NOT NULL |
