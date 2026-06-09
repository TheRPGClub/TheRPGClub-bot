# public.bot_voting_info

**Type:** BASE TABLE  
**Estimated rows:** 5

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | round_number | bigint | No |  |  |  |
| 2 | nomination_list_id | bigint | Yes |  |  |  |
| 3 | next_vote_at | timestamp(0) without time zone | No |  |  |  |
| 4 | five_day_reminder_sent | boolean | No | false |  |  |
| 5 | one_day_reminder_sent | boolean | No | false |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| ix_bot_voting_info_round | btree | No | No | round_number |

### Index Definitions

```sql
CREATE INDEX ix_bot_voting_info_round ON public.bot_voting_info USING btree (round_number);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16518_1_not_null | round_number IS NOT NULL |
| 2200_16518_3_not_null | next_vote_at IS NOT NULL |
| 2200_16518_4_not_null | five_day_reminder_sent IS NOT NULL |
| 2200_16518_5_not_null | one_day_reminder_sent IS NOT NULL |
