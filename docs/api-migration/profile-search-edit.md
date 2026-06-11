# Profile Search & Edit -- API Migration Post-mortem

PR: https://github.com/mfagerstrom/RPGClub_GameDB/pull/739

## What changed

- **profile search**: replaced 18 filter SlashOptions with a single `query` text param; calls `GET /api/v1/users?q=...` via the API client
- **profile edit**: replaced `Member.upsert` with User Socials API calls (`GET /api/v1/users/{id}/socials`, `POST`/`PATCH` `/api/v1/user_socials/{id}`, `DELETE`); resolves social platform IDs by label via a module-level cache of `GET /api/v1/social_platforms`
- Removes all `Member`, `IMemberRecord`, `IMemberSearchFilters` dependencies from the profile command

---

## Functionality lost in migration

### `profile search` -- removed filters

| Lost filter | What it did | API gap |
|---|---|---|
| `userid` | Exact match by Discord user ID | `GET /api/v1/users` has no `user_id` filter param |
| `username` | Contains match on username | Collapsed into `q` (less precise) |
| `globalname` | Contains match on global name | Collapsed into `q` |
| `completionator` | Filter by Completionator URL value | No equivalent API param |
| `steam` | Filter by Steam URL value | No equivalent API param |
| `psn` | Filter by PSN username value | No equivalent API param |
| `xbl` | Filter by Xbox Live username value | No equivalent API param |
| `switch` | Filter by Switch friend code value | No equivalent API param |
| `admin` | Filter by admin role flag | No API filter for membership roles |
| `moderator` | Filter by moderator role flag | No API filter for membership roles |
| `regular` | Filter by regular role flag | No API filter for membership roles |
| `member` | Filter by member role flag | No API filter for membership roles |
| `newcomer` | Filter by newcomer role flag | No API filter for membership roles |
| `bot` | Filter bots only | No API filter |
| `joinedafter` / `joinedbefore` | Filter by server join date range | No API date range filter |
| `lastseenafter` / `lastseenbefore` | Filter by last-seen date range | No API date range filter |
| `limit` | Control result count (up to 100) | Hardcoded to 50; no slash option exposed |
| `include-departed-members` | Include users who left the server | No API filter for departed members |

### `profile edit` -- edge cases

- If a social platform (e.g. "Completionator") does not exist in `social_platforms`, the field is silently skipped with no feedback to the user.
- Clearing a field via empty string is a no-op when no social record exists for that platform -- correct behavior, but the user receives no indication it was already empty.

---

## API changes needed for full feature parity

### `GET /api/v1/users` -- additional query params needed

- `user_id` -- exact match filter
- `username` -- contains filter
- `global_name` -- contains filter
- `role` -- one or more of `admin`, `moderator`, `regular`, `member`, `newcomer`
- `is_bot` -- boolean filter
- `joined_after` / `joined_before` -- ISO date range on `server_joined_at`
- `last_seen_after` / `last_seen_before` -- ISO date range on `last_seen_at`
- `include_departed` -- include users where `server_left_at` is not null
- `limit` -- already supported but needs a higher ceiling (100)
- Social filters: `steam`, `psn`, `xbl`, `nsw`, `completionator` -- filter by matching social handle or URL

### `POST /PATCH /api/v1/users/{user_id}/socials` -- error handling

- Return a clear error (or the bot should warn) when `social_platform_id` does not match any known platform, so the user is informed instead of the edit being silently skipped.
