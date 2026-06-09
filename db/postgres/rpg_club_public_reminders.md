# public.rpg_club_public_reminders

**Type:** BASE TABLE  
**Estimated rows:** 1

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | reminder_id | bigint | No |  | BY DEFAULT |  |
| 2 | channel_id | character varying(30) | No |  |  |  |
| 3 | message | character varying(2000) | No |  |  |  |
| 4 | due_at | timestamp(6) with time zone | No |  |  |  |
| 5 | recur_every | bigint | Yes |  |  |  |
| 6 | recur_unit | character varying(10) | Yes |  |  |  |
| 7 | enabled | boolean | No | true |  |  |
| 8 | created_by | character varying(30) | Yes |  |  |  |
| 9 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 10 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_rpg_club_public_reminders_due | btree | No | No | due_at, enabled |
| rpg_club_public_reminders_pkey | btree | Yes | Yes | reminder_id |

### Index Definitions

```sql
CREATE INDEX ix_rpg_club_public_reminders_due ON public.rpg_club_public_reminders USING btree (due_at, enabled);
CREATE UNIQUE INDEX rpg_club_public_reminders_pkey ON public.rpg_club_public_reminders USING btree (reminder_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16767_10_not_null | updated_at IS NOT NULL |
| 2200_16767_1_not_null | reminder_id IS NOT NULL |
| 2200_16767_2_not_null | channel_id IS NOT NULL |
| 2200_16767_3_not_null | message IS NOT NULL |
| 2200_16767_4_not_null | due_at IS NOT NULL |
| 2200_16767_7_not_null | enabled IS NOT NULL |
| 2200_16767_9_not_null | created_at IS NOT NULL |
