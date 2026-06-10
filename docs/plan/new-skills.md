# Suggested New Claude Code Skills

Five skills identified from codebase scan, ordered by impact.

## 1. `open-pr`

**Problem:** CLAUDE.md mandates a specific PR ceremony: run lint and fix violations,
ensure separate `Closes #X` lines per issue (not comma-separated), open the PR, then
verify closing-issue linkage with `gh pr view <N> --json closingIssuesReferences`.
Multi-step flow that is easy to get wrong.

**Skill would:**
- Run `npm run lint` and report or auto-fix violations
- Accept issue numbers to close
- Build the PR body with one `Closes #X` per line
- Run `gh pr create` with the formatted body
- Run `gh pr view <N> --json closingIssuesReferences` and report linkage status

**Trigger phrases:** "open a PR", "create PR", "submit PR for issue #N"

---

## 2. `new-branch`

**Problem:** CLAUDE.md requires every coding task to start with pull main then open a
fresh branch. Easy to skip during conversation flow.

**Skill would:**
- `git checkout main && git pull`
- `git checkout -b <branch-name>` (accept name as arg or derive from issue/description)
- Confirm the branch is clean and ready

**Trigger phrases:** "start a branch", "begin work on", "create branch for issue #N"

---

## 3. `sql-extract`

**Problem:** A major in-flight migration (`SQL_MIGRATION_PLAN.md`) extracts inline SQL
from domain class files (Game.ts, Member.ts, etc.) into the `SqlManager` registry with
Oracle + PostgreSQL dialect variants. This is repetitive, pattern-driven work.

**Skill would:**
- Accept a class file path as input
- Identify inline SQL strings in the file
- Generate `SqlEntry` objects with `.oracle` and `.postgres` fields following the
  SqlManager pattern
- Output extracted entries ready to paste into the registry, plus replacement call-sites

**Trigger phrases:** "extract SQL from", "migrate SQL in", "sql-extract"

**Key files:** `src/db/SqlManager.ts`, `SQL_MIGRATION_PLAN.md`, `src/db/sql/`

---

## 4. `new-lint-rule`

**Problem:** CLAUDE.md says "assess if a custom lint rule would be useful" for every
reported error. Custom rules live in `eslint-rules/`. Scaffolding a new rule currently
requires manually copying boilerplate.

**Skill would:**
- Accept a rule name and description
- Scaffold the rule file in `eslint-rules/` with proper TypeScript structure
- Register the rule in `eslint.config.ts`
- Run `npm run lint` to verify the rule loads without errors

**Trigger phrases:** "create a lint rule", "new eslint rule", "scaffold lint rule"

**Key files:** `eslint-rules/`, `eslint.config.ts`

---

## 5. `component-audit`

**Problem:** An ongoing standardization pass is replacing raw component builders with
shared helpers (`buildTextContainer`, `buildContainerSend`, etc.) and raw
`COMPONENTS_V2_FLAG` usage. No skill exists to find remaining violations.

**Skill would:**
- Grep `src/` for raw `COMPONENTS_V2_FLAG`, inline `ActionRowBuilder`,
  `ContainerBuilder`, etc. that should use the shared helpers
- Report files + line numbers still needing migration
- Optionally triage by file size or command area

**Trigger phrases:** "component audit", "find raw component builders",
"what's left to standardize"

**Key files:** `src/functions/`, `docs/plan/`
