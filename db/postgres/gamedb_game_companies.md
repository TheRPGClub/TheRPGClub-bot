# public.gamedb_game_companies

**Type:** BASE TABLE  
**Estimated rows:** 14811

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | game_id | bigint | No |  |  |  |
| 2 | company_id | bigint | No |  |  |  |
| 3 | role | character varying(20) | No |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_game_companies_pkey | btree | Yes | Yes | game_id, company_id, role |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_game_companies_pkey ON public.gamedb_game_companies USING btree (game_id, company_id, role);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gc_company | company_id | public.gamedb_companies(company_id) | NO ACTION | NO ACTION |
| fk_gc_game | game_id | public.gamedb_games(game_id) | NO ACTION | CASCADE |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16544_1_not_null | game_id IS NOT NULL |
| 2200_16544_2_not_null | company_id IS NOT NULL |
| 2200_16544_3_not_null | role IS NOT NULL |
| sys_c009102 | ((role)::text = ANY (ARRAY[('Developer'::character varying)::text, ('Publisher'::character varying)::text])) |
