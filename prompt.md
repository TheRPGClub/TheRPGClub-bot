# Standardization Pass: Next-Pass Driver

## Step 1 -- Identify the current pass

Run:
```
ls docs/plan/shared-utilities-standardization-pass-*.md
```

The file present is the **current pass document** (e.g., `pass-7.md`). Call that
number N. The next pass is N+1.

Read the current pass document in full. Note:
- The **Context** section (what passes 1 through N shipped -- do NOT re-propose these)
- The **Work Items** section (what pass N planned to do)
- The **Prompt for Pass N+1** section at the bottom (contains a compact summary of what
  pass N actually shipped; use it verbatim as the context block in the new document)

---

## Step 2 -- Archive the current pass document

Move `docs/plan/shared-utilities-standardization-pass-N.md` to
`docs/work-completed/shared-utilities-standardization-pass-N.md`.

---

## Step 3 -- Run a fresh codebase scan

Run each grep below. Exclude `node_modules`, `build`, and `package-lock.json` from all
searches.

1.  `grep -rn "\.catch(() => {})" src/` -- safeIgnore residue
2.  `grep -rn "\.split(\":\")" src/ --include="*.ts" | grep -v CustomIdUtils` -- split residue
3.  `grep -rn "new EmbedBuilder" src/` -- count; note files with 3+ instances
4.  `grep -rn "console\.log" src/ | grep -v "scripts/\|LogUtils\|DiscordConsoleLogger\|RPGClub_GameDB\.ts"` -- unrouted log calls
5.  `grep -rn "console\.error\|console\.warn" src/ | grep -v "LogUtils\|DiscordConsoleLogger"` -- unstructured log residue
6.  `grep -rn "\.slice(0, 25)" src/` -- DISCORD_SELECT_OPTIONS_MAX residue
7.  `grep -rn "\.slice(0, 50)\b" src/` -- query truncation residue (MAX_QUERY_LENGTH)
8.  `grep -rn "\.slice(0, 256)\b" src/` -- DISCORD_EMBED_TITLE_MAX residue
9.  `grep -rn "\.slice(0, 80)\b" src/` -- DISCORD_BUTTON_LABEL_MAX residue
10. `grep -rn "ephemeralFlag\|buildComponentsV2Flags" src/` -- visibility-pattern inconsistencies
11. `grep -rn "interaction\.user\.id !== \|interaction\.user\.id ===" src/` -- owner check residue
12. `grep -rn "new ButtonBuilder" src/ | grep -v "uiComponents\|PaginationUtils\|NominationList\|build/"` -- ButtonBuilder chains not using factory
13. `grep -rn "new ActionRowBuilder<ButtonBuilder>" src/ | grep -v "uiComponents\|PaginationUtils"` -- button-row factory residue
14. `grep -rn "toLocaleString\|toLocaleDateString" src/` -- formatting residue
15. `grep -rn "isAdmin\|isModerator" src/ --include="*.ts"` -- verify single import path
16. `grep -rn "buildPrevNextButtons\|buildNavRow\|buildNavigationRow" src/` -- pagination factory coverage
17. `grep -rln "new StringSelectMenuOptionBuilder\|new SelectMenuOptionBuilder" src/` -- buildSelectOptions residue

Use the results to populate work items for pass N+1. Discard any grep whose results are
already zero (nothing to do).

---

## Step 4 -- Create the pass N+1 document

Create `docs/plan/shared-utilities-standardization-pass-{N+1}.md` using the structure
below. Order work items by ROI (lines eliminated / files touched).

### Document structure

```
# Plan: Shared Utilities & Standardization Pass {N+1}

## Context

{Paste the context block from the "Prompt for Pass N+1" section of the pass-N document,
updating it to include pass N's shipped items. Do NOT re-propose any item listed here.}

No behavior changes -- pure extraction, centralization, and consistency.

---

## Work Items (Ordered by ROI)

### {N}. {Short title} (issue #{GH_ISSUE_NUMBER})

**Problem:** {description with representative file:line examples from grep results}

**Solution:**
\`\`\`typescript
// Before
{old pattern}

// After
{new pattern}
\`\`\`

**Key files to update:** {list}

**Verification grep:**
\`\`\`
{grep command that should return zero hits when done}
\`\`\`

---

[repeat for each work item]

## What NOT to do in this pass

{List any patterns or files that look like candidates but must be excluded, with reasons.}

---

## Verification (all items)

After each work item:
1. Run \`npx tsc --noEmit\` -- must pass with zero errors.
2. Run \`npm run lint\` -- must pass with zero violations.
3. Run the item-specific verification grep listed in each section.

---

## Prompt for Pass {N+2}

> Move docs/plan/shared-utilities-standardization-pass-{N+1}.md to
> docs/work-completed/shared-utilities-standardization-pass-{N+1}.md.
>
> Then run a fresh codebase scan. Context: passes 1-{N+1} shipped everything in
> passes 1-{N} plus: {compact one-line summary of each pass-{N+1} work item with
> its issue number}. Do NOT re-propose those items. Scan for new duplication and
> standardization gaps using the same grep strategy used in prior passes. Order by ROI.
> Create docs/plan/shared-utilities-standardization-pass-{N+2}.md following the same
> document structure as all prior passes. Create one GitHub issue per work item using:
>   gh --repo mfagerstrom/RPGClub_GameDB issue create \
>     --title "refactor: <short description>" \
>     --body "<problem + solution, 3-5 sentences>" \
>     --label "refactor"
> Record each issue number next to its work item heading in the document.
```

---

## Step 5 -- Create GitHub issues

Before committing the new document, create one GitHub issue per work item:

```bash
gh --repo mfagerstrom/RPGClub_GameDB issue create \
  --title "refactor: <short description>" \
  --body "<item problem + solution summary, 3-5 sentences max>" \
  --label "refactor"
```

Record each created issue number next to its work item heading in the document
(e.g., append "(issue #NNN)" to the heading). Create all issues before committing so
the numbers are baked in.

---

## Constraints

- No behavior changes -- pure extraction, centralization, consistency.
- Lines must stay under 100 characters.
- Run `npx tsc --noEmit` and `npm run lint` after drafting to confirm no paths are broken
  before committing.
- Do not open a PR -- commit the two doc changes (archive + new plan) to a branch and
  show the file contents when done.
