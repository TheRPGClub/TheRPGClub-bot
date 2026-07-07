# Functionality Inventory

Comprehensive inventory of every Discord bot command (with subcommands and parameter variants) and
every service/data class, including whether each path reads/writes through the RPG Club HTTP API or
still uses raw SQL. Sourced from `src/commands/`, `src/classes/`, `src/services/`, and `src/db/sql/`.

The API migration (to `src/services/RpgClubApiClient.ts`, helpers
`apiGet`/`apiPost`/`apiPatch`/`apiDelete`/`apiGetRaw`/`apiPostForm`) is now **essentially complete**.
Nearly every data class routes through the API. The only remaining SQL lives in a handful of
local/staging concerns (import staging tables, admin wizard sessions, the HLTB cache, and the
journal-message-context tracking table). See **Data-Access Status** below for the exact holdouts.

---

## Data-Access Status (as of 2026-07-07)

Data access happens at the class layer (`src/classes/`). A command inherits its status from the class
methods it calls. "API sites" counts `apiGet/apiPost/apiPatch/apiDelete/apiGetRaw/apiPostForm` call
sites; "SQL sites" counts `dbQuery/dbMutate/dbInsert/dbWithConnection/dbQueryConn/...` call sites.

### Class-level status

Full API (no SQL):
- `BotVotingInfo`, `BotPresenceHistory`, `Game`, `GameKey`, `GamePlatformRegionService`,
  `GameProfileService`, `GameReleaseAnnouncement`, `GameSearchService`, `GameSearchSynonym`,
  `GameSearchSynonymDraft`, `Gotm`, `NrGotm`, `Nomination`, `PresencePromptHistory`,
  `PresencePromptOptOut`, `PublicReminder`, `RssFeed`, `Starboard`, `Suggestion`,
  `SuggestionReviewSession`, `Thread`, `UserGameBacklog`, `UserGameCollection`.
- `Member` -- Mostly API (43 API sites). The **only** remaining SQL is the `journal_message_contexts`
  table (upsert/delete/load/prune of journal message contexts). Everything else -- profile, socials,
  now-playing, completions, journal entries, avatar/nick history, emoji-name sync -- is API.

SQL-only (not migrated):
- `AdminWizardSession` -- `rpg_club_admin_wizard_sessions` (interactive wizard state).
- `HltbCache` -- `rpg_club_hltb_cache` (HowLongToBeat lookup cache).
- `CollectionCsvImport` -- `rpg_club_collection_csv_imports`, `rpg_club_collection_csv_import_items`.
- `CompletionatorImport` -- `rpg_club_completionator_imports`,
  `rpg_club_completionator_import_items`, `user_game_completions` (writes).
- `SteamCollectionImport` -- `rpg_club_steam_collection_imports`,
  `rpg_club_steam_collection_import_items`, `rpg_club_steam_app_gamedb_map`.

### Service-level status

Services no longer make direct DB or API calls of their own; they route through data classes (the one
exception being `GameImageService`, which calls `apiGet /games/{id}/images` directly). Status is
inherited from the class each service uses:

- `GameImageService` -- Full API (calls `/games/{id}/images` directly).
- `GameReleaseAnnouncementService` -- Full API (via `GameReleaseAnnouncement`).
- `GiveawayHubService` -- Full API (via `GameKey`).
- `NominationReminderService` -- Full API (via `BotVotingInfo`).
- `PublicReminderService` -- Full API (via `PublicReminder`).
- `RssFeedService` -- Full API (via `RssFeed`; feed list/CRUD and feed-item seen/mark tracking are
  now all API).
- `ThreadSyncService` -- Full API (via `Thread.upsertThreadRecord`).
- `ThreadLinkPromptService` -- Full API (via `Game`, `Thread`, `GameSearchService`).
- `UserEmojiService` -- Full API (via `Member`).
- `ForumThreadJoinService`, `PokopiaEmojiService` -- no DB access (Discord/local-data only).
- `BackblazeB2Service`, `DockerVolumeBackupService`, `SteamApiService`, `GithubIssuesService`,
  `ThreadLinkPromptCache`, `collageGenerator` -- external APIs / in-memory / no DB.
- `IGDB/IgdbService`, `IGDB/IgdbSelectService` -- external IGDB API; persistence flows back through
  the `Game` class (API).

