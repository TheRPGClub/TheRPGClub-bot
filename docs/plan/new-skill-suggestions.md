# New Skill Suggestions

Generated 2026-06-10. Based on a scan of the repo structure, existing `.claude/skills/`, and
recurring workflow patterns in `src/`, `docs/`, and `CLAUDE.md`.

---

## Priority 1 -- High-frequency, clear spec

### `new-command`

**Trigger:** "new command", "scaffold command", "add slash command"

**What it does:** Scaffolds a new DiscordX slash command.

**Why it matters:** Commands require the right decorator order (`@Discord`, `@Slash` or
`@SlashGroup`), safe interaction helpers (`safeDeferReply`, `safeReply`), `.js` ESM imports,
and a barrel export. Getting any of these wrong is a silent runtime failure or lint error.
Manual scaffolding is error-prone and slow.

**Steps it would encode:**
1. Accept command name (kebab-case) and description.
2. Create `src/commands/<name>/` directory and `<name>.command.ts` with correct decorator
   boilerplate, DiscordX imports, and an interaction handler stub.
3. Create or update the barrel `src/commands/<name>.command.ts` with the export.
4. Run `npx tsc --noEmit` to confirm no type errors.
5. Report file paths created.

---

### `new-service`

**Trigger:** "new service", "scaffold service", "create service"

**What it does:** Scaffolds a new service class in `src/services/`.

**Why it matters:** Services follow a consistent pattern (singleton or static, optional interval
timer, channel imports from `src/config/channels.ts`, `logError`/`logWarn` from LogUtils).
Missing the pattern leads to inconsistent error handling and inline channel IDs.

**Steps it would encode:**
1. Accept service name (PascalCase) and a short description.
2. Create `src/services/<ServiceName>.ts` with class stub, correct imports, and a
   `// TODO: implement` placeholder.
3. Run `npx tsc --noEmit` to confirm it compiles.
4. Report the file path.

---

### `new-sql-file`

**Trigger:** "new sql file", "scaffold sql", "add sql query file"

**What it does:** Creates a date-stamped SQL query file following the `YYYYMMDD_name` convention.

**Why it matters:** CLAUDE.md mandates `YYYYMMDD_name_format` for SQL files. Manual naming
gets the date wrong or uses the wrong format. The file also needs a standard boilerplate comment
block.

**Steps it would encode:**
1. Accept a snake_case name.
2. Derive today's date in `YYYYMMDD` format.
3. Create `src/db/sql/<YYYYMMDD>_<name>.sql` with a header comment (description, date, author
   placeholder).
4. Report the full path.

---

### `new-test`

**Trigger:** "new test", "scaffold test", "add test file"

**What it does:** Scaffolds a new test file for a module.

**Why it matters:** Tests use `node:test` + `node:assert/strict`, not Jest. Wrong imports cause
silent no-op test files. The skill ensures the runner pattern, describe/it blocks, and
`test-results.txt` output path are all correct from the start.

**Steps it would encode:**
1. Accept the target module path (e.g. `src/services/GameReleaseAnnouncementService.ts`).
2. Create `src/tests/<module-name>.test.ts` with correct `node:test` imports and a stub
   `describe` + `it` block.
3. Run `npm test` to confirm the new file is picked up and passes (with 0 assertions initially).
4. Report the file path and test count delta.

---

## Priority 2 -- Recurring audits

### `config-audit`

**Trigger:** "config audit", "find hardcoded IDs", "find inline snowflakes"

**What it does:** Scans `src/` for inline channel IDs, user IDs, tag IDs, and role IDs that
should live in `src/config/`.

**Why it matters:** CLAUDE.md explicitly assigns each ID type to a dedicated config file.
Inline snowflakes (18-19 digit numeric strings in source) are a repeated source of bugs when
IDs change and are scattered across files.

**Steps it would encode:**
1. Grep `src/` for 18-19 digit numeric literals (`/\b\d{18,19}\b/`) not inside config files.
2. Categorize hits by file and line.
3. Report files + line numbers grouped by type (channel-shaped, user-shaped, etc.).
4. Optionally create one GitHub issue per non-empty category (same pattern as `component-audit`).

---

### `dead-code-audit`

**Trigger:** "dead code audit", "find unused exports", "what's unused"

**What it does:** Identifies exported symbols in `src/` that are never imported anywhere else.

