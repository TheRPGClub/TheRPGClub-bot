---
name: api-reference
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

---

## Endpoints by group

### Auth

```
GET    /auth/discord              Start Discord OAuth login
GET    /auth/discord/callback     Discord OAuth callback
DELETE /auth/logout               Log out
GET    /api/v1/session            Current session info
```

### Health

```
GET  /api/v1/health             Health check
```

### Users

```
GET  /api/v1/users              List users (q, page, per)
GET  /api/v1/users/{user_id}    Show user profile (preview_limit)
GET  /api/v1/users/{user_id}/avatar         Stream user avatar
GET  /api/v1/users/{user_id}/profile-image  Stream user profile image
GET  /api/v1/users/{user_id}/activity_icons List user activity icons
GET  /api/v1/users/{user_id}/channel_counts Per-channel message counts
GET  /api/v1/users/{user_id}/nick_history   Nickname history
GET  /api/v1/users/{user_id}/now_playing    Now-playing games (page, per, limit, offset)
```

### Games

```
GET  /api/v1/games              List games (q, winner, genre_id, engine_id, theme_id,
                                perspective_id, mode_id, franchise_id, company_id,
                                page, per, limit, offset)
GET  /api/v1/games/{id}         Show game
GET  /api/v1/games/{id}/relations       Game relations
GET  /api/v1/games/{id}/releases        Game releases
GET  /api/v1/games/{id}/completions     Completions for this game
GET  /api/v1/games/{id}/reviews         Reviews for this game
GET  /api/v1/games/{id}/now_playing     Users currently playing this game
GET  /api/v1/games/{id}/journal         Journal entries for this game
GET  /api/v1/games/{id}/threads         Discord threads linked to this game
GET  /api/v1/games/{id}/release_announcements  Scheduled release announcements
POST /api/v1/games/{id}/refresh-images  Refresh images from IGDB
```

### Backlog

```
GET  /api/v1/users/{user_id}/backlog    List user's backlog (page, per, limit, offset)
POST /api/v1/users/{user_id}/backlog    Add to backlog
  data: { gamedb_game_id, platform_id, sort_order, notes }

GET    /api/v1/backlog/{id}             Show backlog entry
PATCH  /api/v1/backlog/{id}            Update backlog entry
DELETE /api/v1/backlog/{id}            Delete backlog entry
```

### Collections

```
GET  /api/v1/users/{user_id}/collections   List user's collections (page, per, limit, offset)
POST /api/v1/users/{user_id}/collections   Create collection entry

GET    /api/v1/collections/{id}            Show collection entry
PATCH  /api/v1/collections/{id}           Update collection entry
DELETE /api/v1/collections/{id}           Delete collection entry
```

### Completions

```
GET  /api/v1/users/{user_id}/completions   List user's completions (page, per, limit, offset)
POST /api/v1/users/{user_id}/completions   Record a completion
  data: { gamedb_game_id, platform_id, completed_at, rating, notes }

GET    /api/v1/completions/{id}            Show completion
PATCH  /api/v1/completions/{id}           Update completion
DELETE /api/v1/completions/{id}           Delete completion
```

### Reviews

```
GET  /api/v1/users/{user_id}/reviews   List user's reviews (page, per, limit, offset)
POST /api/v1/users/{user_id}/reviews   Write a review
  data: { gamedb_game_id, rating, body }

GET    /api/v1/reviews/{id}            Show review
PATCH  /api/v1/reviews/{id}           Update review
DELETE /api/v1/reviews/{id}           Delete review
```

### Journal

```
GET  /api/v1/users/{user_id}/journal   List user's journaled games (page, per)
POST /api/v1/users/{user_id}/journal   Write a journal entry
  data: { gamedb_game_id, entry_body, entry_title (optional) }

GET    /api/v1/journal_entries/{id}    Show journal entry
PATCH  /api/v1/journal_entries/{id}   Update journal entry
DELETE /api/v1/journal_entries/{id}   Delete journal entry
```

### Favorites