---

## Commands

### `/admin` (SlashGroup -- moderator/admin only)

Note: the former `gotm-audit` subcommand has been removed.

| Subcommand | Parameters | Data Access |
|---|---|---|
| `sync` | none | none (Discord command re-registration) |
| `set-nextvote` | `date` | API: GET + PATCH `/voting_info/{round}` |
| `delete-gotm-noms` | none | API: DELETE GOTM nominations |
| `delete-nr-gotm-noms` | none | API: DELETE NR-GOTM nominations |
| `voting-setup` | none | API: GET `/voting_info` + nominations |
| `nextround-setup` | `testmode` (bool, optional) | API: GOTM/NR-GOTM/voting_info reads + writes; SQL admin wizard session (`rpg_club_admin_wizard_sessions`) |
| `add-gotm` | (wizard prompts) | API: voting_info + gotm_entries insert |
| `add-nr-gotm` | (wizard prompts) | API: voting_info + nr_gotm_entries insert |
| `edit-gotm` | `round` (autocomplete) | API: GET/PATCH gotm_entries |
| `edit-nr-gotm` | `round` (autocomplete) | API: GET/PATCH nr_gotm_entries |
| `sql-health-check` | none | SQL: connectivity ping |
| `help` | none | none |

---

### `/avatar-history`

Parameters: `member` (optional), `private` (bool), `all` (bool), `scan` (bool)

API: GET `/users/{id}/avatar_history`; optional POST when `scan` is set (via `Member`).

---

### `/backlog` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `add` | `title` (autocomplete), `platform` (autocomplete), `note` (optional) | API: game/platform lookup + POST backlog entry |
| `edit` | `entry` (autocomplete), `platform` (autocomplete), `note` (optional), `clear_note` (bool), `sort_order` (optional) | API: GET + PATCH backlog entry |
| `remove` | `entry` (autocomplete) | API: GET + DELETE backlog entry |
| `list` | `title` (optional filter), `private` (bool) | API: GET backlog entries |

Backed by `UserGameBacklog` (Full API).

---

### `/collection` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `add` | `title` (autocomplete), `platform` (autocomplete), `ownership_type` (choice), `note` (optional) | API: game/platform lookup + POST `/users/{id}/collections` |
| `edit` | `entry` (autocomplete), `platform` (autocomplete), `ownership_type` (choice), `note` (optional), `clear_note` (bool) | API: GET + PATCH `/collections/{id}` |
| `remove` | `entry` (autocomplete) | API: GET + DELETE `/collections/{id}` |
| `to-now-playing` | `entry` (autocomplete), `note_override` (optional) | API: GET collection + POST now-playing |
| `to-completion` | `entry` (autocomplete), `completion_type` (choice), `completion_date` (optional), `final_playtime_hours` (optional), `note` (optional), `announce` (bool), `remove_from_now_playing` (bool) | API: GET collection + POST `/users/{id}/completions` |
| `list` | `member` (optional), `title` (filter), `platform` (filter), `ownership_type` (filter), `private` (bool) | API: GET collections |
| `overview` | `member` (optional), `all` (bool), `private` (bool) | API: GET collections grouped by platform |
| `import-csv` | `action` (Start/Continue/Abort), `file` (attachment, conditional) | SQL: `rpg_club_collection_csv_imports`, `rpg_club_collection_csv_import_items` (staging); API on final apply |
| `import-steam` | `action` (Start/Continue/Abort), `steam_profile` (optional URL/ID) | SQL: `rpg_club_steam_collection_imports`, `..._items`, `rpg_club_steam_app_gamedb_map`; Steam API lookup; API on final apply |

CRUD/list/overview backed by `UserGameCollection` (Full API). Imports use SQL staging classes.

---

### `/create-thread`

Parameters: `title` (autocomplete, GameDB game), `tag` (forum tag choice), `first-post-text` (optional)

API: GET `/games/{id}` + POST `/threads` (+ POST `/threads/{id}/links`).

---

