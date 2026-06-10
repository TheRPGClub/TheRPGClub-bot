# Claude Code Automation Recommendations (2026-06-10)

This document captures tailored Claude Code automation recommendations based on codebase analysis.
Items already implemented are noted. See also `claude-suggestions.md` for the previous round.

## Codebase Profile

- **Type**: TypeScript / Node.js Discord bot (ESM)
- **Framework**: Discord.js v14 + DiscordX (decorators)
- **Databases**: PostgreSQL (`pg`), Oracle (`oracledb`), MongoDB (`mongoose`)
- **Testing**: Node built-in test runner (15 test files)
- **Existing automations**: context7 + GitHub MCP plugins, 8 custom skills, typescript-lsp plugin,
  `discord-interaction-reviewer` subagent

---

## Hooks

### Fix: Move Prettier formatting to PostToolUse on Edit/Write

**Status**: Needs fix -- existing hook fires as `PreToolUse` on Bash (only before `npm run lint`).
It should format whenever a file is saved, not only before lint.

**Where**: `.claude/settings.local.json`

Replace the existing Prettier `PreToolUse` hook with:

```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "file=$(echo '$CLAUDE_TOOL_INPUT' | jq -r '.file_path // \"\"'); echo \"$file\" | grep -qE '\\.tsx?$' && npx prettier --write \"$file\" 2>/dev/null || true",
    "statusMessage": "Formatting..."
  }]
}
```

### New: Type-check on Edit

**Why**: `tsc --noEmit` is the mandated check command (CLAUDE.md), but nothing runs it
automatically. Catching type errors immediately after editing a `.ts` file prevents compound errors
building up across the large command/service file count.

**Where**: `settings.local.json` > `PostToolUse`

```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "file=$(echo '$CLAUDE_TOOL_INPUT' | jq -r '.file_path // \"\"'); echo \"$file\" | grep -qE '\\.tsx?$' && npx tsc --noEmit 2>&1 | tail -5 || true",
    "statusMessage": "Type checking..."
  }]
}
```

### New: Auto-run related tests on Edit

**Why**: Test files follow a naming pattern that mirrors source files (e.g.,
`gamedb-synonym.utils.test.ts` matches `gamedb-synonym.utils.ts`). Running the matched test
automatically on every edit gives instant feedback without running the full suite.

**Where**: `settings.local.json` > `PostToolUse`

```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "command",
    "command": "file=$(echo '$CLAUDE_TOOL_INPUT' | jq -r '.file_path // \"\"'); base=$(basename \"$file\" .ts); test_file=$(find src/tests -name \"${base}.test.ts\" 2>/dev/null | head -1); [ -n \"$test_file\" ] && node --no-warnings=ExperimentalWarning --loader ts-node/esm --test \"$test_file\" 2>&1 | tail -10 || true",
    "statusMessage": "Running related tests..."
  }]
}
```

---

## Skills

### New: `create-sql-migration`

**Why**: CLAUDE.md mandates `YYYYMMDD_name_format` for SQL files. This rule lives only in
documentation today with no enforcement. A skill that scaffolds the file with the correct name and
places it in `db/` prevents naming mistakes entirely.

**Create**: `.claude/skills/create-sql-migration/SKILL.md`
**Invocation**: User-only (`disable-model-invocation: true`)

```markdown
---
name: create-sql-migration
description: Scaffold a new SQL migration file with today's date prefix (YYYYMMDD_name).
  Use when creating a new DB migration or schema change script.
disable-model-invocation: true
---

## Usage
/create-sql-migration <name>

## Steps
1. Get today's date: `date +%Y%m%d`
2. Create file: `db/<YYYYMMDD>_<name>.sql`
3. Add a header comment block with date, author, and purpose placeholder
4. Open the file for editing

Naming rule from CLAUDE.md: files must start with YYYYMMDD_ prefix.
```

---

## MCP Servers

### PostgreSQL MCP (not yet added)

The `claude-suggestions.md` doc already covers this. Reproducing the install command for
convenience:

```bash
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres postgresql://localhost/yourdb
```

Use your actual connection string. Claude will not read `.env`, so configure it directly when
running this command.

---

## Subagents

### `discord-interaction-reviewer` -- Already implemented

This agent exists at `.claude/agents/discord-interaction-reviewer.md` as of the 2026-06-10 main
merge. No action needed.

### New: `discord-security-reviewer`

**Why**: The bot handles mod commands, superadmin commands, and guild-specific permissions. A
focused security subagent can audit for permission scope leaks, missing guild-only guards, and
accidental exposure of admin actions to non-privileged users.

**Create**: `.claude/agents/discord-security-reviewer.md`

```markdown
---
name: discord-security-reviewer
description: Audits Discord bot commands for permission scope leaks, missing guild-only guards,
  and admin command exposure. Invoke before opening PRs that touch command or event files.
---

Review the provided Discord.js/DiscordX command file for:
1. Missing @Guard() decorators on privileged commands
2. DefaultMemberPermissions mismatches vs actual capability
3. Commands that should be guildOnly but are not
4. Raw user input reaching a DB query without sanitization
5. Interaction handlers that do not verify the invoking user matches expected context

Report findings as a bulleted list with file:line references.
```
