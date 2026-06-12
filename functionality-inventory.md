# Functionality Inventory

Comprehensive inventory of every Discord bot command (with subcommands and parameter variants) and
every service that uses SQL. Sourced from `src/commands/`, `src/services/`, and `src/db/sql/`.

The bot is mid-migration from direct SQL to the RPG Club HTTP API
(`src/services/RpgClubApiClient.ts`, helpers `apiGet`/`apiPost`/`apiPatch`/`apiDelete`). The
**API Migration Status** section below answers: which commands and services now read/write through the
API instead of SQL, and how many API calls each command makes. The per-command **SQL Operations**
tables further down describe the underlying data tables touched; where a path has migrated, the data
now flows through the API endpoint rather than a raw query, even though the table is unchanged.

---

## API Migration Status (as of 2026-06-12)

Migration happens at the data-class layer. A command's API status is inherited from the class methods
it calls. Counts below are taken from call sites in `src/classes/` and
`src/commands/profile.command.ts` (the only command that calls the API client directly).

### Class-level status

"API" counts `await apiGet/apiPost/apiPatch/apiDelete/apiGetRaw` call sites. "SQL" counts
`dbQuery/dbMutate/dbInsert/dbWithConnection/dbQueryConn/dbMutateConn/dbInsertConn` call sites.

| Class | API sites | SQL sites | Status | What is still SQL |
|---|---|---|---|---|
| `BotVotingInfo` | 8 | 0 | Full API | -- |
| `Thread` | 8 | 0 | Full API | -- |
| `Suggestion` | 5 | 0 | Full API | -- |
| `PublicReminder` | 5 | 0 | Full API | -- |
| `Starboard` | 2 | 0 | Full API | -- |
| `GameSearchSynonymDraft` | 4 | 0 | Full API | -- |
| `GameKey` | 5 | 2 | Mostly API | a couple of read/autocomplete paths |
| `UserGameCollection` | 6 | 7 | Partial | `searchEntries`, `getOverviewFor*`, `autocompleteEntries` (list/overview reads) |
| `Member` | 17 | 25 | Partial | journal + completion CRUD are API; now-playing, profile, socials, avatar/nick history still SQL |
| `RssFeed` | 4 | 6 | Partial | feed CRUD is API; feed-item seen/mark tracking still SQL |
| `Game` | 10 | 52 | Partial | game/release/platform/region/company/image **reads** are API; search, IGDB writes, completions/now-playing aggregates still SQL |
| `Nomination` | 1 | 3 | Partial | `listNominationsForRound` is API; per-user get/upsert/delete still SQL |
| `Gotm` | 1 | 4 | Partial | round list **read** is API; insert/update/delete still SQL |
| `NrGotm` | 1 | 5 | Partial | round list **read** is API; insert/update/delete still SQL |
| `GameSearchSynonym` | 6 | 21 | Partial | group/term create + draft promote are API; lookups/expansion still SQL |

### Per-command API usage

"API calls (primary path)" is the number of API requests on the normal success path of a single
invocation. `+N` marks a call inside a loop (once per release, platform, nominee, term, etc.).
"None" means the command still runs entirely on SQL or makes no DB call.