### `/game-completion` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `add` | `title` (autocomplete), `completion_type` (choice), `platform` (autocomplete), `note` (optional), `completion_date` (optional), `final_playtime_hours` (optional), `announce` (bool) | API: POST `/users/{id}/completions` |
| `list` | `all` (bool), `year` (optional int), `query` (optional string), `member` (optional), `private` (bool) | API: GET completions |
| `common` | `member_one` (optional), `member_two` (optional), `sort` (choice), `year` (optional int), `platform` (optional), `query` (optional), `private` (bool) | API: GET completions for both members |
| `edit` | `title` (autocomplete), `completion_type` (choice), `completion_date` (optional), `platform` (autocomplete), `final_playtime_hours` (optional), `note` (optional) | API: GET + PATCH `/completions/{id}` |
| `delete` | `title` (autocomplete completion entry) | API: GET + DELETE `/completions/{id}` |
| `export` | none | API: GET all completions for invoking user; returns CSV attachment |
| `import-completionator` | `action` (Start/Continue/Abort), `file` (attachment, conditional) | SQL: `rpg_club_completionator_imports`, `..._items`, `user_game_completions` (staging + apply) |

CRUD/list/common/export backed by `Member` (API). Completionator import uses SQL staging.

---

### `/gamedb` (SlashGroup)

The former `csv-import` and `audit` subcommands have been removed; GameDB reads/writes are now Full
API via the `Game` class, and IGDB data is fetched externally then persisted through the API.

| Subcommand | Parameters | Data Access |
|---|---|---|
| `view` | `title` (autocomplete) | API: GET `/games/{id}`, `/releases`, `/platforms`, `/regions`, `/companies`, `/images`, `/threads`, plus completion/now-playing aggregates |
| `search` | `title` (string), `upcoming_release` (bool), `platform` (optional), `year` (optional), `developer` (optional), `publisher` (optional) | API: GET `/games` (search + synonym expansion) |
| `add` | `title` (optional), `igdb_id` (optional), `bulk_titles` (optional) | External IGDB search -> confirm; API: POST `/games` + release/metadata writes |
| `refresh-release-info` | `title` (autocomplete or GameDB ID) | External IGDB re-fetch; API: PATCH releases/announcements |
| `link-versions` | `game_ids` (comma-separated IDs), `private` (bool) | API: POST `/games/{id}/alternates` |
| `synonym-add` | `base_term` (string), `synonym` (string), `additional_synonyms` (optional), `private` (bool) | API: POST synonym group + synonyms |
| `synonym-list` | `query` (optional filter), `private` (bool) | API: GET synonym groups/terms |

Component handlers for the GameDB completion/now-playing/thread flows live in
`gamedb-completion.command.ts` and `gamedb-thread.command.ts` (select/button/modal handlers, not
standalone slash commands).

---

### `/game-journal`

Parameters: `all` (bool), `member` (optional), `private` (bool), `query` (optional string),
`game` (optional autocomplete)

API: GET `/users/{id}/journal` or `/games/{id}/journal`; entry CRUD POST/PATCH/DELETE journal entries
(via `Member`). Journal *message-context* tracking (for live message editing) is the one Member SQL
holdout (`journal_message_contexts`).

---

### `/generate-vote-image`

Parameters: `vote_type` (GOTM/NR-GOTM choice), `round` (autocomplete)

API: GET round nominations + GET `/games/{id}/images` per nominee (no writes).

---

### `/giveaway` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `list` | `private` (bool) | API: GET `/game_keys` (available, unclaimed) |
| `donate` | `title` (autocomplete), `platform` (autocomplete), `key` (string) | API: game/platform lookup + POST `/game_keys` |
| `revoke` | `key_id` (autocomplete) | API: GET/DELETE own `/game_keys` |

Also `/gamegiveaway` (standalone): posts a link to the giveaway hub channel; no DB access.
Backed by `GameKey` (Full API).

---

### `/help`

No parameters. No DB access.

---

### `/hltb`

Parameters: `title` (string), `private` (bool)

SQL: SELECT `rpg_club_hltb_cache`; INSERT/UPDATE cache on miss (HowLongToBeat API fetch). This cache
is not yet migrated.

---

### `/mod` (SlashGroup -- moderator only)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `presence` | `text` (string) | API: POST presence history (via `BotPresenceHistory`) |
| `presence-history` | `count` (int, optional) | API: GET presence history |
| `create-live-event` | (modal: title, description, start time, etc.) | API: POST `/threads` (+ linked scheduled event) |
| `help` | none | none |

