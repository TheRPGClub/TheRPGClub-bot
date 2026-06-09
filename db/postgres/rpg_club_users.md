# public.rpg_club_users

**Type:** BASE TABLE  
**Estimated rows:** 64

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | user_id | character varying(30) | No |  |  |  |
| 2 | is_bot | boolean | No | false |  |  |
| 3 | username | character varying(100) | Yes |  |  |  |
| 4 | global_name | character varying(100) | Yes |  |  |  |
| 5 | avatar_blob | bytea | Yes |  |  |  |
| 6 | server_joined_at | timestamp(6) with time zone | Yes |  |  |  |
| 7 | last_seen_at | timestamp(6) with time zone | Yes |  |  |  |
| 8 | last_fetched_at | timestamp(6) with time zone | Yes |  |  |  |
| 9 | role_admin | boolean | No | false |  |  |
| 10 | role_moderator | boolean | No | false |  |  |
| 11 | role_regular | boolean | No | false |  |  |
| 12 | role_member | boolean | No | false |  |  |
| 13 | role_newcomer | boolean | No | false |  |  |
| 14 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 15 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 16 | message_count | bigint | Yes | 0 |  |  |
| 22 | server_left_at | timestamp(6) with time zone | Yes |  |  |  |
| 23 | donor_notify_on_claim | boolean | No | false |  | 1 when the user wants to be notified when a donated key is claimed. |
| 24 | profile_image_at | timestamp(6) with time zone | Yes |  |  |  |
| 25 | profile_image | bytea | Yes |  |  |  |
| 26 | discord_avatar | character varying(128) | Yes |  |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_users_pkey | btree | Yes | Yes | user_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_users_pkey ON public.rpg_club_users USING btree (user_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16889_10_not_null | role_moderator IS NOT NULL |
| 2200_16889_11_not_null | role_regular IS NOT NULL |
| 2200_16889_12_not_null | role_member IS NOT NULL |
| 2200_16889_13_not_null | role_newcomer IS NOT NULL |
| 2200_16889_14_not_null | created_at IS NOT NULL |
| 2200_16889_15_not_null | updated_at IS NOT NULL |
| 2200_16889_1_not_null | user_id IS NOT NULL |
| 2200_16889_23_not_null | donor_notify_on_claim IS NOT NULL |
| 2200_16889_2_not_null | is_bot IS NOT NULL |
| 2200_16889_9_not_null | role_admin IS NOT NULL |