| Command / subcommand | API status | API calls (primary path) | Endpoints hit |
|---|---|---|---|
| `/admin set-nextvote` | Partial | ~2 | GET + PATCH `/voting_info/{round}` |
| `/admin voting-setup` | Partial | ~3 | GET `/voting_info`, GET `/gotm_entries/{r}/nominations`, GET `/nr_gotm_entries/{r}/nominations` |
| `/admin add-gotm` / `add-nr-gotm` | Partial | ~2 | voting_info GET/POST/PATCH (entry insert still SQL) |
| `/admin edit-gotm` / `edit-nr-gotm` | Partial | 1 | GET `/gotm_entries` (update still SQL) |
| `/admin delete-gotm-noms` / `delete-nr-gotm-noms` | None | 0 | nomination DELETE still SQL |
| `/admin nextround-setup`, `gotm-audit`, `sql-health-check`, `sync`, `help` | None | 0 | SQL / Discord / import only |
| `/avatar-history` | None | 0 | avatar history still SQL |
| `/collection add` | Partial | 1 | POST `/users/{id}/collections` |
| `/collection edit` | Partial | 2 | GET + PATCH `/collections/{id}` |
| `/collection remove` | Partial | 2 | GET + DELETE `/collections/{id}` |
| `/collection to-completion` | Partial | 2 | GET `/collections/{id}` + POST `/users/{id}/completions` |
| `/collection list` / `overview` / `import-*` | None | 0 | list/overview reads + imports still SQL |
| `/create-thread` | Partial | 2+ | GET `/games/{id}` + POST `/threads` (+ POST `/threads/{id}/links`) |
| `/game-completion add` | Partial | 1 | POST `/users/{id}/completions` |
| `/game-completion edit` | Partial | 2 | GET + PATCH `/completions/{id}` |
| `/game-completion delete` | Partial | 2 | GET + DELETE `/completions/{id}` |
| `/game-completion list` / `common` / `export` / `import-completionator` | None | 0 | completion list reads + import still SQL |
| `/game-journal` (and journal CRUD) | Partial | 1-2 | GET `/users/{id}/journal`, GET `/games/{id}/journal`; entry CRUD POST/PATCH/DELETE `/journal_entries` |
| `/gamedb view` | Partial | ~6 +N | GET `/games/{id}`, `/games/{id}/releases`, `/platforms/{id}` (+N), `/regions/{id}` (+N), `/companies/{id}` (+N), `/games/{id}/images`, `/games/{id}/threads` (completions/now-playing aggregates still SQL) |
| `/gamedb search` | None | 0 | full-text + synonym search still SQL |
| `/gamedb add` / `refresh-release-info` / `csv-import` / `audit` | None | 0 | IGDB write paths still SQL |
| `/gamedb synonym-add` | Partial | 2+ | POST `/search_synonym_groups` + POST `/search_synonyms` (+N per term) |
| `/gamedb synonym-list` | None | 0 | synonym lookup still SQL |
| `/gamedb link-versions` | None | 0 | alternates insert still SQL |
| `/generate-vote-image` | Partial | 1 +N | GET `/gotm_entries/{r}/nominations` (or nr) + GET `/games/{id}/images` per nominee |
| `/giveaway list` | Mostly API | 1 | GET `/game_keys` |
| `/giveaway donate` | Mostly API | 1+ | POST `/game_keys` (+ game lookup) |
| `/giveaway revoke` | Partial | varies | own-key lookup still partly SQL |
| `/hltb` | None | 0 | HLTB cache table still SQL |
| `/mod presence` / `presence-history` | None | 0 | presence history still SQL |
| `/moderator create-live-event` | Partial | 1+ | POST `/threads` (+ link) |
| `/mp-info` | None | 0 | socials lookup still SQL |
| `/nominate` (write) | Partial | 1+ | GET `/games/{id}` + voting_info GET (upsert still SQL) |
| `/nominate noms` (display) | Full API | 1 | GET `/gotm_entries/{r}/nominations` or `/nr_gotm_entries/{r}/nominations` |
| `/now-playing add` | Partial | 1+ | GET `/games/{id}` (now-playing insert still SQL) |
| `/now-playing list` / `search` | None | 0 | now-playing reads still SQL |
| `/profile view` | Mostly API | 2 | GET `/users/{id}`, GET `/users/{id}/nick_history` |
| `/profile search` | Full API | 1 | GET `/users` |
| `/profile edit` | Full API | 2-3 | GET `/social_platforms`, then POST/PATCH/DELETE `/users/{id}/socials` or `/user_socials/{id}` |
| `/publicreminder create` | Full API | 1 | POST `/public_reminders` |
| `/publicreminder list` | Full API | 1 | GET `/public_reminders` |
| `/publicreminder delete` | Full API | 1-2 | DELETE `/public_reminders/{id}` |
| `/round` | Full API | 3 | GET `/gotm_entries`, `/nr_gotm_entries`, `/voting_info` |
| `/round-history` | Full API | 2 | GET `/gotm_entries`, `/nr_gotm_entries` |
| `/rss add` | Full API | 1 | POST `/rss_feeds` |
| `/rss remove` | Full API | 1 | DELETE `/rss_feeds/{id}` |
| `/rss edit` | Full API | 1 | PATCH `/rss_feeds/{id}` |
| `/rss list` | Full API | 1 | GET `/rss_feeds` |
| `/suggestion` (submit) | Full API | 1 | POST `/suggestions` |
| `/suggestion` review flow | Full API | 1-2 | GET `/suggestions/{id}`, DELETE `/suggestions/{id}` |
| `/superadmin completion-add-other` | Partial | 1 | POST `/users/{id}/completions` |
| `/superadmin memberscan` / `say` / `help` | None | 0 | memberscan upsert still SQL |
| `/thread link` | Full API | 1 | POST `/threads/{id}/links` |
| `/thread unlink` | Full API | 1 | DELETE `/threads/{id}/links/{game_id}` |
| `/todo` | None | 0 | todo table still SQL (proxies GitHub Issues) |
| `/help`, `/timestamp` | None | 0 | no DB / pure compute |

