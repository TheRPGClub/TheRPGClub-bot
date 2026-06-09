# public.rpg_club_rss_feeds

**Type:** BASE TABLE  
**Estimated rows:** 2

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | feed_id | bigint | No |  | BY DEFAULT |  |
| 2 | feed_name | character varying(200) | Yes |  |  |  |
| 3 | feed_url | character varying(512) | No |  |  |  |
| 4 | channel_id | character varying(30) | No |  |  |  |
| 5 | include_keywords | character varying(4000) | Yes |  |  |  |
| 6 | exclude_keywords | character varying(4000) | Yes |  |  |  |
| 7 | created_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |
| 8 | updated_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_rss_feeds_pkey | btree | Yes | Yes | feed_id |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_rss_feeds_pkey ON public.rpg_club_rss_feeds USING btree (feed_id);
```

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16791_1_not_null | feed_id IS NOT NULL |
| 2200_16791_3_not_null | feed_url IS NOT NULL |
| 2200_16791_4_not_null | channel_id IS NOT NULL |
| 2200_16791_7_not_null | created_at IS NOT NULL |
| 2200_16791_8_not_null | updated_at IS NOT NULL |
