# public.user_reminders

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | reminder_id | bigint | No | nextval('user_reminders_reminder_id_seq'::regclass) |  |  |
| 2 | user_id | character varying(32) | No |  |  |  |
| 3 | remind_at | timestamp(6) with time zone | No |  |  |  |
| 4 | content | character varying(400) | No |  |  |  |
| 5 | sent_at | timestamp(6) with time zone | Yes |  |  |  |
| 6 | is_noisy | boolean | No | false |  |  |
| 7 | failure_count | bigint | No | 0 |  |  |
| 8 | failed_at | timestamp(6) with time zone | Yes |  |  |  |
| 9 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 10 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| user_reminders_pkey | btree | Yes | Yes | reminder_id |
| ux_user_reminders_due | btree | No | No | sent_at, remind_at |
| ux_user_reminders_user | btree | No | No | user_id, remind_at |

### Index Definitions

```sql
CREATE UNIQUE INDEX user_reminders_pkey ON public.user_reminders USING btree (reminder_id);
CREATE INDEX ux_user_reminders_due ON public.user_reminders USING btree (sent_at, remind_at);
CREATE INDEX ux_user_reminders_user ON public.user_reminders USING btree (user_id, remind_at);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_65556_10_not_null | updated_at IS NOT NULL |
| 2200_65556_1_not_null | reminder_id IS NOT NULL |
| 2200_65556_2_not_null | user_id IS NOT NULL |
| 2200_65556_3_not_null | remind_at IS NOT NULL |
| 2200_65556_4_not_null | content IS NOT NULL |
| 2200_65556_6_not_null | is_noisy IS NOT NULL |
| 2200_65556_7_not_null | failure_count IS NOT NULL |
| 2200_65556_9_not_null | created_at IS NOT NULL |
