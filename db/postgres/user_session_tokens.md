# public.user_session_tokens

**Type:** BASE TABLE  
**Estimated rows:** 5

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | id | bigint | No | nextval('user_session_tokens_id_seq'::regclass) |  |  |
| 2 | token | character varying | No |  |  |  |
| 3 | user_id | character varying | No |  |  |  |
| 4 | expires_at | timestamp(6) without time zone | No |  |  |  |
| 5 | created_at | timestamp(6) without time zone | No |  |  |  |
| 6 | updated_at | timestamp(6) without time zone | No |  |  |  |
| 7 | is_dev | boolean | No | false |  |  |
| 8 | is_longstanding | boolean | No | false |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| index_user_session_tokens_on_token | btree | Yes | No | token |
| index_user_session_tokens_on_user_id | btree | No | No | user_id |
| user_session_tokens_pkey | btree | Yes | Yes | id |

### Index Definitions

```sql
CREATE UNIQUE INDEX index_user_session_tokens_on_token ON public.user_session_tokens USING btree (token);
CREATE INDEX index_user_session_tokens_on_user_id ON public.user_session_tokens USING btree (user_id);
CREATE UNIQUE INDEX user_session_tokens_pkey ON public.user_session_tokens USING btree (id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_40961_1_not_null | id IS NOT NULL |
| 2200_40961_2_not_null | token IS NOT NULL |
| 2200_40961_3_not_null | user_id IS NOT NULL |
| 2200_40961_4_not_null | expires_at IS NOT NULL |
| 2200_40961_5_not_null | created_at IS NOT NULL |
| 2200_40961_6_not_null | updated_at IS NOT NULL |
| 2200_40961_7_not_null | is_dev IS NOT NULL |
| 2200_40961_8_not_null | is_longstanding IS NOT NULL |