```
GET  /api/v1/users/{user_id}/favorites   List user's favorites (page, per, limit, offset)
POST /api/v1/users/{user_id}/favorites   Add a favorite

GET    /api/v1/favorites/{id}            Show favorite
PATCH  /api/v1/favorites/{id}           Update favorite
DELETE /api/v1/favorites/{id}           Delete favorite
```

### GOTM (Game of the Month)

```
GET  /api/v1/gotm_entries               List GOTM entries (round_number, include, page, per)
GET  /api/v1/gotm_entries/{id}          Show GOTM entry (include)
GET  /api/v1/gotm_entries/{round}/nominations  GOTM nominations for a round (page, per)

GET  /api/v1/nr_gotm_entries            List Non-Retro GOTM entries (round_number, include, page, per)
GET  /api/v1/nr_gotm_entries/{id}       Show Non-Retro GOTM entry
GET  /api/v1/nr_gotm_entries/{round}/nominations  Non-Retro GOTM nominations (page, per)
```

### Voting Info

```
GET  /api/v1/voting_info            List voting info rounds (page, per, limit, offset)
POST /api/v1/voting_info            Create voting info
  data: { round_number, theme, voting_opens_at, voting_closes_at }

GET    /api/v1/voting_info/{id}     Show voting info
PATCH  /api/v1/voting_info/{id}    Update voting info
DELETE /api/v1/voting_info/{id}    Delete voting info
```

### Reminders (personal)

```
GET  /api/v1/users/{user_id}/reminders   List user's reminders (page, per)
POST /api/v1/users/{user_id}/reminders   Create a reminder
  data: { remind_at, content, is_noisy (optional) }

GET    /api/v1/reminders/{id}            Show reminder
PATCH  /api/v1/reminders/{id}           Update / snooze reminder
DELETE /api/v1/reminders/{id}           Delete reminder
```

### Public Reminders

```
GET  /api/v1/public_reminders           List public reminders (enabled, page, per, limit, offset)
POST /api/v1/public_reminders           Create public reminder
  data: { message, due_at, enabled }

GET    /api/v1/public_reminders/{id}    Show public reminder
PATCH  /api/v1/public_reminders/{id}   Update public reminder
DELETE /api/v1/public_reminders/{id}   Delete public reminder
```

### Todos

```
GET  /api/v1/todos              List todos (completed, page, per, limit, offset)
GET  /api/v1/todos/summary      Todo counts summary
POST /api/v1/todos              Create a todo
  data: { title, body, is_completed }

GET    /api/v1/todos/{id}       Show todo
PATCH  /api/v1/todos/{id}      Update todo
DELETE /api/v1/todos/{id}      Delete todo
```

### Suggestions

```
GET  /api/v1/suggestions        List suggestions (page, per, limit, offset)
POST /api/v1/suggestions        Create a suggestion
  data: { title, body, submitted_by }

GET    /api/v1/suggestions/{id} Show suggestion
DELETE /api/v1/suggestions/{id} Delete suggestion
```

### Starboard

```
GET  /api/v1/starboard                  List starboard entries (page, per, limit, offset)
POST /api/v1/starboard                  Create starboard entry
  data: { message_id, channel_id, author_id, content }

GET    /api/v1/starboard/{message_id}   Show starboard entry
PATCH  /api/v1/starboard/{message_id}  Update starboard entry
DELETE /api/v1/starboard/{message_id}  Delete starboard entry
```

### Threads

```
POST /api/v1/threads            Upsert a Discord thread
  data: { thread_id, forum_channel_id, thread_name, is_archived, last_seen_at, skip_linking }

GET  /api/v1/threads/{id}       Show thread and its game links
PATCH /api/v1/threads/{id}     Update thread

POST   /api/v1/threads/{id}/links           Link thread to a game
DELETE /api/v1/threads/{id}/links           Remove all game links from thread
DELETE /api/v1/threads/{id}/links/{game_id} Remove one game link from thread
```

### Game Keys

```
GET  /api/v1/game_keys          List available keys (page, per, limit, offset)
POST /api/v1/game_keys          Donate a key
  data: { platform*, key_value*, donor_user_id*, game_title, gamedb_game_id,
          donor_notify_on_claim }
  (* required; provide game_title OR gamedb_game_id)

POST /api/v1/game_keys/{id}/claim  Claim a key
  data: { claimed_by_user_id }

GET  /api/v1/users/{user_id}/game_keys  List user's donated keys
```

