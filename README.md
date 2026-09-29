# RPGClub GameDB Bot

RPG Club is a Discord community centered on playing and discussing games together.
GameDB is the community's shared game catalog: a searchable database of titles
(backed by IGDB metadata) that members use to track what they own, what they're
playing, and what they've finished. This bot is the interface to GameDB and to
the community's monthly voting cycle, plus a set of member and moderation
utilities. It is built with TypeScript, Discord.js v14, and DiscordX, with an
API-backed data model and IGDB integration for game metadata.

## What It Does

- GameDB search, import, and viewing with IGDB data
- Game of the Month (GOTM) and Non-Round GOTM (NR-GOTM) nominations, voting
  rounds, and history. Each month members nominate and vote on games to play
  together; GOTM is the main voting track and NR-GOTM is a secondary track for
  titles outside the elimination rounds.
- Member profiles, Now Playing, and game completion tracking with CSV imports
- Personal game collections with Steam imports for collection entries
- Reminders, RSS relays, public reminders, and giveaway tools
- GitHub issue management via bot commands

## Tech Stack

- Node.js with TypeScript and ESM
- Discord.js v14 and DiscordX
- IGDB API integration for metadata
- GitHub App integration for issue workflows

## Command Overview

Use `/help` in Discord for full syntax and parameters. Major command groups include:

- Monthly games: `/nominate`, `/noms`, `/round`, `/round-history`
- GameDB: `/gamedb`, `/collection`, `/now-playing`, `/game-completion`, `/game-journal`, `/create-thread`
- Members: `/profile`, `/mp-info`
- Utilities: `/hltb`, `/gamegiveaway`, `/avatar-history`, `/timestamp`
- Admin tools: `/mod`, `/admin`, `/superadmin`, `/todo`, `/publicreminder`, `/rss`, `/suggestion`,
  `/generate-vote-image`, `/moderator`
- Regulars tools: `/thread`

## Local Development

1. Install dependencies.
2. Provide required environment variables.
3. Run the bot in dev mode.

```bash
npm install
npm run dev
```

The entrypoint is `src/RPGClub_GameDB.ts`, and the compiled output is `build/RPGClub_GameDB.js`.

## Environment Variables

These are required or commonly used by the bot. Values depend on your deployment.

- `BOT_TOKEN`
- `IGDB_CLIENT_ID`
- `IGDB_CLIENT_SECRET`
- `IGDB_SCAN_ENABLED`
- `IGDB_SCAN_BATCH_SIZE`
- `IGDB_SCAN_MIN_AGE_DAYS`
- `IGDB_SCAN_THROTTLE_MS`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_APP_ID`
- `GITHUB_APP_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `BACKBLAZE_B2_KEY_ID`
- `BACKBLAZE_B2_APPLICATION_KEY`
- `BACKBLAZE_B2_BUCKET_ID`
- `BACKBLAZE_B2_BUCKET_NAME`
- `TEST_GUILD_ID`

### Test guild mode

Setting `TEST_GUILD_ID` to a guild snowflake puts the bot in test mode. Its
presence is the only flag: the ID constants in `src/config/channels.ts`,
`roles.ts`, `users.ts`, and `tags.ts` resolve through `src/config/testMode.ts`
and substitute the values in `src/config/testGuild.ts`, and slash commands
register to that guild instead of globally so they appear immediately.

The bot refuses to boot if any ID lacks a test guild override, naming the ones
that are missing. Leaving `TEST_GUILD_ID` unset keeps production behavior
unchanged.

In test mode every ephemeral reply is also serialized and posted to
`TEST_LOG_CHANNEL_ID`, so a second bot or a human reading scrollback can verify
output that is otherwise visible only to the invoking user. The mirror is
best-effort and never affects the real reply. Keep that channel restricted:
mirrored payloads can contain data that was ephemeral for a reason.

Test mode does not redirect external services. `RPGCLUB_API_BASE_URL`,
Backblaze, and GitHub issues all use the same configuration they use in
production, so point them at staging values yourself if you do not want a test
run touching them.

## Useful Scripts

- `npm run dev` - Run the bot with tsx.
- `npm run build` - Build the TypeScript output.
- `npm run compile` - Type check without emitting.
- `npm run lint` - Run Oxlint.
- `npm run watch` - Run dev mode with file watching.
- `npm run start` - Run compiled output.
- `npm run start:prod` - Run compiled output with pm2.
- `npm run buildProd` - Build and restart or start pm2.
- `npm run import:igdb-platforms` - Sync IGDB platforms into GameDB.
- `npm run session:start` - Run session startup tasks.
- `npm run backup:docker-volumes` - Backup docker volumes.

## Configuration

Discord channel IDs, user IDs, and tags are centralized in `src/config/`. Update those files to match your server.

## Dependency Deprecation Warnings

`npm ci` prints two deprecation warnings that cannot be fixed from this repo. Both come from
transitive dependencies of actively maintained packages:

- `whatwg-encoding@3.1.1` via `cheerio` -> `encoding-sniffer@0.2.1`. `encoding-sniffer@1.x` drops it
  in favour of `@exodus/bytes`, but `cheerio@1.2.0` (latest) still pins `^0.2.1`. Forcing the major
  bump through an override is not safe, so wait for upstream.
- `node-domexception@1.0.0` via `googleapis` -> `gaxios` -> `node-fetch@3.3.2`. `gaxios@8.0.0` still
  depends on `node-fetch`, so there is nothing to bump to yet.

The rest are handled: `exceljs` was replaced by `write-excel-file`, and `package.json` `overrides`
pin `@discordx/importer`'s `glob` and `gaxios`'s `rimraf` to current majors. Re-check both remaining
warnings on the next dependency bump.

## Notes

- The bot expects a prebuilt `build/` folder for production runs. Do not delete the `build/` directory.
- Slash command help content is implemented in `src/commands/help.command.ts`.