### Service-level status

- `GameImageService` -- **Full API**: calls `apiGet` `/games/{id}/images` directly (the only service that
  uses the API client without going through a data class).
- `GiveawayHubService` -- **Mostly API**: via `GameKey` (API key list/count).
- `NominationReminderService` -- **Full API**: via `BotVotingInfo` (API).
- `PublicReminderService` -- **Full API**: via `PublicReminder` (API).
- `ThreadSyncService` -- **Full API**: via `Thread.upsertThreadRecord` (API).
- `ThreadLinkPromptService` -- **Partial**: via `Game` (API reads).
- `GamedbAuditService` -- **Partial**: via `Game` (reads API, audit writes still SQL).
- `RssFeedService` -- **Partial**: routes entirely through the `RssFeed` class (no direct DB/API calls
  of its own); feed list/CRUD is API, while feed-item seen/mark tracking inside `RssFeed` is still SQL.
- `ReminderService` -- **SQL**: `user_reminders` not yet migrated (API endpoints exist).
- `GameReleaseAnnouncementService` -- **SQL**: `gamedb_release_announcements` not yet migrated.
- `UserEmojiService` -- **SQL**: `rpg_club_users.emoji_name` not yet migrated.
- `IgdbScanService` -- **SQL**: IGDB persistence path not yet migrated.

---

## Commands

### `/admin` (SlashGroup -- moderator/admin only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `sync` | none | none (Discord API call) |
| `set-nextvote` | `date` | UPDATE `bot_voting_info.next_vote_at` |
| `delete-gotm-noms` | none | DELETE `gotm_nominations` |
| `delete-nr-gotm-noms` | none | DELETE `nr_gotm_nominations` |
| `voting-setup` | none | SELECT `bot_voting_info`, `gotm_nominations`, `nr_gotm_nominations` |
| `nextround-setup` | `testmode` (bool, optional) | SELECT/INSERT/UPDATE `gotm_entries`, `nr_gotm_entries`, `bot_voting_info`; admin wizard session |
| `add-gotm` | (wizard prompts) | INSERT `gotm_entries`, `bot_voting_info` |
| `add-nr-gotm` | (wizard prompts) | INSERT `nr_gotm_entries`, `bot_voting_info` |
| `edit-gotm` | `round` (autocomplete) | SELECT/UPDATE `gotm_entries` |
| `edit-nr-gotm` | `round` (autocomplete) | SELECT/UPDATE `nr_gotm_entries` |
| `gotm-audit` | `action` (Start/Continue/Abort), `file` (attachment) | SELECT/INSERT/UPDATE `gotm_entries`, `nr_gotm_entries`, import tables |
| `sql-health-check` | none | SELECT (connectivity ping to DB) |
| `help` | none | none |