### Release Announcements

```
POST /api/v1/release_announcements       Schedule a release announcement
  data: { release_id, announce_at }

GET    /api/v1/release_announcements/{id}       Show scheduled announcement
PATCH  /api/v1/release_announcements/{id}      Reschedule announcement
DELETE /api/v1/release_announcements/{id}      Delete announcement
POST   /api/v1/release_announcements/{id}/skip Skip announcement
  data: { skip_reason }

GET  /api/v1/games/{id}/release_announcements  List game's scheduled announcements
```

### Game Images

```
GET  /api/v1/games/{game_id}/images             List images for a game
POST /api/v1/games/{game_id}/images             Upload a game image

PATCH  /api/v1/games/{game_id}/images/{id}     Update image
  data: { is_primary, position }
DELETE /api/v1/games/{game_id}/images/{id}     Delete image
```

### Presence Prompts

```
GET /api/v1/users/{user_id}/presence_prompts         Presence prompt history
GET /api/v1/users/{user_id}/presence_prompt_opts     Show opt-out preference
PUT /api/v1/users/{user_id}/presence_prompt_opts     Update opt-out preference
  data: { all: boolean, games: string[] }
```

### Dashboard

```
GET /api/v1/dashboard           Front-page dashboard data
```

### Lookup / Reference data (read-only)

```
GET /api/v1/companies           List companies
GET /api/v1/companies/{id}
GET /api/v1/engines             List engines
GET /api/v1/engines/{id}
GET /api/v1/franchises          List franchises
GET /api/v1/franchises/{id}
GET /api/v1/genres              List genres
GET /api/v1/genres/{id}
GET /api/v1/modes               List modes
GET /api/v1/modes/{id}
GET /api/v1/perspectives        List perspectives
GET /api/v1/perspectives/{id}
GET /api/v1/platforms           List platforms
GET /api/v1/platforms/{id}
GET /api/v1/regions             List regions
GET /api/v1/regions/{id}
GET /api/v1/themes              List themes
GET /api/v1/themes/{id}
```

### User Socials

```
GET  /api/v1/users/{user_id}/socials   List user's linked socials
POST /api/v1/users/{user_id}/socials   Link a social account

GET    /api/v1/user_socials/{id}       Show social link
PATCH  /api/v1/user_socials/{id}      Update social link
DELETE /api/v1/user_socials/{id}      Delete social link

GET  /api/v1/social_platforms          List social platforms
POST /api/v1/social_platforms          Create/upsert a social platform
```

### Search Synonyms

```
GET  /api/v1/search_synonyms            List synonym terms
POST /api/v1/search_synonyms            Create synonym term
GET    /api/v1/search_synonyms/{id}
PATCH  /api/v1/search_synonyms/{id}
DELETE /api/v1/search_synonyms/{id}

GET  /api/v1/search_synonym_groups      List synonym groups
POST /api/v1/search_synonym_groups      Create synonym group
GET    /api/v1/search_synonym_groups/{id}
PATCH  /api/v1/search_synonym_groups/{id}
DELETE /api/v1/search_synonym_groups/{id}

GET  /api/v1/search_synonym_drafts      List synonym drafts
POST /api/v1/search_synonym_drafts      Create synonym draft
GET    /api/v1/search_synonym_drafts/{id}
PATCH  /api/v1/search_synonym_drafts/{id}
DELETE /api/v1/search_synonym_drafts/{id}
```

### RSS Feeds

```
GET  /api/v1/rss_feeds          List RSS feeds
POST /api/v1/rss_feeds          Create RSS feed
GET    /api/v1/rss_feeds/{id}
PATCH  /api/v1/rss_feeds/{id}
DELETE /api/v1/rss_feeds/{id}
```

---

## Source references

- Swagger spec: `swagger/v1/swagger.yaml` in https://github.com/TheRPGClub/TheRPGClub
- Live Swagger UI: https://therpgclub.fly.dev/api-docs/index.html
- Bot client: `src/services/RpgClubApiClient.ts`
