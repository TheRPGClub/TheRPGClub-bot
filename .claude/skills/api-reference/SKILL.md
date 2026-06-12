---
name: api-reference
model: claude-haiku-4-5
description: >
  Reference for The RPG Club API endpoints. Use when writing or reviewing code that calls the
  API, when asked what endpoints exist, or when choosing which endpoint to use for a feature.
  This is a read-only reference skill -- it does not perform actions.
---

The RPG Club API is a Rails JSON API. The bot authenticates with a bearer service token.

## Client helpers (src/services/RpgClubApiClient.ts)

```ts
apiGet<T>(path, config?)          // GET; returns T | null (null on 404)
apiGetRaw<T>(path, config?)       // GET; returns full metadata, never throws on 4xx/5xx
apiPost<T>(path, body?, config?)  // POST; returns T | null (null on 404)
apiPatch<T>(path, body?, config?) // PATCH; returns T | null (null on 404)
apiDelete<T>(path, config?)       // DELETE; returns T | null (null on 404)
```

All throw on non-404 errors. Pass query params via `config: { params: { ... } }`.

## Environment variables

- `RPGCLUB_API_BASE_URL` -- base URL (production: `https://therpgclub.fly.dev`)
- `RPGCLUB_BOT_API_TOKEN` -- bearer token sent as `Authorization: Bearer <token>`

## Request body envelope

Write endpoints expect: `{ data: { <attributes> } }`

## Response envelope

List responses: `{ data: [...], meta: { page, pages, count, per, prev, next } }`
Single responses: `{ data: { ... } }`
Deletes: `{ deleted: true }`

## Common query params (list endpoints)

`page`, `per`, `limit`, `offset` -- standard pagination. `q` for search where supported.

## PUT vs PATCH

PUT endpoints are aliases for PATCH. Prefer PATCH.

## Self-update

When asked to refresh this reference or when the API may have changed:

```bash
bash .claude/skills/api-reference/refresh.sh
```

Then commit and push the updated `SKILL.md`:

```bash
git add .claude/skills/api-reference/SKILL.md
git commit -m "chore: refresh api-reference skill from latest swagger spec"
git push
```

Source spec: `swagger/v1/swagger.yaml` in https://github.com/TheRPGClub/TheRPGClub

---

## Endpoints by group

### Auth

```
GET     /auth/discord  # Start Discord OAuth login
GET     /auth/discord/callback  # Discord OAuth callback (code, state)
DELETE  /auth/logout  # Log out
```

### Backlog

```
GET     /api/v1/backlog/{id}  # Show a backlog entry
PATCH   /api/v1/backlog/{id}  # Update a backlog entry
PUT     /api/v1/backlog/{id}  # Replace a backlog entry (alias)
DELETE  /api/v1/backlog/{id}  # Delete a backlog entry
GET     /api/v1/users/{user_id}/backlog  # List a user's backlog (page, per, limit, offset)
POST    /api/v1/users/{user_id}/backlog  # Add to backlog
  data: { UserGameBacklog attributes (`gamedb_game_id`, `platform_id`, `sort_order`, `notes`). }
```

### Collections

```
GET     /api/v1/collections/{id}  # Show a collection entry
PATCH   /api/v1/collections/{id}  # Update a collection entry
PUT     /api/v1/collections/{id}  # Replace a collection entry (alias)
DELETE  /api/v1/collections/{id}  # Delete a collection entry
GET     /api/v1/users/{user_id}/collections  # List a user's collections (page, per, limit, offset)
POST    /api/v1/users/{user_id}/collections  # Create a collection entry
  data: { UserGameCollection attributes (e.g. `gamedb_game_id`, `platform_id`, `notes`). }
```

### Companies

```
GET     /api/v1/companies  # List companies (q, page, per, limit, offset)
GET     /api/v1/companies/{id}  # Show company
```

### Completions

