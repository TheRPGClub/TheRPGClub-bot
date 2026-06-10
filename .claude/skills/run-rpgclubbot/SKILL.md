---
name: run-rpgclubbot
description: Run, test, type-check, lint, or start the RPGClub GameDB Discord bot. Use when asked to run the bot, verify changes, take a smoke test, run tests, check types, or invoke a module directly.
---

RPGClub GameDB Bot is a Discord bot (TypeScript, Discord.js v14, DiscordX, Oracle DB). It cannot connect to Discord or Oracle in this dev container — the live bot runs on the desktop. The agent harness is `smoke.sh`, which runs type-check + lint + the full test suite without any credentials.

## Prerequisites

Node.js and all npm dependencies must be installed:

```bash
npm install
```

## Run (agent path)

Driver: `.claude/skills/run-rpgclubbot/smoke.sh`

All paths are relative to the repo root.

### Full smoke check (type-check + lint + tests)

```bash
bash .claude/skills/run-rpgclubbot/smoke.sh
```

Output ends with:
```
# tests 53
# pass 53
# fail 0
```

### Direct module invocation

For quickly probing a function after a code change, without running the full suite:

```bash
bash .claude/skills/run-rpgclubbot/smoke.sh --invoke \
  "import { buildTextContainer } from './src/functions/ComponentsV2Utils.js'; console.log(JSON.stringify(buildTextContainer('test').toJSON()));"
```

Uses `node --no-warnings=ExperimentalWarning --loader ts-node/esm/transpile-only -e <snippet>`. Import paths must use `.js` extensions (ESM). Only modules that don't touch Oracle or Discord can be invoked this way.

### Type-check only

```bash
npx tsc --noEmit
```

### Lint only

```bash
npm run lint
```

### Tests only

```bash
npm test
```

Results written to `test-results.txt`.

## Run (human / bot path)

The bot requires Oracle DB + `BOT_TOKEN`. On the desktop with those available:

```bash
npm run dev
```

Without Oracle it crashes immediately:
```
Error: NJS-503: connection to host 127.0.0.1 port 1521 could not be established
```

This is expected in the dev container. The bot is not the primary verification path — tests are.

## What the tests cover

53 tests across 15 files. They exercise component builders, command utilities, pagination, date parsing, interaction helpers, nomination logic, and modal serialization — all without requiring Oracle or Discord. Tests that need IGDB credentials silently skip the live-API path.

## Gotchas

- **`.js` extensions required in `--invoke` imports.** TypeScript source files are loaded via ts-node ESM, but imports still need `.js` not `.ts`.
- **`dotenv/config` is auto-loaded** by the entrypoint but not by individual modules. If a module you're invoking reads `process.env`, values from `.env` won't be present unless you `import 'dotenv/config'` first in the snippet.
- **Oracle crashes immediately** on `npm run dev` in this container — port 1521 is not running. This is normal; it only runs on the desktop.
- **Test log noise is expected.** Lines like `{"context":"IgdbService","error":"IGDB_CLIENT_ID or IGDB_CLIENT_SECRET not configured"}` appear during tests and are not failures.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module` in `--invoke` | Use `.js` extension in the import path |
| `NJS-503` on `npm run dev` | Oracle not running here; use `npm test` instead |
| Lint errors after code change | Run `npm run lint` to see violations; fix before opening PR |
| Type errors | Run `npx tsc --noEmit` for full diagnostics |
