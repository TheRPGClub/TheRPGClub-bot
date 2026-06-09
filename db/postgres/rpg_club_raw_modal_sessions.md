# public.rpg_club_raw_modal_sessions

**Type:** BASE TABLE  
**Estimated rows:** 3

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | session_id | character varying(120) | No |  |  |  |
| 2 | owner_user_id | character varying(30) | No |  |  |  |
| 3 | feature_id | character varying(60) | No |  |  |  |
| 4 | flow_id | character varying(60) | No |  |  |  |
| 5 | state_json | text | No |  |  |  |
| 6 | status | character varying(20) | No | 'OPEN'::character varying |  |  |
| 7 | expires_at | timestamp(6) with time zone | No |  |  |  |
| 8 | guild_id | character varying(30) | Yes |  |  |  |
| 9 | channel_id | character varying(30) | Yes |  |  |  |
| 10 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 11 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_raw_modal_sess_expires | btree | No | No | expires_at |
| ix_raw_modal_sess_owner_status | btree | No | No | owner_user_id, status |
| rpg_club_raw_modal_sessions_pkey | btree | Yes | Yes | session_id |

### Index Definitions

```sql
CREATE INDEX ix_raw_modal_sess_expires ON public.rpg_club_raw_modal_sessions USING btree (expires_at);
CREATE INDEX ix_raw_modal_sess_owner_status ON public.rpg_club_raw_modal_sessions USING btree (owner_user_id, status);
CREATE UNIQUE INDEX rpg_club_raw_modal_sessions_pkey ON public.rpg_club_raw_modal_sessions USING btree (session_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16776_10_not_null | created_at IS NOT NULL |
| 2200_16776_11_not_null | updated_at IS NOT NULL |
| 2200_16776_1_not_null | session_id IS NOT NULL |
| 2200_16776_2_not_null | owner_user_id IS NOT NULL |
| 2200_16776_3_not_null | feature_id IS NOT NULL |
| 2200_16776_4_not_null | flow_id IS NOT NULL |
| 2200_16776_5_not_null | state_json IS NOT NULL |
| 2200_16776_6_not_null | status IS NOT NULL |
| 2200_16776_7_not_null | expires_at IS NOT NULL |
| ck_raw_modal_session_status | ((status)::text = ANY (ARRAY[('OPEN'::character varying)::text, ('SUBMITTED'::character varying)::text, ('EXPIRED'::character varying)::text])) |
