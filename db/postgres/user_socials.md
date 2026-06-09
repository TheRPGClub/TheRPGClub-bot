# public.user_socials

**Type:** BASE TABLE  
**Estimated rows:** 3

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | id | bigint | No | nextval('user_socials_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | platform_id | bigint | No |  |  |  |
| 4 | display_text | character varying(80) | No |  |  |  |
| 5 | url | character varying(512) | Yes |  |  |  |
| 6 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 7 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| index_user_socials_on_platform_id | btree | No | No | platform_id |
| index_user_socials_on_user_id | btree | No | No | user_id |
| index_user_socials_on_user_platform_display_text | btree | Yes | No | user_id, platform_id, display_text |
| user_socials_pkey | btree | Yes | Yes | id |

### Index Definitions

```sql
CREATE INDEX index_user_socials_on_platform_id ON public.user_socials USING btree (platform_id);
CREATE INDEX index_user_socials_on_user_id ON public.user_socials USING btree (user_id);
CREATE UNIQUE INDEX index_user_socials_on_user_platform_display_text ON public.user_socials USING btree (user_id, platform_id, display_text);
CREATE UNIQUE INDEX user_socials_pkey ON public.user_socials USING btree (id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_114713_1_not_null | id IS NOT NULL |
| 2200_114713_2_not_null | user_id IS NOT NULL |
| 2200_114713_3_not_null | platform_id IS NOT NULL |
| 2200_114713_4_not_null | display_text IS NOT NULL |
| 2200_114713_6_not_null | created_at IS NOT NULL |
| 2200_114713_7_not_null | updated_at IS NOT NULL |
