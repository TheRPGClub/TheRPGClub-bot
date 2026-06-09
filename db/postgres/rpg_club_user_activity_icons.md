# public.rpg_club_user_activity_icons

**Type:** BASE TABLE  
**Estimated rows:** 3242

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | id | bigint | No |  | BY DEFAULT |  |
| 2 | user_id | character varying(128) | No |  |  |  |
| 3 | username | character varying(256) | Yes |  |  |  |
| 4 | activity_name | character varying(256) | No |  |  |  |
| 5 | activity_name_norm | character varying(256) | No |  |  |  |
| 6 | icon_type | character varying(16) | No |  |  |  |
| 7 | source_ref | character varying(1024) | No |  |  |  |
| 8 | icon_url | character varying(2048) | No |  |  |  |
| 9 | first_seen_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |
| 10 | last_seen_at | timestamp(6) without time zone | No | statement_timestamp() |  |  |
| 11 | seen_count | bigint | No | 1 |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| idx_rpg_club_user_activity_icons_lookup | btree | No | No | user_id, last_seen_at, activity_name_norm, icon_type |
| rpg_club_user_activity_icons_pkey | btree | Yes | Yes | id |
| rpg_club_user_activity_icons_user_id_activity_name_norm_ico_key | btree | Yes | No | user_id, activity_name_norm, icon_type, source_ref |

### Index Definitions

```sql
CREATE INDEX idx_rpg_club_user_activity_icons_lookup ON public.rpg_club_user_activity_icons USING btree (user_id, last_seen_at, activity_name_norm, icon_type);
CREATE UNIQUE INDEX rpg_club_user_activity_icons_pkey ON public.rpg_club_user_activity_icons USING btree (id);
CREATE UNIQUE INDEX rpg_club_user_activity_icons_user_id_activity_name_norm_ico_key ON public.rpg_club_user_activity_icons USING btree (user_id, activity_name_norm, icon_type, source_ref);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16860_10_not_null | last_seen_at IS NOT NULL |
| 2200_16860_11_not_null | seen_count IS NOT NULL |
| 2200_16860_1_not_null | id IS NOT NULL |
| 2200_16860_2_not_null | user_id IS NOT NULL |
| 2200_16860_4_not_null | activity_name IS NOT NULL |
| 2200_16860_5_not_null | activity_name_norm IS NOT NULL |
| 2200_16860_6_not_null | icon_type IS NOT NULL |
| 2200_16860_7_not_null | source_ref IS NOT NULL |
| 2200_16860_8_not_null | icon_url IS NOT NULL |
| 2200_16860_9_not_null | first_seen_at IS NOT NULL |
| chk_rpg_club_user_activity_icon_count | (seen_count >= 1) |
| chk_rpg_club_user_activity_icon_type | ((icon_type)::text = ANY (ARRAY[('large'::character varying)::text, ('small'::character varying)::text])) |
