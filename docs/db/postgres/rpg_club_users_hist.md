# public.rpg_club_users_hist

**Type:** BASE TABLE  
**Estimated rows:** 3198

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | history_id | bigint | No |  | ALWAYS |  |
| 2 | user_id | character varying(30) | No |  |  |  |
| 3 | is_bot | boolean | Yes |  |  |  |
| 4 | username | character varying(100) | Yes |  |  |  |
| 5 | global_name | character varying(100) | Yes |  |  |  |
| 6 | avatar_blob | bytea | Yes |  |  |  |
| 7 | server_joined_at | timestamp(6) with time zone | Yes |  |  |  |
| 8 | server_left_at | timestamp(6) with time zone | Yes |  |  |  |
| 9 | last_seen_at | timestamp(6) with time zone | Yes |  |  |  |
| 10 | last_fetched_at | timestamp(6) with time zone | Yes |  |  |  |
| 11 | role_admin | boolean | Yes |  |  |  |
| 12 | role_moderator | boolean | Yes |  |  |  |
| 13 | role_regular | boolean | Yes |  |  |  |
| 14 | role_member | boolean | Yes |  |  |  |
| 15 | role_newcomer | boolean | Yes |  |  |  |
| 16 | message_count | bigint | Yes |  |  |  |
| 17 | completionator_url | character varying(512) | Yes |  |  |  |
| 18 | psn_username | character varying(100) | Yes |  |  |  |
| 19 | xbl_username | character varying(100) | Yes |  |  |  |
| 20 | nsw_friend_code | character varying(50) | Yes |  |  |  |
| 21 | steam_url | character varying(512) | Yes |  |  |  |
| 22 | profile_image | bytea | Yes |  |  |  |
| 23 | profile_image_at | timestamp(6) with time zone | Yes |  |  |  |
| 24 | created_at | timestamp(6) with time zone | Yes |  |  |  |
| 25 | updated_at | timestamp(6) with time zone | Yes |  |  |  |
| 26 | action_type | character(1) | No |  |  |  |
| 27 | actioned_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 28 | donor_notify_on_claim | boolean | Yes |  |  | Audit snapshot of donor notification preference. |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| idx_rpg_club_users_hist_user | btree | No | No | user_id |
| rpg_club_users_hist_pkey | btree | Yes | Yes | history_id |

### Index Definitions

```sql
CREATE INDEX idx_rpg_club_users_hist_user ON public.rpg_club_users_hist USING btree (user_id);
CREATE UNIQUE INDEX rpg_club_users_hist_pkey ON public.rpg_club_users_hist USING btree (history_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16904_1_not_null | history_id IS NOT NULL |
| 2200_16904_26_not_null | action_type IS NOT NULL |
| 2200_16904_27_not_null | actioned_at IS NOT NULL |
| 2200_16904_2_not_null | user_id IS NOT NULL |