---

### `/mp-info`

Parameters: `private` (bool), `steam`, `xbl`, `psn`, `switch` (bool filters, any combination)

API: GET members + socials filtered by requested platform handles (via `Member`).

---

### `/nominate`

Parameters: `title` (autocomplete), `type` (GOTM/NR-GOTM choice), `reason` (string)

API: GET `/games/{id}` + voting_info; POST/PATCH nomination (via `Nomination`, `BotVotingInfo`).

Sub-display **`noms`**: `type` (GOTM/NR-GOTM), `private` (bool) -- API: GET round nominations.

---

### `/now-playing` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `add` | `title` (autocomplete), `platform` (autocomplete), `note` (optional string), `private` (bool) | API: game/platform lookup + POST now-playing; prompts thread-link if unlinked |
| `list` | `member` (optional), `all` (bool), `private` (bool) | API: GET now-playing + game/platform/thread details |
| `search` | `title` (autocomplete), `private` (bool) | API: GET now-playing filtered by game |

Backed by `Member` and `Game` (Full API).

---

### `/pokopia` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `pokedex` | `sort` (Number/Name choice), `order` (Asc/Desc choice), `query` (optional filter) | none (local JSON: `pokemon.json`) |
| `habitat` | `order` (Asc/Desc choice), `query` (optional filter) | none (local JSON: `habitats.json`) |

Reads bundled JSON data via `pokopia-data.service.ts`; no DB access. Component handlers live in
`pokopia-components.command.ts`.

---

### `/profile` (SlashGroup)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `view` | `member` (optional), `private` (bool) | API: GET `/users/{id}`, `/nick_history`, completion/now-playing counts |
| `search` | `private` (bool), `query` (string) | API: GET `/users` (search) |
| `edit` | `member` (optional, admin override), `completionator`, `psn`, `xbl`, `nsw`, `steam` (optional string each) | API: GET `/social_platforms`; POST/PATCH/DELETE `/users/{id}/socials` |

Backed by `Member` (API) and profile.command.ts direct API calls.

---

### `/publicreminder` (SlashGroup -- admin only)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `create` | `channel` (mention), `date` (string), `time` (string), `message` (string), `recur` (bool), `recurunit` (Minutes/Hours/Days/Weeks/Months/Years choice) | API: POST `/public_reminders` |
| `list` | none | API: GET `/public_reminders` (upcoming, enabled) |
| `delete` | `id` (int) | API: GET + DELETE `/public_reminders/{id}` |

Backed by `PublicReminder` (Full API).

---

### `/round`

Parameters: `private` (bool)

API: GET `/gotm_entries`, `/nr_gotm_entries`, `/voting_info`.

---

### `/round-history`

Parameters: `private` (bool)

API: GET all `/gotm_entries`, `/nr_gotm_entries` ordered by round.

---

### `/rss` (SlashGroup -- admin only)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `help` | none | none |
| `add` | `url` (string), `channel` (mention), `name` (string), `include` (optional regex), `exclude` (optional regex) | API: POST `/rss_feeds` |
| `remove` | `id` (int, autocomplete) | API: DELETE `/rss_feeds/{id}` |
| `edit` | `id` (int, autocomplete), `url` (optional), `name` (optional), `channel` (optional), `include` (optional), `exclude` (optional) | API: PATCH `/rss_feeds/{id}` |
| `list` | none | API: GET `/rss_feeds` |

Backed by `RssFeed` (Full API, including feed-item seen/mark tracking).

---

### `/suggestion`

No slash parameters (opens a modal: title + suggestion text).

API: POST `/suggestions`. Interactive review flow (approve/reject/defer buttons + selects,
admin-only) uses API via `Suggestion` and `SuggestionReviewSession`.

---

### `/superadmin` (SlashGroup -- server owner only)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `completion-add-other` | `user`, `title` (autocomplete), `completion_type` (choice), `completion_date` (optional), `final_playtime_hours` (optional), `announce` (bool) | API: POST `/users/{id}/completions` |
| `say` | `message` (string), `message_id` (optional, for edit), `channel_id` (optional) | none |
| `memberscan` | none | API: upsert `/users` for all current guild members; marks departed |
| `download-missing-images` | none | API: GET all game IDs + POST/refresh images for GameDB titles lacking API images (Backblaze/IGDB) |
| `help` | none | none |

