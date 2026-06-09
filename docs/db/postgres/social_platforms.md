# public.social_platforms

**Type:** BASE TABLE  
**Estimated rows:** 7

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | id | bigint | No | nextval('social_platforms_id_seq'::regclass) |  |  |
| 2 | label | character varying(80) | No |  |  |  |
| 3 | position | integer | No | 1000 |  |  |
| 4 | created_by_user_id | character varying(30) | Yes |  |  |  |
| 5 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 6 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| index_social_platforms_on_lower_label | btree | Yes | No |  |
| index_social_platforms_on_position | btree | No | No | position |
| social_platforms_pkey | btree | Yes | Yes | id |

### Index Definitions

```sql
CREATE UNIQUE INDEX index_social_platforms_on_lower_label ON public.social_platforms USING btree (lower((label)::text));
CREATE INDEX index_social_platforms_on_position ON public.social_platforms USING btree ("position");
CREATE UNIQUE INDEX social_platforms_pkey ON public.social_platforms USING btree (id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_114701_1_not_null | id IS NOT NULL |
| 2200_114701_2_not_null | label IS NOT NULL |
| 2200_114701_3_not_null | position IS NOT NULL |
| 2200_114701_5_not_null | created_at IS NOT NULL |
| 2200_114701_6_not_null | updated_at IS NOT NULL |