---

### `/avatar-history`

Parameters: `member` (optional), `private` (bool), `all` (bool), `scan` (bool)

SQL: SELECT `rpg_club_user_avatar_history`; optional INSERT when `scan` is set

---

### `/collection` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `add` | `title` (autocomplete), `platform` (autocomplete), `ownership_type` (choice), `notes` (optional) | SELECT `gamedb_games`, `gamedb_platforms`; INSERT `user_game_collections` |
| `edit` | `entry` (autocomplete), `title` (autocomplete), `platform` (autocomplete), `ownership_type` (choice), `notes` (optional) | SELECT `user_game_collections`; UPDATE `user_game_collections` |
| `remove` | `entry` (autocomplete) | SELECT `user_game_collections`; DELETE `user_game_collections` |
| `to-now-playing` | `entry` (autocomplete) | SELECT `user_game_collections`; INSERT `user_now_playing` |
| `to-completion` | `entry` (autocomplete), `completion_type` (choice), `platform` (autocomplete), `note` (optional), `completion_date` (optional), `final_playtime_hours` (optional), `announce` (bool) | SELECT `user_game_collections`; INSERT `user_game_completions` |
| `list` | `member` (optional), `title` (optional filter), `platform` (optional filter), `ownership_type` (optional filter), `private` (bool), `all` (bool) | SELECT `user_game_collections`, `gamedb_games`, `gamedb_platforms` |
| `overview` | `member` (optional), `private` (bool) | SELECT `user_game_collections` grouped by platform |
| `import-csv` | `action` (Start/Continue/Abort), `file` (attachment, conditional) | INSERT/SELECT `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items` |
| `import-steam` | `action` (Start/Continue/Abort), `steam_profile` (optional URL/ID) | INSERT/SELECT `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items`; Steam API lookup |

---

### `/create-thread`

Parameters: `title` (autocomplete, GameDB game), `tag` (forum tag choice), `first-post-text` (optional)

SQL: SELECT `gamedb_games`, `thread_game_links`; INSERT `threads`, `thread_game_links`

---

### `/game-completion` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `add` | `title` (autocomplete), `completion_type` (choice), `platform` (autocomplete), `note` (optional), `completion_date` (optional), `final_playtime_hours` (optional), `announce` (bool) | SELECT `gamedb_games`, `gamedb_platforms`; INSERT `user_game_completions` |
| `list` | `all` (bool), `year` (optional int), `query` (optional string), `member` (optional), `private` (bool) | SELECT `user_game_completions`, `gamedb_games`, `gamedb_platforms` |
| `common` | `member_one` (optional), `member_two` (optional), `sort` (choice), `year` (optional int) | SELECT `user_game_completions` joined across two members |
| `edit` | `title` (autocomplete), `completion_type` (choice), `platform` (autocomplete), `note` (optional), `completion_date` (optional), `final_playtime_hours` (optional) | SELECT/UPDATE `user_game_completions` |
| `delete` | `title` (autocomplete completion entry) | SELECT/DELETE `user_game_completions` |
| `export` | none | SELECT all `user_game_completions` for invoking user; returns CSV attachment |
| `import-completionator` | `action` (Start/Continue/Abort), `file` (attachment, conditional) | INSERT/SELECT `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items`, `user_game_completions` |

---

