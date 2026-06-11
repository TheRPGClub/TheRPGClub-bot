---
name: refactor-largest-file
description: Scan src/ for the largest TypeScript file, analyze its structure, and produce a prioritized refactor plan that extracts general helpers first. Use when asked to "refactor the largest file", "find the biggest file", "what should we split up", or "propose a refactor plan".
---

This skill finds the largest file in `src/`, reads it carefully, and produces a concrete
refactor plan. It does NOT write code -- it produces a plan and optionally opens a GitHub issue.

Priority order for extraction:
1. General-purpose helpers (pure functions, shared utilities, type guards)
2. Domain helpers scoped to a single concern (e.g., formatting, validation for one entity)
3. Sub-features that are large enough to stand alone as a module
4. The remaining "orchestration" shell that stays in the original file

## Steps (always run in order)

### 1. Find the largest file in src/

```bash
find src/ -name "*.ts" -not -path "*/node_modules/*" \
  | xargs wc -l 2>/dev/null \
  | sort -rn \
  | grep -v " total$" \
  | head -20
```

Print the top 10 results so the user can see the landscape. Identify the single largest file
(most lines). Skip `*.d.ts` files -- they are generated declarations, not source.

If the largest file is already a known helper/utility file (e.g. `ComponentsV2Utils.ts`,
`uiComponents.ts`), note that but still analyze it; helper files can also grow too large.

### 2. Read the file in chunks

Do NOT read the entire file at once if it is over 300 lines. Instead:

a. Read lines 1-100 to understand imports and top-level structure.
b. Use grep to locate function/class/const declarations:
   ```bash
   grep -n "^export\|^const\|^function\|^class\|^async function\|^interface\|^type " <file>
   ```
c. Group declarations into logical clusters based on naming and what they import/use.
d. Read a representative sample (50-100 lines) of the largest clusters to understand complexity.

### 3. Categorize every exported symbol

For each export in the file, assign one of these categories:

- **general-helper**: Pure function or utility with no dependency on a specific command's
  business logic. Could live in a shared `src/functions/` file.
- **domain-helper**: Pure-ish function scoped to one domain (e.g., character formatting,
  journal validation). Could move to a dedicated `src/functions/<domain>Utils.ts`.
- **sub-feature**: A self-contained interaction flow (e.g., a modal handler, a sub-command
  implementation). Could move to its own file under `src/commands/<name>/` or
  `src/functions/<name>/`.
- **orchestration**: The top-level handler/router that wires everything together.
  Stays in the original file (or becomes a thin index).
- **type/interface**: Could move to `src/types/` or a co-located types file.

### 4. Produce the refactor plan

Format the plan exactly as shown below. Substitute real symbol names and line numbers.

```
## Refactor Plan: <filename> (<N> lines)

### Overview
<2-3 sentence description of what the file does and why it grew large>

### Extraction targets (priority order)

#### 1. General helpers -> <suggested destination file>
These can be extracted with zero risk of behavioral change.

- `functionName` (line N-M): <one-line description of what it does and why it's general>
- ...

#### 2. Domain helpers -> <suggested destination file>
Scoped to <domain>, but reusable across commands in that domain.

- `functionName` (line N-M): <description>
- ...

#### 3. Sub-features -> <suggested destination file(s)>
Self-contained flows that could live in their own module.

- `functionName` (line N-M): <description>
  Dependencies: <list any symbols it pulls from the same file>
- ...

#### 4. Types/interfaces -> <suggested destination>
- `TypeName` (line N): <description>

#### 5. Remaining orchestration shell
After extraction, `<original file>` would contain:
- <list what stays>
- Estimated remaining size: ~N lines

### Suggested extraction order
1. Extract general helpers first (lowest risk, highest reuse value)
2. Extract domain helpers
3. Extract sub-features (after helpers so they can import from the new helper files)
4. Shrink original file to orchestration shell

### Risks and notes
- <any circular dependency risks>
- <any symbols that are tricky to move because they are referenced from many places>
- <any re-exports needed for backwards compatibility -- note: add only if truly necessary>
```

### 5. Check for existing issues

Before optionally creating a new issue, check if a refactor issue already exists for this file:

```bash
gh issue list --label refactor --state open --limit 50 --json number,title \
  | jq '.[] | select(.title | test("<filename>"; "i"))'
```

If one exists, mention it in the plan output: "See existing issue #N."

### 6. Optional: create a GitHub issue

If the user confirms they want to track this (or passes `--issue`), create one issue
summarizing the plan:

```bash
gh issue create \
  --label refactor \
  --title "Refactor: split <filename> (<N> lines) into focused modules" \
  --body "$(cat <<'EOF'
## Summary
<filename> is the largest file in src/ at N lines. It mixes general helpers, domain logic,
and orchestration. Splitting it will improve readability and enable targeted refactors.

## Extraction plan (priority order)

### 1. General helpers -> <destination>
<bullet list>

### 2. Domain helpers -> <destination>
<bullet list>

### 3. Sub-features -> <destination>
<bullet list>

### 4. Remaining orchestration shell
~N lines after extraction.

## Suggested order
1. General helpers (lowest risk)
2. Domain helpers
3. Sub-features
4. Shrink original file

## Notes
<risks, circular deps, any existing related issues>
EOF
)"
```

Print the issue URL when done.

## What NOT to do

- Do NOT read every line of large files -- use grep + targeted ranges.
- Do NOT propose extracting something that is only used once and is tightly coupled to
  the orchestration flow -- it adds indirection without value.
- Do NOT propose creating a new helper file if a suitable one already exists in
  `src/functions/` (check first with `ls src/functions/`).
- Do NOT write any code -- this skill produces a plan only.
- Do NOT suggest a split that would produce a file smaller than ~50 lines unless it is a
  genuine standalone concern (types, constants).
