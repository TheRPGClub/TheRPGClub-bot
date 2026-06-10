---
name: component-audit
description: Grep src/ for raw component builder patterns that should use shared helpers, report files + line numbers still needing migration, and create one labeled GitHub issue per non-empty category. Use when asked to "component audit", "find raw component builders", or "what's left to standardize".
---

This skill audits `src/` for component builder patterns that have shared-helper replacements.
It does NOT make changes to source code -- it produces a prioritized report and creates one
GitHub issue per non-empty audit category (labeled "refactor") so each category is tracked.

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

### 7. Create GitHub issues

After producing the report, create one GitHub issue per non-empty category using
`gh issue create --label "refactor"`. Skip any category with zero hits. Use the
titles and body templates below exactly -- substitute `N` / `M` and the file lists
from the grep results.

**EmbedBuilder interactive replies** (if > 0 interactive hits):
```
Title: Migrate raw EmbedBuilder to v2 container helpers (interactive replies)
Body:
## Summary
N interactive-reply sites still use `new EmbedBuilder()` instead of the shared v2 helpers.

Replacement targets:
- `buildAccentContainer` -- color accent + body text
- `buildTitledContainer` -- title + body + optional footer/color
- Custom `ContainerBuilder` chain for complex layouts

## Files (N hits in M files)
<list each file:line from grep results>

## Related helpers
- `src/functions/ComponentsV2Utils.ts` -- `buildAccentContainer`, `buildTitledContainer`
```

**EmbedBuilder log-channel embeds** (if > 0 event hits):
```
Title: Migrate log-channel EmbedBuilder to v2 containers (low priority)
Body:
## Summary
N event/log files still use `new EmbedBuilder()` to post to audit and log channels.
Migrate after interactive-reply sites are done.

Replacement: `buildAccentContainer` or `buildTitledContainer` from
`src/functions/ComponentsV2Utils.ts`.

## Files (N hits in M files)
<list each file:line from grep results>
```

**ButtonBuilder** (if > 0 hits):
```
Title: Migrate raw ButtonBuilder chains to buildActionButton helper
Body:
## Summary
N sites use `new ButtonBuilder()` directly outside `src/functions/uiComponents.ts`.

Replacement: `buildActionButton` from `src/functions/uiComponents.ts`.

## Files
<list each file:line>
```

**ActionRowBuilder\<ButtonBuilder\>** (if > 0 hits):
```
Title: Migrate raw ActionRowBuilder<ButtonBuilder> to buildButtonRow helper
Body:
## Summary
N sites inline `new ActionRowBuilder<ButtonBuilder>()`.

Replacement: `buildButtonRow` from `src/functions/uiComponents.ts`.

## Files
<list each file:line>
```

**ActionRowBuilder\<StringSelectMenuBuilder\>** (if > 0 hits):
```
Title: Standardize ActionRowBuilder<StringSelectMenuBuilder> with a shared buildSelectRow helper
Body:
## Summary
N sites inline `new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)`.
A generic `buildSelectRow(select)` helper in `src/functions/uiComponents.ts` would
eliminate this repetition.

Note: `buildJournalSelectRow` already exists for the journal-specific pattern and
should remain.

## Files (N hits across M files)
<list top files with hit counts, then full file:line list>
```

**ContainerBuilder / TextDisplayBuilder simple cases** (if > 0 simple candidates):
```
Title: Migrate simple ContainerBuilder/TextDisplayBuilder patterns to buildTextContainer
Body:
## Summary
N files use raw `new ContainerBuilder()` with one or two `TextDisplayBuilder` lines
-- simple enough to replace with `buildTextContainer`.
Complex multi-section layouts should stay as-is.

## Simple candidates
<list each file:line>

## Helper
`buildTextContainer(content, accentColor?)` -- `src/functions/ComponentsV2Utils.ts`
```

After creating all issues, print a summary table:

```
## Issues created
- #NNN -- Migrate raw EmbedBuilder ... (interactive)
- #NNN -- Migrate log-channel EmbedBuilder ...
- #NNN -- Migrate raw ButtonBuilder ...
...
```

### 8. Optional triage flag: `--by-file`

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