**Why it matters:** There is already a `docs/decisions/dead_code_catalog.md`, indicating this
is a recurring manual effort. Automating the grep + cross-reference step saves time and catches
new dead code as features are removed.

**Steps it would encode:**
1. Extract all `export` names from `src/**/*.ts`.
2. For each name, grep for imports across `src/`.
3. Report names that have zero import hits (excluding their own definition file).
4. Write findings to `docs/decisions/dead_code_catalog.md` (append or overwrite with date).

---

## Priority 3 -- Operational / deployment

### `deploy`

**Trigger:** "deploy", "push to desktop", "deploy to prod"

**What it does:** SSHs to the remote desktop (`ssh merph518@192.168.50.15`) and runs the
production deploy sequence (`buildProd`: compile + pm2 restart).

**Why it matters:** The bot runs on a separate machine. The deploy sequence (`npm run buildProd`)
must be run there, not here. A skill encodes the SSH target, the right npm script, and how to
check pm2 status after deploy so there's no ambiguity about what "deploy" means.

**Steps it would encode:**
1. Confirm the current branch is `main` (or a specified branch).
2. SSH to `192.168.50.15` and run `npm run buildProd` in the repo directory.
3. Run `ssh merph518@192.168.50.15 "pm2 status RPGClub_GameDB"` and report the result.
4. Report success or surface the error output.

**Caveat:** Requires the desktop to be reachable from this machine at time of invocation.

---

### `babysit-prs`

**Trigger:** "check PRs", "babysit PRs", "what's the state of open PRs"

**What it does:** Lists all open PRs, their CI status, review state, and whether they are
blocked or ready to merge.

**Why it matters:** With multiple feature branches in flight, it is easy to lose track of which
PRs are stale, which are failing CI, and which just need a review. This skill gives a one-shot
status board.

**Steps it would encode:**
1. `gh pr list --state open --json number,title,statusCheckRollup,reviewDecision,isDraft`
2. For each PR: report number, title, CI pass/fail, review status, draft state.
3. Flag PRs that are: failing CI, stale (no activity in 3+ days), or missing closing-issue
   linkage (`gh pr view <N> --json closingIssuesReferences`).

---

## Priority 4 -- Nice to have

### `close-issue`

**Trigger:** "close issue", "won't fix", "mark issue as duplicate"

**What it does:** Closes a GitHub issue with a well-formed comment explaining the reason
(won't fix, duplicate of #N, already resolved by PR #N, etc.).

**Why it matters:** `create-issue` exists but there is no counterpart for closing with context.
Closing without a comment leaves no record of the decision. A skill prompts for the reason and
picks the right close reason label.

**Steps it would encode:**
1. Accept issue number and reason (won't-fix | duplicate | resolved | out-of-scope).
2. Post a closing comment via `gh issue comment`.
3. Close with `gh issue close --reason <reason>`.
4. Confirm closure with `gh issue view`.

---

### `new-event`

**Trigger:** "new event handler", "scaffold event", "add discord event"

**What it does:** Scaffolds a new Discord event handler in `src/events/`.

**Why it matters:** Event handlers use a different DiscordX decorator (`@On` or `@Once`) and
follow a slightly different file pattern than commands. Getting the decorator or event name
wrong causes silent failures (the handler simply never fires).

**Steps it would encode:**
1. Accept event name (e.g. `messageCreate`, `guildMemberUpdate`) and handler class name.
2. Create `src/events/<EventName>.command.ts` with `@Discord`, `@On("<eventName>")`, and the
   correct Discord.js event parameter type.
3. Run `npx tsc --noEmit`.
4. Report the file path.

---

## Summary table

| Skill | Priority | Effort to build | Key CLAUDE.md rule it enforces |
|---|---|---|---|
| `new-command` | 1 | Medium | DiscordX patterns, safe interaction helpers |
| `new-service` | 1 | Low | Config imports, LogUtils |
| `new-sql-file` | 1 | Low | YYYYMMDD naming convention |
| `new-test` | 1 | Low | node:test runner pattern |
| `config-audit` | 2 | Medium | IDs belong in config files |
| `dead-code-audit` | 2 | Medium | Ongoing cleanup |
| `deploy` | 3 | Low | Remote desktop deploy |
| `babysit-prs` | 3 | Low | Closing-issue linkage check |
| `close-issue` | 4 | Low | Counterpart to create-issue |
| `new-event` | 4 | Low | DiscordX @On decorator |
