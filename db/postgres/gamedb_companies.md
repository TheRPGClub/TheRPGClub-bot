# public.gamedb_companies

**Type:** BASE TABLE  
**Estimated rows:** 4413

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | company_id | bigint | No |  | BY DEFAULT |  |
| 2 | name | character varying(255) | No |  |  |  |
| 3 | igdb_company_id | bigint | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_companies_igdb_company_id_key | btree | Yes | No | igdb_company_id |
| gamedb_companies_pkey | btree | Yes | Yes | company_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_companies_igdb_company_id_key ON public.gamedb_companies USING btree (igdb_company_id);
CREATE UNIQUE INDEX gamedb_companies_pkey ON public.gamedb_companies USING btree (company_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16527_1_not_null | company_id IS NOT NULL |
| 2200_16527_2_not_null | name IS NOT NULL |