```
GET     /api/v1/completions/{id}  # Show a completion
PATCH   /api/v1/completions/{id}  # Update a completion
PUT     /api/v1/completions/{id}  # Replace a completion (alias)
DELETE  /api/v1/completions/{id}  # Delete a completion
GET     /api/v1/users/{user_id}/completions  # List a user's completions (page, per, limit, offset)
POST    /api/v1/users/{user_id}/completions  # Record a completion
  data: { UserGameCompletion attributes (e.g. `gamedb_game_id`, `platform_id`, `completed_at`, `rating`, `notes`). }
```

### Dashboard

```
GET     /api/v1/dashboard  # Front-page dashboard (limit)
```

### Engines

```
GET     /api/v1/engines  # List engines (q, page, per, limit, offset)
GET     /api/v1/engines/{id}  # Show engine
```

### Favorites

```
GET     /api/v1/favorites/{id}  # Show a favorite
PATCH   /api/v1/favorites/{id}  # Update a favorite
PUT     /api/v1/favorites/{id}  # Replace a favorite (alias)
DELETE  /api/v1/favorites/{id}  # Delete a favorite
GET     /api/v1/users/{user_id}/favorites  # List a user's favorites (page, per, limit, offset)
POST    /api/v1/users/{user_id}/favorites  # Add a favorite
  data: { UserGameFavorite attributes (`gamedb_game_id`, `sort_order`). }
```

### Franchises

```
GET     /api/v1/franchises  # List franchises (q, page, per, limit, offset)
GET     /api/v1/franchises/{id}  # Show franchise
```

### GOTM

```
GET     /api/v1/gotm_entries  # List Game of the Month entries (round_number, include, page, per, limit, offset)
GET     /api/v1/gotm_entries/{id}  # Show a Game of the Month entry (include)
GET     /api/v1/gotm_entries/{round}/nominations  # List GOTM nominations for a round (page, per, limit, offset)
GET     /api/v1/nr_gotm_entries/{round}/nominations  # List Non-RPG GOTM nominations for a round (page, per, limit, offset)
```

### Game Images

```
GET     /api/v1/games/{game_id}/images  # List images for a game
POST    /api/v1/games/{game_id}/images  # Upload a game image
PATCH   /api/v1/games/{game_id}/images/{id}  # Update a game image
  data: { is_primary, position }
PUT     /api/v1/games/{game_id}/images/{id}  # Update a game image (alias)
  data: { is_primary, position }
DELETE  /api/v1/games/{game_id}/images/{id}  # Delete a game image
```

### Game Keys

```
GET     /api/v1/game_keys  # List available game keys (page, per, limit, offset)
POST    /api/v1/game_keys  # Donate a game key
  data: { game_title, gamedb_game_id, platform*, key_value*, donor_user_id*, donor_notify_on_claim }
POST    /api/v1/game_keys/{id}/claim  # Claim a game key
  data: { claimed_by_user_id }
GET     /api/v1/users/{user_id}/game_keys  # List a user's donated game keys (page, per)
```

### Games

```
GET     /api/v1/games  # List games (q, winner, genre_id, engine_id, theme_id, perspective_id, mode_id, franchise_id, company_id, page, per, limit, offset)
GET     /api/v1/games/{id}  # Show game
GET     /api/v1/games/{id}/completions  # List completions for this game (page, per, limit, offset)
GET     /api/v1/games/{id}/now_playing  # List users currently playing this game (page, per, limit, offset)
POST    /api/v1/games/{id}/refresh-images  # Refresh images from IGDB
GET     /api/v1/games/{id}/relations  # Show game relations
GET     /api/v1/games/{id}/releases  # List game releases
GET     /api/v1/games/{id}/reviews  # List reviews for this game (page, per, limit, offset)
```

### Genres

```
GET     /api/v1/genres  # List genres (q, page, per, limit, offset)
GET     /api/v1/genres/{id}  # Show genre
```

### Health

```
GET     /api/v1/health  # Health check
```

### Journal