### `/gamedb` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `view` | `title` (autocomplete) | SELECT `gamedb_games`, `gamedb_platforms`, `gamedb_releases`, `thread_game_links`, completions/now-playing aggregates |
| `search` | `query` (string), `private` (bool) | SELECT `gamedb_games` with full-text/synonym-expanded search |
| `add` | (wizard: IGDB search -> confirmation modal) | INSERT `gamedb_games`, `gamedb_platforms`, `gamedb_releases`, metadata tables |
| `refresh-release-info` | `title` (autocomplete or GameDB ID) | UPDATE `gamedb_releases`, `gamedb_release_announcements` via IGDB re-fetch |
| `csv-import` | `action` (Start/Continue/Abort), `file` (attachment, conditional) | INSERT/SELECT `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items`, `gamedb_games` |
| `audit` | `missing_images`, `missing_featured_video`, `missing_descriptions`, `missing_release_data` (bools); `auto_accept_images`, `auto_accept_videos`, `auto_accept_release_data`, `auto_accept_descriptions`, `auto_accept_all` (bools); `query` (string), `show_complete_games` (bool), `private` (bool) | SELECT `gamedb_games` with multiple filter flags; UPDATE on auto-accept |
| `link-versions` | `game_ids` (comma-separated IDs), `private` (bool) | INSERT `gamedb_game_alternates` |
| `synonym-add` | `base_term` (string) | INSERT `gamedb_search_synonym_groups`, `gamedb_search_synonym_terms` |
| `synonym-list` | `query` (optional filter string) | SELECT `gamedb_search_synonyms`, `gamedb_search_synonym_groups` |

---

### `/game-journal`

Parameters: `all` (bool), `member` (optional), `private` (bool), `query` (optional string), `game` (optional autocomplete)

SQL: SELECT `user_game_journal_entries`, `gamedb_games`

---

### `/generate-vote-image`

Parameters: `vote_type` (GOTM/NR-GOTM choice), `round` (autocomplete)

SQL: SELECT `gotm_nominations`/`nr_gotm_nominations`, `gamedb_games` (for cover images); no DB writes

---

### `/giveaway` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `list` | `private` (bool) | SELECT `rpg_club_game_keys` (available, unclaimed) |
| `donate` | `title` (autocomplete), `platform` (autocomplete), `key` (string) | SELECT `gamedb_games`, `gamedb_platforms`; INSERT `rpg_club_game_keys` |
| `revoke` | `key_id` (autocomplete) | SELECT/DELETE `rpg_club_game_keys` (own keys only) |

---

### `/help`

No parameters. No SQL.

---

### `/hltb`

Parameters: `title` (string), `private` (bool)

SQL: SELECT `rpg_club_hltb_cache`; INSERT/UPDATE cache on cache miss (HLTB API fetch)

---

### `/mod` (SlashGroup -- moderator only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `presence` | `text` (string) | INSERT `bot_presence_history` |
| `presence-history` | `count` (int, optional) | SELECT `bot_presence_history` |
| `help` | none | none |

---

### `/moderator` (SlashGroup -- moderator only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `create-live-event` | (modal: title, description, start time, etc.) | INSERT `threads`, `thread_game_links` (forum thread record) |

---

### `/mp-info`

Parameters: `steam`, `xbl`, `psn`, `switch` (bool filters, any combination), `private` (bool)

SQL: SELECT `rpg_club_users`, `user_socials` filtered by requested platform handles

---

### `/nominate`

Parameters: `title` (autocomplete), `type` (GOTM/NR-GOTM choice), `reason` (string)

SQL: SELECT `gamedb_games`, `bot_voting_info`; INSERT/UPDATE `gotm_nominations`/`nr_gotm_nominations`

Sub-display **`noms`**: parameters `type` (GOTM/NR-GOTM), `private` (bool) -- SELECT nominations list

---

### `/now-playing` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `add` | `title` (autocomplete), `platform` (autocomplete), `note` (optional string), `private` (bool) | SELECT `gamedb_games`, `gamedb_platforms`; INSERT `user_now_playing`; prompts thread-link if unlinked |
| `list` | `member` (optional), `all` (bool), `private` (bool) | SELECT `user_now_playing`, `gamedb_games`, `gamedb_platforms`, `thread_game_links` |
| `search` | `title` (autocomplete), `private` (bool) | SELECT `user_now_playing` filtered by game title/id |