---

### `/thread` (SlashGroup -- admin only)

| Subcommand | Parameters | Data Access |
|---|---|---|
| `link` | `thread_id` (string), `gamedb_game_id` (int) | API: POST `/threads/{id}/links` |
| `unlink` | `thread_id` (string), `gamedb_game_id` (int) | API: DELETE `/threads/{id}/links/{game_id}` |

Backed by `Thread` (Full API).

---

### `/timestamp`

Parameters: `datetime` (string), `parsing_timezone` (string, optional), `public` (bool),
`format` (choice: F/f/D/d/T/t/R)

No DB access (pure date/time conversion).

---

### `/todo`

Parameters: `query` (optional), `state` (open/closed/all choice), `labels` (optional),
`sort` (choice), `direction` (choice), `page` (int), `per_page` (int), `private` (bool)

No DB access; proxies the GitHub Issues API live via `GithubIssuesService`.

---

## Background Services

Services orchestrate periodic/event-driven work through data classes. Full data-path status is in
**Data-Access Status** above.

- `RssFeedService` -- loads active feeds and posts new items each poll cycle (via `RssFeed`, API).
- `PublicReminderService` -- fires due public reminders; advances recurrence / disables one-shots
  (via `PublicReminder`, API).
- `GameReleaseAnnouncementService` -- posts due game-release announcements; marks sent/missed
  (via `GameReleaseAnnouncement`, API).
- `NominationReminderService` -- posts nomination reminders; flags `reminder_sent`
  (via `BotVotingInfo`, API).
- `ThreadSyncService` -- upserts forum thread metadata on create/update events
  (via `Thread.upsertThreadRecord`, API).
- `ThreadLinkPromptService` -- prompts to link a thread after `/now-playing add` when a game has no
  linked thread (via `Game`/`Thread`/`GameSearchService`, API). `ThreadLinkPromptCache` holds
  in-memory prompt state.
- `UserEmojiService` -- syncs a member's custom emoji-name on display-name change
  (via `Member`, API).
- `GiveawayHubService` -- refreshes the giveaway hub channel message (via `GameKey`, API).
- `GameImageService` -- fetches game images directly (`apiGet /games/{id}/images`).
- `ForumThreadJoinService` -- auto-joins/manages forum threads (Discord only).
- `PokopiaEmojiService` -- Pokopia emoji management (Discord/local data only).
- `SteamApiService` -- external Steam API lookups (collection import).
- `GithubIssuesService` -- external GitHub Issues API (backs `/todo`).
- `BackblazeB2Service` -- external Backblaze B2 storage (game images).
- `DockerVolumeBackupService` -- container volume backup routine.
- `collageGenerator` -- image collage rendering (vote images, etc.).
- `IGDB/IgdbService`, `IGDB/IgdbSelectService` -- external IGDB API; persistence flows through the
  `Game` class (API).

---

## SQL Definition Files (`src/db/sql/`)

Only the remaining non-migrated data paths still ship SQL. Everything else has moved to the API.

| File | Tables | Operation Types |
|---|---|---|
| `member.sql.ts` | `journal_message_contexts` | SELECT, INSERT (upsert), DELETE |
| `adminWizardSession.sql.ts` | `rpg_club_admin_wizard_sessions` | SELECT, INSERT, UPDATE, DELETE |
| `hltbCache.sql.ts` | `rpg_club_hltb_cache` | SELECT, INSERT (upsert), UPDATE |
| `collectionCsvImport.sql.ts` | `rpg_club_collection_csv_imports`, `rpg_club_collection_csv_import_items` | SELECT, INSERT, UPDATE |
| `completionatorImport.sql.ts` | `rpg_club_completionator_imports`, `rpg_club_completionator_import_items`, `user_game_completions` | SELECT, INSERT, UPDATE |
| `steamCollectionImport.sql.ts` | `rpg_club_steam_collection_imports`, `rpg_club_steam_collection_import_items`, `rpg_club_steam_app_gamedb_map` | SELECT, INSERT, UPDATE |

Supporting files: `index.ts` (barrel exports) and `types.ts` (`ISqlEntry`).
