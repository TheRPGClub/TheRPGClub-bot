# Claude Code Automation Recommendations

## Codebase Profile

- **Type**: TypeScript / Node.js Discord bot
- **Framework**: discord.js v14 + discordx (decorators)
- **Key Libraries**: pg (PostgreSQL), mongoose, googleapis, oracledb, luxon, ESLint (custom rules), ts-node
- **Existing automations**: context7 MCP plugin, 8 custom skills, typescript-lsp plugin

---

## MCP Servers

### GitHub MCP Server

**Why**: You use `gh` CLI extensively for issue/PR management from within skills. A native GitHub MCP
would let Claude read issue bodies, labels, and PR comments directly without shelling out to `gh`,
and could speed up your `next-refactor`, `open-pr`, and `create-issue` skills.

**Install**:
```bash
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```
Requires `GITHUB_PERSONAL_ACCESS_TOKEN` env var.

### PostgreSQL MCP Server

**Why**: The bot has a PostgreSQL backend (`pg` dependency + `src/db/postgresClient.ts`) and SQL
migration scripts dated by convention. A Postgres MCP lets Claude query live schema and data
directly -- useful for writing accurate SQL migrations and debugging query issues without guessing
column names.

**Install**:
```bash
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres postgresql://localhost/yourdb
```

---

## Skills

### `create-migration`

**Why**: You already have a dating convention for SQL files (`YYYYMMDD_name`) and a
`SQL_MIGRATION_PLAN.md`. A skill that scaffolds a new migration file with the correct name format
and registers it in the plan would prevent the recurring manual step and enforce the naming rule
automatically.

**Create**: `.claude/skills/create-migration/SKILL.md`
**Invocation**: User-only (`disable-model-invocation: true`)

### `sync-to-prod`

**Why**: You develop on laptop, deploy on desktop via pm2 (`buildProd` script uses `pm2 restart`).
A skill that SSHs to your desktop (`merph518@192.168.50.15`) and pulls + restarts the bot would
replace a multi-step manual process after every merge.

**Create**: `.claude/skills/sync-to-prod/SKILL.md`
**Invocation**: User-only (`disable-model-invocation: true`)

---

## Hooks

### PostToolUse: Auto-run type-check after editing `.ts` files

**Why**: You have a `compile` script (`tsc --noEmit`) and CLAUDE.md forbids `npm run build`.
TypeScript errors are the most common source of broken PRs -- auto-checking after every `.ts` edit
surfaces them immediately rather than at PR open time.

**Where**: `.claude/settings.json`

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "cd /home/merph518/code/RPGClub_GameDB && npx tsc --noEmit 2>&1 | tail -20"
      }]
    }]
  }
}
```

### PreToolUse: Block edits to `.env` and `build/`

**Why**: CLAUDE.md already forbids reading `.env` and editing `build/`. A hook enforces this
automatically -- no prompt, no accidental violation.

**Where**: `.claude/settings.json` (also add to `settings.local.json` for the desktop)

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "echo '$CLAUDE_TOOL_INPUT' | jq -r '.file_path // .path // \"\"' | grep -qE '(\\.env$|/build/)' && echo 'BLOCK: forbidden path' >&2 && exit 2 || true"
      }]
    }]
  }
}
```

---

## Subagents

### `discord-interaction-reviewer`

**Why**: You have strict rules about interactions: stable identifiers, restart-resume capability,
no deprecated APIs. A specialized subagent loaded with those constraints could review new
command/interaction code in parallel with implementation -- catching custom identifier issues before
PR time.

**Where**: `.claude/agents/discord-interaction-reviewer.md`

```markdown
---
name: discord-interaction-reviewer
description: Reviews Discord command and interaction code for stable identifiers, restart-resume
  patterns, deprecated API usage, and discordx decorator correctness.
---

Review the provided Discord command or interaction code against these requirements:
- All interaction custom IDs must be stable strings (no random suffixes, timestamps, or UUIDs)
- Every stateful interaction must be resumable after a bot restart
- No deprecated discord.js or discordx APIs
- Decorators follow discordx conventions (@Slash, @ButtonComponent, @SelectMenuComponent, etc.)
- Components using collectors must have explicit idle timeouts

Report each violation with file path, line number, and the specific rule broken.
```