---

### `/profile` (SlashGroup)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `view` | `member` (optional), `private` (bool) | SELECT `rpg_club_users`, `user_socials`, `user_game_completions` (count), `user_now_playing` (count), completion leaderboard |
| `search` | `query` (string), `private` (bool) | SELECT `rpg_club_users` full-text search |
| `edit` | `member` (optional, admin override), `completionator`, `psn`, `xbl`, `nsw`, `steam` (optional string each) | SELECT/UPDATE/INSERT `user_socials` |

---

### `/publicreminder` (SlashGroup -- admin only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `create` | `channel` (channel mention), `date` (string), `time` (string), `message` (string), `recur` (bool), `recurunit` (Day/Week/Month choice) | INSERT `rpg_club_public_reminders` |
| `list` | none | SELECT `rpg_club_public_reminders` (upcoming, enabled) |
| `delete` | `id` (int) | SELECT/DELETE `rpg_club_public_reminders` |

---

### `/round`

Parameters: `private` (bool)

SQL: SELECT current `gotm_entries`, `nr_gotm_entries`, `bot_voting_info`

---

### `/round-history`

Parameters: `private` (bool)

SQL: SELECT all `gotm_entries`, `nr_gotm_entries` ordered by round

---

### `/rss` (SlashGroup -- admin only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `help` | none | none |
| `add` | `url` (string), `channel` (channel mention), `name` (string), `include` (optional regex string), `exclude` (optional regex string) | INSERT `rpg_club_rss_feeds` |
| `remove` | `id` (int, autocomplete) | DELETE `rpg_club_rss_feeds` |
| `edit` | `id` (int, autocomplete), `url` (optional), `name` (optional), `channel` (optional), `include` (optional), `exclude` (optional) | UPDATE `rpg_club_rss_feeds` |
| `list` | none | SELECT `rpg_club_rss_feeds` |

---

### `/suggestion`

Parameters: `suggestion` (string, the suggestion text)

SQL: INSERT `rpg_club_suggestions`

Interactive review flow (button/select components, admin-only):
- Approve/reject/defer buttons trigger INSERT `rpg_club_suggestion_review_sessions`, UPDATE `rpg_club_suggestions`

---

### `/superadmin` (SlashGroup -- server owner only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `completion-add-other` | (wizard: member, title, completion_type, platform, note, date, playtime, announce) | SELECT `gamedb_games`, `gamedb_platforms`; INSERT `user_game_completions` |
| `say` | `message` (string), `message_id` (optional, for edit), `channel_id` (optional) | none |
| `memberscan` | none | INSERT/UPDATE `rpg_club_users` for all current guild members |
| `help` | none | none |

---

### `/thread` (SlashGroup -- admin only)

| Subcommand | Parameters | SQL Operations |
|---|---|---|
| `link` | `thread_id` (string), `gamedb_game_id` (int) | INSERT `thread_game_links` |
| `unlink` | `thread_id` (string), `gamedb_game_id` (int) | DELETE `thread_game_links` |

---

### `/timestamp`

Parameters: `datetime` (string), `parsing_timezone` (string, optional), `public` (bool), `format` (choice)

SQL: none (pure date/time conversion)

---

### `/todo`

Parameters: `query` (string, optional), `state` (open/closed/all choice), `labels` (optional), `sort` (choice), `direction` (choice), `page` (int), `per_page` (int), `private` (bool)

SQL: SELECT `rpg_club_todos`; proxies GitHub Issues API for live data

---

## Services with Data Access

Data-path status per service is summarized in **API Migration Status** above. The breakdowns below
describe the tables each service ultimately touches, whether via API or SQL.

### `RssFeedService` (`src/services/RssFeedService.ts`)