```
GET     /api/v1/games/{id}/journal  # List journal entries for a game (user_id, page, per)
GET     /api/v1/journal_entries/{id}  # Show a journal entry
PATCH   /api/v1/journal_entries/{id}  # Update a journal entry
PUT     /api/v1/journal_entries/{id}  # Replace a journal entry (alias)
DELETE  /api/v1/journal_entries/{id}  # Delete a journal entry
GET     /api/v1/users/{user_id}/journal  # List a user's journaled games (page, per)
POST    /api/v1/users/{user_id}/journal  # Write a journal entry
  data: { UserGameJournalEntry attributes (`gamedb_game_id`, `entry_body`, optional `entry_title`). }
```

### Modes

```
GET     /api/v1/modes  # List modes (q, page, per, limit, offset)
GET     /api/v1/modes/{id}  # Show mode
```

### Non-Retro GOTM

```
GET     /api/v1/nr_gotm_entries  # List Non-Retro Game of the Month entries (round_number, include, page, per, limit, offset)
GET     /api/v1/nr_gotm_entries/{id}  # Show a Non-Retro GOTM entry (include)
```

### Now Playing

```
GET     /api/v1/users/{user_id}/now_playing  # List a user's now-playing games (page, per, limit, offset)
```

### Perspectives

```
GET     /api/v1/perspectives  # List perspectives (q, page, per, limit, offset)
GET     /api/v1/perspectives/{id}  # Show perspective
```

### Platforms

```
GET     /api/v1/platforms  # List platforms (q, page, per, limit, offset)
GET     /api/v1/platforms/{id}  # Show platform
```

### Presence Prompts

```
GET     /api/v1/users/{user_id}/presence_prompt_opts  # Show a user's presence-prompt opt-out preference
PUT     /api/v1/users/{user_id}/presence_prompt_opts  # Replace a user's presence-prompt opt-out preference
  data: { all, games }
GET     /api/v1/users/{user_id}/presence_prompts  # List a user's presence prompt history (page, per)
```

### Public Reminders

```
GET     /api/v1/public_reminders  # List public reminders (enabled, page, per, limit, offset)
POST    /api/v1/public_reminders  # Create a public reminder
  data: { RpgClubPublicReminder attributes (`message`, `due_at`, `enabled`). }
GET     /api/v1/public_reminders/{id}  # Show a public reminder
PATCH   /api/v1/public_reminders/{id}  # Update a public reminder
PUT     /api/v1/public_reminders/{id}  # Replace a public reminder (alias)
DELETE  /api/v1/public_reminders/{id}  # Delete a public reminder
```

### RSS Feeds

```
GET     /api/v1/rss_feeds  # List RSS feeds (page, per, limit, offset)
POST    /api/v1/rss_feeds  # Create an RSS feed
  data: { RpgClubRssFeed attributes (`feed_name`, `feed_url`, `enabled`). }
GET     /api/v1/rss_feeds/{id}  # Show an RSS feed
PATCH   /api/v1/rss_feeds/{id}  # Update an RSS feed
PUT     /api/v1/rss_feeds/{id}  # Replace an RSS feed (alias)
DELETE  /api/v1/rss_feeds/{id}  # Delete an RSS feed
```

### Regions

```
GET     /api/v1/regions  # List regions (page, per, limit, offset)
GET     /api/v1/regions/{id}  # Show region
```

### Release Announcements

```
GET     /api/v1/games/{id}/release_announcements  # List a game's scheduled release announcements (page, per)
POST    /api/v1/release_announcements  # Schedule a release announcement
  data: { GamedbReleaseAnnouncement attributes (`release_id`, `announce_at`). }
GET     /api/v1/release_announcements/{id}  # Show a scheduled release announcement
PATCH   /api/v1/release_announcements/{id}  # Reschedule a release announcement
PUT     /api/v1/release_announcements/{id}  # Replace a release announcement (alias)
DELETE  /api/v1/release_announcements/{id}  # Delete a release announcement
POST    /api/v1/release_announcements/{id}/skip  # Skip a release announcement
  data: { skip_reason }
```

