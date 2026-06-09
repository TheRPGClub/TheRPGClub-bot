# public.rpg_club_rss_feed_items

**Type:** BASE TABLE  
**Estimated rows:** 50

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | feed_id | bigint | No |  |  |  |
| 2 | item_id_hash | character varying(128) | No |  |  |  |
| 3 | item_guid | character varying(512) | Yes |  |  |  |
| 4 | item_link | character varying(512) | Yes |  |  |  |
| 5 | published_at | timestamp(6) with time zone | Yes |  |  |  |
| 6 | first_seen_at | timestamp(6) with time zone | No | statement_timestamp() |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| rpg_club_rss_feed_items_pkey | btree | Yes | Yes | feed_id, item_id_hash |

### Index Definitions

```sql
CREATE UNIQUE INDEX rpg_club_rss_feed_items_pkey ON public.rpg_club_rss_feed_items USING btree (feed_id, item_id_hash);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_rss_feed_items_feed | feed_id | public.rpg_club_rss_feeds(feed_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16785_1_not_null | feed_id IS NOT NULL |
| 2200_16785_2_not_null | item_id_hash IS NOT NULL |
| 2200_16785_6_not_null | first_seen_at IS NOT NULL |