Routes through the `RssFeed` class (no direct `dbWithConnection` of its own anymore). Orchestrates:
- GET `/api/v1/rss_feeds` (API) -- load all active feeds on each poll cycle
- SELECT `rpg_club_rss_feed_items` (SQL) -- check which items have already been posted (`isItemSeen`)
- INSERT `rpg_club_rss_feed_items` (SQL) -- mark new items as seen after posting

---

### `ReminderService` (`src/services/ReminderService.ts`)

Uses `Reminder` class. On each interval tick:
- SELECT `user_reminders` -- fetch due, undelivered reminders
- UPDATE `user_reminders` -- mark sent or record failure / permanent failure
- UPDATE `user_reminders` -- snooze on transient failure

---

### `PublicReminderService` (`src/services/PublicReminderService.ts`)

Uses `PublicReminder` class. On each interval tick:
- SELECT `rpg_club_public_reminders` -- fetch upcoming enabled reminders
- UPDATE `rpg_club_public_reminders` -- advance due date on recurring; disable on one-shot after send

---

### `GameReleaseAnnouncementService` (`src/services/GameReleaseAnnouncementService.ts`)

Uses `GameReleaseAnnouncement` class. On each interval tick:
- SELECT `gamedb_release_announcements` joined with `gamedb_releases`, `gamedb_games`, `gamedb_platforms` -- fetch due announcements
- UPDATE `gamedb_release_announcements` -- mark sent or missed

---

### `NominationReminderService` (`src/services/NominationReminderService.ts`)

Uses `BotVotingInfo` class. On each interval tick:
- SELECT `bot_voting_info` -- get current round + next vote date + reminder-sent flag
- UPDATE `bot_voting_info.reminder_sent` -- flag after reminder is posted

---

### `ThreadSyncService` (`src/services/ThreadSyncService.ts`)

Uses `Thread` class (`upsertThreadRecord`). On forum thread create/update events:
- INSERT/UPDATE `threads` -- upsert thread metadata (name, archived state, etc.)

---

### `ThreadLinkPromptService` (`src/services/ThreadLinkPromptService.ts`)

Uses `Game` class. Triggered after `/now-playing add` when a game has no linked thread:
- SELECT `gamedb_games` -- look up game details for the prompt message

---

### `UserEmojiService` (`src/services/UserEmojiService.ts`)

Uses `Member` class. On guild member events:
- UPDATE `rpg_club_users.emoji_name` -- sync custom emoji username when a member changes their display name

---

### `GiveawayHubService` (`src/services/GiveawayHubService.ts`)

Uses `GameKey` class. Manages giveaway hub channel message refresh:
- SELECT `rpg_club_game_keys` -- count available keys + list them for hub embed rebuild

---

### `GamedbAuditService` (`src/services/GamedbAuditService.ts`)

Uses `Game` class. Invoked by `/gamedb audit`:
- SELECT `gamedb_games` with configurable missing-data filters
- UPDATE `gamedb_games` when auto-accept flags are set (image, video, description, release data)

---

### `IgdbScanService` (`src/services/IGDB/IgdbScanService.ts`)

Uses `Game` class. Invoked during game add/refresh flows:
- SELECT `gamedb_games` -- check for existing IGDB ID matches
- INSERT/UPDATE `gamedb_games`, `gamedb_releases`, `gamedb_platforms`, metadata join tables -- persist IGDB data

---

## SQL Definition Files (`src/db/sql/`)

Each file exports named query objects consumed by the data access classes listed above.