### Reminders

```
GET     /api/v1/reminders/{id}  # Show a personal reminder
PATCH   /api/v1/reminders/{id}  # Update (or snooze) a personal reminder
PUT     /api/v1/reminders/{id}  # Replace a personal reminder (alias)
DELETE  /api/v1/reminders/{id}  # Delete a personal reminder
GET     /api/v1/users/{user_id}/reminders  # List a user's personal reminders (page, per)
POST    /api/v1/users/{user_id}/reminders  # Create a personal reminder
  data: { UserReminder attributes (`remind_at`, `content`, optional `is_noisy`). }
```

### Reviews

```
GET     /api/v1/reviews/{id}  # Show a review
PATCH   /api/v1/reviews/{id}  # Update a review
PUT     /api/v1/reviews/{id}  # Replace a review (alias)
DELETE  /api/v1/reviews/{id}  # Delete a review
GET     /api/v1/users/{user_id}/reviews  # List a user's reviews (page, per, limit, offset)
POST    /api/v1/users/{user_id}/reviews  # Write a review
  data: { UserGameReview attributes (`gamedb_game_id`, `rating`, `body`). }
```

### Search Synonyms

```
GET     /api/v1/search_synonym_drafts  # List synonym drafts (user_id, page, per, limit, offset)
POST    /api/v1/search_synonym_drafts  # Create a synonym draft
  data: { GamedbSearchSynonymDraft attributes (`user_id`, `pairs_json`). }
GET     /api/v1/search_synonym_drafts/{id}  # Show a synonym draft
PATCH   /api/v1/search_synonym_drafts/{id}  # Update a synonym draft
PUT     /api/v1/search_synonym_drafts/{id}  # Replace a synonym draft (alias)
DELETE  /api/v1/search_synonym_drafts/{id}  # Delete a synonym draft
GET     /api/v1/search_synonym_groups  # List synonym groups (page, per, limit, offset)
POST    /api/v1/search_synonym_groups  # Create a synonym group
  data: { GamedbSearchSynonymGroup attributes (`created_by`). }
GET     /api/v1/search_synonym_groups/{id}  # Show a synonym group
PATCH   /api/v1/search_synonym_groups/{id}  # Update a synonym group
PUT     /api/v1/search_synonym_groups/{id}  # Replace a synonym group (alias)
DELETE  /api/v1/search_synonym_groups/{id}  # Delete a synonym group
GET     /api/v1/search_synonyms  # List search synonym terms (group_id, page, per, limit, offset)
POST    /api/v1/search_synonyms  # Create a synonym term
  data: { GamedbSearchSynonym attributes (`group_id`, `term_text`, `term_norm`, `created_by`). }
GET     /api/v1/search_synonyms/{id}  # Show a synonym term
PATCH   /api/v1/search_synonyms/{id}  # Update a synonym term
PUT     /api/v1/search_synonyms/{id}  # Replace a synonym term (alias)
DELETE  /api/v1/search_synonyms/{id}  # Delete a synonym term
```

### Sessions

```
GET     /api/v1/session  # Current session
```

### Social Platforms

```
GET     /api/v1/social_platforms  # List social platforms (page, per, limit, offset)
POST    /api/v1/social_platforms  # Create or upsert a social platform
  data: { SocialPlatform attributes (`label`, `icon`, `position`, etc.). }
```

### Starboard

```
GET     /api/v1/starboard  # List starboard entries (page, per, limit, offset)
POST    /api/v1/starboard  # Create a starboard entry
  data: { RpgClubStarboardEntry attributes (`message_id`, `channel_id`, `author_id`, `content`). }
GET     /api/v1/starboard/{message_id}  # Show a starboard entry
PATCH   /api/v1/starboard/{message_id}  # Update a starboard entry
PUT     /api/v1/starboard/{message_id}  # Replace a starboard entry (alias)
DELETE  /api/v1/starboard/{message_id}  # Delete a starboard entry
```

### Suggestions

