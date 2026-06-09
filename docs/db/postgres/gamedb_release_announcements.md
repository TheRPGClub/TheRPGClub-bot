# public.gamedb_release_announcements

**Type:** BASE TABLE  
**Estimated rows:** 23639

## Columns

| # | Column | Type | Nullable | Default | Identity | Description |
| - | ------ | ---- | -------- | ------- | -------- | ----------- |
| 1 | release_id | bigint | No |  |  |  |
| 2 | announce_at | timestamp(0) without time zone | No |  |  |  |
| 3 | sent_at | timestamp(6) without time zone | Yes |  |  |  |
| 4 | skipped_at | timestamp(6) without time zone | Yes |  |  |  |
| 5 | skip_reason | character varying(80) | Yes |  |  |  |
| 6 | created_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |
| 7 | updated_at | timestamp(6) without time zone | No | CURRENT_TIMESTAMP |  |  |

## Indexes

| Name | Type | Unique | Primary | Columns |
| ---- | ---- | ------ | ------- | ------- |
| gamedb_release_announcements_pkey | btree | Yes | Yes | release_id |
| idx_gamedb_release_announce_pending | btree | No | No | sent_at, skipped_at, announce_at |

### Index Definitions

```sql
CREATE UNIQUE INDEX gamedb_release_announcements_pkey ON public.gamedb_release_announcements USING btree (release_id);
CREATE INDEX idx_gamedb_release_announce_pending ON public.gamedb_release_announcements USING btree (sent_at, skipped_at, announce_at);
```

## Foreign Keys

| Constraint | Column | References | On Update | On Delete |
| ---------- | ------ | ---------- | --------- | --------- |
| fk_gamedb_release_announcements_release | release_id | public.gamedb_releases(release_id) | NO ACTION | NO ACTION |

## Check Constraints

| Constraint | Clause |
| ---------- | ------ |
| 2200_16596_1_not_null | release_id IS NOT NULL |
| 2200_16596_2_not_null | announce_at IS NOT NULL |
| 2200_16596_6_not_null | created_at IS NOT NULL |
| 2200_16596_7_not_null | updated_at IS NOT NULL |
