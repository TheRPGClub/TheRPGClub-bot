---
name: component-audit
description: Grep src/ for raw component builder patterns that should use shared helpers and report files + line numbers still needing migration. Use when asked to "component audit", "find raw component builders", or "what's left to standardize".
---

This skill audits `src/` for component builder patterns that have shared-helper replacements.
It does NOT make changes -- it produces a prioritized report so you can decide what to migrate.

## Background

Ongoing standardization passes replace raw builder chains with helpers from two files:

- `src/functions/ComponentsV2Utils.ts` -- v2 container factories
  (`buildTextContainer`, `buildTextReply`, `buildTextSend`, `buildContainerSend`,
  `buildAccentContainer`, `buildTitledContainer`, `buildFieldsText`,
  `buildComponentsV2Flags`, `buildComponentsV2EditFlags`, `hasComponentsV2Flag`,
  `safeV2TextContent`)

- `src/functions/uiComponents.ts` -- action-row and button factories
  (`buildButtonRow`, `buildActionButton`, `buildTextInputRow`, `buildSelectOptions`,
  `buildJournalSelectRow`, `buildTitleHeaderContainer`, `buildUserHeaderContainer`)

## Steps (always run in order)

Run each grep, collect the results, then produce the consolidated report in step 6.

### 1. Raw `EmbedBuilder` usage (highest priority)

`EmbedBuilder` should be replaced with `buildAccentContainer` (color + body),
`buildTitledContainer` (title + body + optional footer/color), or a custom
`ContainerBuilder` chain for complex layouts.

```bash
grep -rn "new EmbedBuilder" src/ --include="*.ts"
```

### 2. Raw `ButtonBuilder` outside helpers

`new ButtonBuilder()` chains should use `buildActionButton` from `uiComponents.ts`.
Ignore hits inside `src/functions/uiComponents.ts` itself.

```bash
grep -rn "new ButtonBuilder" src/ --include="*.ts" | grep -v "src/functions/uiComponents"
```

### 3. Raw `ActionRowBuilder<ButtonBuilder>` outside helpers

`new ActionRowBuilder<ButtonBuilder>` should use `buildButtonRow` from `uiComponents.ts`.
Ignore hits inside `src/functions/uiComponents.ts`.

```bash
grep -rn "new ActionRowBuilder<ButtonBuilder>" src/ --include="*.ts" \
  | grep -v "src/functions/uiComponents"
```

### 4. Raw `ActionRowBuilder<StringSelectMenuBuilder>` outside helpers

`new ActionRowBuilder<StringSelectMenuBuilder>` may use `buildJournalSelectRow` if the
pattern fits, or needs a new shared helper. Flag each site for review.
Ignore hits inside `src/functions/uiComponents.ts`.

```bash
grep -rn "new ActionRowBuilder<StringSelectMenuBuilder>" src/ --include="*.ts" \
  | grep -v "src/functions/uiComponents"
```

### 5. Inline `ContainerBuilder` / `TextDisplayBuilder` outside helpers

Raw `new ContainerBuilder()` or `new TextDisplayBuilder()` outside the helper files may be
candidates for `buildTextContainer`, `buildAccentContainer`, or `buildTitledContainer`.
Complex custom layouts (multi-section, gallery, thumbnail) are intentional and should be
noted but not flagged as violations.

```bash
grep -rn "new ContainerBuilder\|new TextDisplayBuilder" src/ --include="*.ts" \
  | grep -v "src/functions/ComponentsV2Utils\|src/functions/uiComponents"
```

### 6. Produce the consolidated report

Format the report as follows. For each category, list the file:line hits and the
recommended replacement. Skip any category that returned zero results.

```
## Component Audit Report -- <today's date>

### EmbedBuilder (N hits in M files)
Replacement: buildAccentContainer / buildTitledContainer / custom ContainerBuilder
<file>:<line>  <snippet>
...

### ButtonBuilder outside helpers (N hits)
Replacement: buildActionButton (src/functions/uiComponents.ts)
<file>:<line>  <snippet>
...

### ActionRowBuilder<ButtonBuilder> outside helpers (N hits)
Replacement: buildButtonRow (src/functions/uiComponents.ts)
<file>:<line>  <snippet>
...

### ActionRowBuilder<StringSelectMenuBuilder> outside helpers (N hits)
Replacement: buildJournalSelectRow if applicable; otherwise new shared helper needed
<file>:<line>  <snippet>
...

### Inline ContainerBuilder / TextDisplayBuilder outside helpers (N hits in M files)
Replacement: buildTextContainer for simple text; leave complex layouts as-is
<file>:<line>  <snippet>
...

---
Total: N hits across M files
Priority order: EmbedBuilder > ButtonBuilder > ActionRowBuilder<Button> > rest
```

### 7. Optional triage flag: `--by-file`

If the user passes `--by-file`, group all hits by file instead of by category, sorted
descending by hit count per file. This helps identify which single file would give the
most cleanup bang per PR.

```bash
grep -rn "new EmbedBuilder\|new ButtonBuilder\|new ActionRowBuilder\|new ContainerBuilder\
\|new TextDisplayBuilder" src/ --include="*.ts" \
  | grep -v "src/functions/ComponentsV2Utils\|src/functions/uiComponents" \
  | cut -d: -f1 | sort | uniq -c | sort -rn | head -20
```

## What NOT to flag

- Anything inside `src/functions/ComponentsV2Utils.ts` or `src/functions/uiComponents.ts`
  -- those ARE the shared helpers.
- `new ActionRowBuilder<ModalActionRowComponentBuilder>` -- used for modal text-input rows;
  has its own helper (`buildTextInputRow`). Flag only if not using the helper.
- `new MediaGalleryBuilder`, `new SectionBuilder`, `new SeparatorBuilder`,
  `new ThumbnailBuilder` -- no shared helper exists yet; note them as "no helper" rather
  than flagging as violations.
- Event files in `src/events/` that use `EmbedBuilder` for audit/log embeds -- these are
  intentional v1 embeds sent to log channels, not interactive reply payloads. Note them
  separately under a "Log channel embeds (low priority)" section rather than mixing them
  with interactive-reply violations.

## Key reference files

- `src/functions/ComponentsV2Utils.ts` -- all v2 container factory helpers
- `src/functions/uiComponents.ts` -- button row, select row, and header factories
- `docs/plan/discord-v2-components-pass-1.md` -- migration plan and work items
- `docs/plan/shared-utilities-standardization-pass-8.md` -- standardization backlog