| File | Tables | Operation Types |
|---|---|---|
| `game.sql.ts` | `gamedb_games`, `gamedb_platforms`, `gamedb_releases`, `gamedb_regions`, `gamedb_game_alternates`, `gamedb_game_companies`, `gamedb_game_genres`, `gamedb_game_themes`, `gamedb_game_modes`, `gamedb_game_perspectives`, `gamedb_game_engines`, `gamedb_game_franchises`, `gamedb_game_platforms`, `gamedb_release_announcements`, `thread_game_links`, `threads`, `gotm_entries`, `nr_gotm_entries`, `user_now_playing`, `user_game_completions`, `user_game_collections` | SELECT, INSERT, UPDATE, DELETE |
| `member.sql.ts` | `rpg_club_users`, `user_now_playing`, `gamedb_games`, `gamedb_platforms`, `user_game_journal_entries`, `rpg_club_user_nick_history`, `user_game_completions`, `rpg_club_user_avatar_history`, `journal_message_contexts`, `user_socials`, `social_platforms` | SELECT, INSERT, UPDATE, DELETE |
| `nomination.sql.ts` | `gotm_nominations`, `nr_gotm_nominations`, `gamedb_games` | SELECT, INSERT, UPDATE (upsert), DELETE |
| `gotm.sql.ts` | `gotm_entries`, `nr_gotm_entries` | SELECT, INSERT, UPDATE, DELETE |
| `userGameCollection.sql.ts` | `user_game_collections`, `gamedb_games`, `gamedb_platforms` | SELECT, INSERT, UPDATE, DELETE |
| `suggestion.sql.ts` | `rpg_club_suggestions`, `rpg_club_suggestion_review_sessions` | SELECT, INSERT, UPDATE, DELETE |
| `thread.sql.ts` | `threads`, `thread_game_links` | SELECT, INSERT (upsert), UPDATE, DELETE |
| `reminder.sql.ts` | `user_reminders`, `rpg_club_public_reminders` | SELECT, INSERT, UPDATE, DELETE |
| `todo.sql.ts` | `rpg_club_todos` | SELECT, INSERT, UPDATE, DELETE |
| `gameSearchSynonym.sql.ts` | `gamedb_search_synonyms`, `gamedb_search_synonym_groups`, `gamedb_search_synonym_drafts` | SELECT, INSERT, UPDATE, DELETE |
| `botVotingInfo.sql.ts` | `bot_voting_info` | SELECT, INSERT, UPDATE, DELETE |
| `starboard.sql.ts` | `rpg_club_starboard` | SELECT, INSERT |
| `gameKey.sql.ts` | `rpg_club_game_keys` | SELECT, INSERT, UPDATE (claim), DELETE (revoke) |
| `rssFeed.sql.ts` | `rpg_club_rss_feeds`, `rpg_club_rss_feed_items` | SELECT, INSERT, UPDATE, DELETE |
| `adminWizardSession.sql.ts` | `rpg_club_admin_wizard_sessions` | SELECT, INSERT, UPDATE, DELETE |
| `presencePrompt.sql.ts` | `rpg_club_presence_prompt_history`, `rpg_club_presence_prompt_opts` | SELECT, INSERT, UPDATE |
| `hltbCache.sql.ts` | `rpg_club_hltb_cache` | SELECT, INSERT (upsert) |
| `gameDbCsvImport.sql.ts` | `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items` | SELECT, INSERT, UPDATE |
| `botPresenceHistory.sql.ts` | `bot_presence_history` | SELECT, INSERT |
| `gameReleaseAnnouncement.sql.ts` | `gamedb_release_announcements`, `gamedb_releases`, `gamedb_games`, `gamedb_platforms` | SELECT, INSERT (upsert), UPDATE |
| `collectionCsvImport.sql.ts` | `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items` | SELECT, INSERT, UPDATE |
| `completionatorImport.sql.ts` | `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items`, `user_game_completions` | SELECT, INSERT, UPDATE |
| `gameDbCsvImportMapping.sql.ts` | `rpg_club_gamedb_import_items` | SELECT, UPDATE |
| `gotmAuditImport.sql.ts` | `gotm_entries`, `nr_gotm_entries`, import staging tables | SELECT, INSERT, UPDATE |
| `steamCollectionImport.sql.ts` | `rpg_club_gamedb_imports`, `rpg_club_gamedb_import_items`, `user_game_collections` | SELECT, INSERT, UPDATE |
