# public.rpg_club_admin_wizard_sessions

**Type:** BASE TABLE  
**Estimated rows:** 2

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | session_id | character varying(200) | No |  |  |  |
| 2 | command_key | character varying(80) | No |  |  |  |
| 3 | owner_user_id | character varying(64) | No |  |  |  |
| 4 | channel_id | character varying(64) | No |  |  |  |
| 5 | guild_id | character varying(64) | Yes |  |  |  |
| 6 | status | character varying(20) | No | 'ACTIVE'::character varying |  |  |
| 7 | state_json | text | No |  |  |  |
| 8 | last_updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 9 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 10 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_admin_wiz_owner_status | btree | No | No | owner_user_id, status, last_updated_at |
| rpg_club_admin_wizard_sessions_pkey | btree | Yes | Yes | session_id |
| ux_rpg_club_admin_wiz_active | btree | Yes | No | command_key, owner_user_id, channel_id (partial: WHERE status = 'ACTIVE') |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_admin_wiz_owner_status ON public.rpg_club_admin_wizard_sessions USING btree (owner_user_id, status, last_updated_at);
CREATE UNIQUE INDEX rpg_club_admin_wizard_sessions_pkey ON public.rpg_club_admin_wizard_sessions USING btree (session_id);
CREATE UNIQUE INDEX ux_rpg_club_admin_wiz_active ON public.rpg_club_admin_wizard_sessions (command_key, owner_user_id, channel_id) WHERE status = 'ACTIVE';
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16659_10_not_null | updated_at IS NOT NULL |
| 2200_16659_1_not_null | session_id IS NOT NULL |
| 2200_16659_2_not_null | command_key IS NOT NULL |
| 2200_16659_3_not_null | owner_user_id IS NOT NULL |
| 2200_16659_4_not_null | channel_id IS NOT NULL |
| 2200_16659_6_not_null | status IS NOT NULL |
| 2200_16659_7_not_null | state_json IS NOT NULL |
| 2200_16659_8_not_null | last_updated_at IS NOT NULL |
| 2200_16659_9_not_null | created_at IS NOT NULL |
| ck_rpg_club_admin_wiz_sess_status | ((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('COMPLETED'::character varying)::text, ('CANCELLED'::character varying)::text])) |