```
GET     /api/v1/suggestions  # List suggestions (page, per, limit, offset)
POST    /api/v1/suggestions  # Create a suggestion
  data: { RpgClubSuggestion attributes (`title`, `body`, `submitted_by`). }
GET     /api/v1/suggestions/{id}  # Show a suggestion
DELETE  /api/v1/suggestions/{id}  # Delete a suggestion
```

### Themes

```
GET     /api/v1/themes  # List themes (q, page, per, limit, offset)
GET     /api/v1/themes/{id}  # Show theme
```

### Threads

```
GET     /api/v1/games/{id}/threads  # List the Discord threads linked to a game (page, per, limit, offset)
POST    /api/v1/threads  # Upsert a Discord thread
  data: { Thread attributes (`thread_id`, `forum_channel_id`, `thread_name`, `is_archived`, `last_seen_at`, `skip_linking`). }
GET     /api/v1/threads/{id}  # Show a thread and its game links
PATCH   /api/v1/threads/{id}  # Update a thread
POST    /api/v1/threads/{id}/links  # Link a thread to a game
  data: { The link target (`gamedb_game_id`). }
DELETE  /api/v1/threads/{id}/links  # Remove all of a thread's game links
DELETE  /api/v1/threads/{id}/links/{game_id}  # Remove one game link from a thread
```

### Todos

```
GET     /api/v1/todos  # List todos (completed, page, per, limit, offset)
POST    /api/v1/todos  # Create a todo
  data: { RpgClubTodo attributes (`title`, `body`, `is_completed`). }
GET     /api/v1/todos/summary  # Todo counts summary
GET     /api/v1/todos/{id}  # Show a todo
PATCH   /api/v1/todos/{id}  # Update a todo
PUT     /api/v1/todos/{id}  # Replace a todo (alias)
DELETE  /api/v1/todos/{id}  # Delete a todo
```

### User Activity Icons

```
GET     /api/v1/users/{user_id}/activity_icons  # List a user's activity icons (page, per)
```

### User Channel Counts

```
GET     /api/v1/users/{user_id}/channel_counts  # List a user's per-channel message counts (page, per)
```

### User Nick History

```
GET     /api/v1/users/{user_id}/nick_history  # List a user's nickname history (page, per)
```

### User Socials

```
GET     /api/v1/user_socials/{id}  # Show a user social link
PATCH   /api/v1/user_socials/{id}  # Update a user social link
PUT     /api/v1/user_socials/{id}  # Replace a user social link (alias)
DELETE  /api/v1/user_socials/{id}  # Delete a user social link
GET     /api/v1/users/{user_id}/socials  # List a user's linked socials (page, per, limit, offset)
POST    /api/v1/users/{user_id}/socials  # Link a social account
  data: { UserSocial attributes (`social_platform_id`, `handle`, `url`, etc.). }
```

### Users

```
GET     /api/v1/users  # List users (q, page, per, limit, offset)
GET     /api/v1/users/{user_id}  # Show user profile (preview_limit)
GET     /api/v1/users/{user_id}/avatar  # Stream user avatar
GET     /api/v1/users/{user_id}/profile-image  # Stream user profile image
```

### Voting Info

```
GET     /api/v1/voting_info  # List voting info rounds (page, per, limit, offset)
POST    /api/v1/voting_info  # Create voting info
  data: { BotVotingInfo attributes (`round_number`, `theme`, `voting_opens_at`, `voting_closes_at`). }
GET     /api/v1/voting_info/{id}  # Show voting info
PATCH   /api/v1/voting_info/{id}  # Update voting info
PUT     /api/v1/voting_info/{id}  # Replace voting info (alias)
DELETE  /api/v1/voting_info/{id}  # Delete voting info
```

---

## Source references

- Swagger spec: `swagger/v1/swagger.yaml` in https://github.com/TheRPGClub/TheRPGClub
- Live Swagger UI: https://therpgclub.fly.dev/api-docs/index.html
- Bot client: `src/services/RpgClubApiClient.ts`
