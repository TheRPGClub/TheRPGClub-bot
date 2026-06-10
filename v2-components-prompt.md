# Discord v2 Components Migration: Pass Driver

## Purpose

This prompt drives a migration pass that:
1. Identifies rendering patterns that repeat across 3+ files and extracts them into shared
   helpers in `ComponentsV2Utils.ts`.
2. Replaces legacy `EmbedBuilder` / `embeds: []` patterns with v2 `ContainerBuilder`
   components.
3. Eliminates raw inline builder chains in favour of the factory utilities.

**Helper design principle:** All factory functions follow a two-layer model.

- **Building blocks** -- return a `ContainerBuilder` (or component builder). These are
  composable and live in `ComponentsV2Utils.ts`. Example: `buildTextContainer(content)`.
- **Context wrappers** -- return a ready-to-spread reply/send payload
  `{ components, flags }`. These call building blocks and wrap them with the correct
  flag. Examples: `buildTextReply(content, isEphemeral)` (interaction),
  `buildTextSend(content)` (channel send, no ephemeral param).

Infrastructure work items (adding helpers) must come before migration items in the plan,
because migration items depend on the helpers.

No behavior changes -- pure rendering consistency and factory adoption.

---

## Step 1 -- Identify the current pass

Run:
```
ls docs/plan/discord-v2-components-pass-*.md 2>/dev/null || echo "none yet"
```

If no file exists, the next pass is **pass 1**. If `pass-N.md` is present, the next
pass is N+1. Call the next pass number P.

Read the existing pass document (if any) in full. Note:
- The **Context** section (items already shipped -- do NOT re-propose these)
- The **Prompt for Pass P+1** section (use its context block verbatim in the new document)

---

## Step 2 -- Archive the current pass document (if one exists)

Move `docs/plan/discord-v2-components-pass-{P-1}.md` to
`docs/work-completed/discord-v2-components-pass-{P-1}.md`.

Skip this step if this is pass 1.

---

## Step 3 -- Run a fresh codebase scan

Run each grep below. Exclude `node_modules`, `build`, and `package-lock.json` from all
searches.

### 3a. Infrastructure gaps (helpers that should exist but do not)

First read `src/functions/ComponentsV2Utils.ts` in full to know what helpers already
exist. Then check for the following missing ones:

1.  Does `buildTextSend(content: string)` exist?
    If not, it is missing. It should return
    `{ components: [buildTextContainer(content)], flags: COMPONENTS_V2_FLAG }`.
    This is the channel-send equivalent of `buildTextReply`.

2.  Does `buildContainerSend(container: ContainerBuilder)` exist?
    If not, it is missing. It should return
    `{ components: [container], flags: COMPONENTS_V2_FLAG }`.
    This lets callers build a rich container then wrap it without touching raw flags.

3.  Does `buildAccentContainer(content: string, color: number)` exist?
    If not, it is missing. It should return a `ContainerBuilder` with
    `.setAccentColor(color)` and a single `TextDisplayBuilder`. This replaces the
    `new EmbedBuilder().setColor(...).setDescription(...)` pattern used in log events.

4.  Does `buildTitledContainer(title: string, body: string, opts?)` exist?
    If not, it is missing. It should return a `ContainerBuilder` whose text content is
    `# {title}\n{body}`, with optional `color` (setAccentColor) and `footer` (appended
    as `-# {footer}` in a second TextDisplayBuilder). This replaces the
    `new EmbedBuilder().setTitle().setDescription().setColor().setFooter()` pattern.

5.  Does `buildFieldsText(fields: { name: string; value: string }[])` exist?
    If not, it is missing. It should return a string of the form
    `**{name}**\n{value}` blocks joined by `\n\n`, for converting `.addFields()` calls
    to inline markdown text inside a `TextDisplayBuilder`.

Record which helpers are missing. Each missing helper becomes a work item.

### 3b. Raw-builder residue (patterns the above helpers should replace)

6.  `grep -rn "new ContainerBuilder\b" src/ --include="*.ts" | grep -v "build/\|ComponentsV2Utils\|DiscordConsoleLogger"` -- inline ContainerBuilder chains outside the utility
7.  `grep -rn "new TextDisplayBuilder\b" src/ --include="*.ts" | grep -v "build/\|ComponentsV2Utils\|DiscordConsoleLogger"` -- inline TextDisplayBuilder outside helpers
8.  `grep -rn "new SectionBuilder\|new ThumbnailBuilder" src/ --include="*.ts" | grep -v "build/\|DiscordConsoleLogger"` -- note files with 2+ instances as factory candidates
9.  `grep -rn "new EmbedBuilder" src/ | grep -v "build/"` -- legacy embed constructors
10. `grep -rn "embeds:\s*\[" src/ --include="*.ts" | grep -v "build/\|embeds:\s*\[\]"` -- active embed-based replies and sends
11. `grep -rn "embeds:\s*\[\]" src/ --include="*.ts" | grep -v "build/"` -- redundant empty embed clearing in v2 replies (IS_COMPONENTS_V2 flag makes this noise)
12. `grep -rn "\.addFields\b\|\.setTitle(\|\.setDescription(\|\.setFooter(\|\.setColor(" src/ --include="*.ts" | grep -v "build/"` -- EmbedBuilder method chains
13. `grep -rn "channel\.send\|logChannel\|textChannel" src/ --include="*.ts" | grep "embeds:" | grep -v "build/"` -- embed-based channel sends (non-interaction)

### 3c. Flag-usage consistency

14. `grep -rn "COMPONENTS_V2_FLAG" src/ --include="*.ts" | grep -v "ComponentsV2Utils\|DiscordConsoleLogger\|config/flags\|build/"` -- raw flag constant used outside the two legitimate consumers; should use `buildComponentsV2Flags` / `buildComponentsV2EditFlags` / `buildTextSend` / `buildContainerSend` instead

### 3d. Pattern-frequency analysis

For each file appearing 3+ times in grepped results, read a sample of its repeated
pattern and ask: is this pattern general enough to live in `ComponentsV2Utils.ts` as a
new helper, or is it specific to that file?

Use all results to populate work items for pass P. Discard any grep whose results are
already zero.

---

## Step 4 -- Create the pass P document

Create `docs/plan/discord-v2-components-pass-{P}.md` using the structure below.

**Ordering rule:** Infrastructure items (new helpers) always come first. Migration items
that depend on a new helper must list that item as a prerequisite.

### Conversion reference

| Legacy (EmbedBuilder) | v2 equivalent |
|---|---|
| `new EmbedBuilder().setDescription("D")` | `buildTextContainer("D")` |
| `.setTitle("T").setDescription("D")` | `buildTitledContainer("T", "D")` |
| `.setTitle("T").setDescription("D").setColor(C)` | `buildTitledContainer("T", "D", { color: C })` |
| `.setFooter({ text: "F" })` | pass `footer: "F"` to `buildTitledContainer`, or append `-# F` text block |
| `.addFields({ name: "N", value: "V" })` | `buildFieldsText([{ name: "N", value: "V" }])` in TextDisplayBuilder content |
| `.setColor(C)` only | `.setAccentColor(C)` on ContainerBuilder, or `buildAccentContainer(text, C)` |
| `{ embeds: [embed] }` interaction reply | `buildTextReply(content, ephemeral)` or `{ components: [container], flags: buildComponentsV2Flags(ephemeral) }` |
| `channel.send({ embeds: [embed] })` | `channel.send(buildTextSend(content))` or `channel.send(buildContainerSend(container))` |

### Document structure

```
# Plan: Discord v2 Components Migration Pass {P}

## Context

{Paste the context block from the "Prompt for Pass P+1" section of the prior document.
If this is pass 1, write: "Pass 0 (baseline): no items shipped yet."
Do NOT re-propose any item listed here.}

No behavior changes -- pure rendering consistency and factory adoption.

---

## Work Items (Ordered by ROI, infrastructure first)

### {N}. {Short title} (issue #{GH_ISSUE_NUMBER})

**Type:** Infrastructure | Migration | Cleanup
**Depends on:** {list item numbers this depends on, or "none"}

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

- Do not migrate embeds in event/log files without verifying the target channel is
  bot-controlled and accepts IS_COMPONENTS_V2.
- Do not remove EmbedBuilder from files that pass embeds to external APIs or webhooks
  not owned by this bot.
- Do not convert ButtonStyle.Link buttons -- unrelated to embed migration.
- Do not add a color/accent argument to buildTextContainer -- that helper is intentionally
  a plain text shortcut; use buildAccentContainer for colored containers.
- Lines must stay under 100 characters.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific verification grep listed in each section.

---

## Prompt for Pass {P+1}

> Move docs/plan/discord-v2-components-pass-{P}.md to
> docs/work-completed/discord-v2-components-pass-{P}.md.
>
> Then run a fresh codebase scan. Context: passes 1-{P} shipped: {compact one-line
> summary of each pass-{P} work item with its issue number}. Do NOT re-propose those
> items. Scan for v2 migration and helper-extraction gaps using the same grep strategy
> used in prior passes. Order by ROI, infrastructure first. Create
> docs/plan/discord-v2-components-pass-{P+1}.md following the same document structure
> as all prior passes. Create one GitHub issue per work item using:
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

- No behavior changes -- pure rendering consistency and factory adoption.
- Lines must stay under 100 characters.
- Do not open a PR -- commit the two doc changes (archive + new plan) to a branch and
  show the file contents when done.
- Run `npx tsc --noEmit` and `npm run lint` after drafting to confirm no paths are
  broken before committing.

---

## Seed data: known patterns as of the current codebase state

Use this section to bootstrap pass 1 work items. All subsequent passes re-derive from
live grep results.

### Missing infrastructure helpers (Step 3a)

The following helpers do not yet exist in `ComponentsV2Utils.ts`:

**`buildTextSend(content: string)`**
```typescript
// Returns a ready-to-spread channel.send() payload
export function buildTextSend(
  content: string,
): { components: ContainerBuilder[]; flags: number } {
  return { components: [buildTextContainer(content)], flags: COMPONENTS_V2_FLAG };
}
```
Eliminates the ~22 `channel.send({ embeds: [embed] })` sites in events and services.

**`buildContainerSend(container: ContainerBuilder)`**
```typescript
export function buildContainerSend(
  container: ContainerBuilder,
): { components: ContainerBuilder[]; flags: number } {
  return { components: [container], flags: COMPONENTS_V2_FLAG };
}
```
Provides the non-interaction equivalent of `{ components: [c], flags: buildComponentsV2Flags(false) }`.

**`buildAccentContainer(content: string, color: number)`**
```typescript
export function buildAccentContainer(
  content: string,
  color: number,
): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
    );
}
```
Replaces the `new EmbedBuilder().setColor(C).setDescription(D)` pattern used in
`GuildBanLog.command.ts`, `ServerChangeLog.command.ts`, `GuildMemberUpdate.command.ts`,
`GuildMemberRemove.command.ts`, `UserUpdate.command.ts`, `GuildMemberAdd.command.ts`,
`Starboard.command.ts`, and `sql-health-check.service.ts`.

**`buildTitledContainer(title, body, opts?)`**
```typescript
export function buildTitledContainer(
  title: string,
  body: string,
  opts?: { color?: number; footer?: string },
): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`# ${title}\n${body}`, 3500),
    ),
  );
  if (opts?.footer) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${opts.footer}`),
    );
  }
  if (opts?.color !== undefined) container.setAccentColor(opts.color);
  return container;
}
```
Replaces the `new EmbedBuilder().setTitle().setDescription().setColor().setFooter()`
pattern. High-value targets: `help.command.ts` (13 embeds), `gamedb-admin.command.ts`
(7), `mod.command.ts` (2), `superadmin.command.ts` (2), `hltb.command.ts`,
`profile.command.ts`, `mp-info.command.ts`, `ThreadLinkPromptService.ts`,
`GiveawayHubService.ts`, `ThreadCreated.command.ts`, `GamedbAuditService.ts`.

**`buildFieldsText(fields: { name: string; value: string }[])`**
```typescript
export function buildFieldsText(
  fields: { name: string; value: string }[],
): string {
  return fields.map(f => `**${f.name}**\n${f.value}`).join("\n\n");
}
```
Converts `addFields([...])` calls to inline markdown. 47 `addFields` calls remain
across the codebase. Use as `buildTitledContainer("T", buildFieldsText(fields))` when
the embed had both a title and fields.

### Raw inline builder residue (Step 3b)

**Inline `ContainerBuilder` + `TextDisplayBuilder` chains**

Many files construct text containers without calling `buildTextContainer()`:
```typescript
// Inline (before)
new ContainerBuilder().addTextDisplayComponents(
  new TextDisplayBuilder().setContent(safeV2TextContent(msg, 3500)),
)
// Factory (after)
buildTextContainer(msg)
```
High-hit files (raw ContainerBuilder uses outside utils):
`now-playing.command.ts` (93), `game-journal.command.ts` (12),
`avatar-history.command.ts` (9), `profile.command.ts` (7),
`completion-list.service.ts` (7), `completion-edit.service.ts` (6),
`completion-common.service.ts` (5), `uiComponents.ts` (3),
`NominationListComponents.ts` (3), `suggestion.command.ts` (3),
`mp-info.command.ts` (3), `imports/import-scaffold.service.ts` (3),
`completionator-ui.service.ts` (3).

Verification grep:
```
grep -rn "new ContainerBuilder\(\)\.addTextDisplayComponents" src/ \
  | grep -v "build/\|ComponentsV2Utils\|DiscordConsoleLogger"
```

**`buildTextReply` adoption**

Files that build a container then manually pair it with `buildComponentsV2Flags` instead
of calling `buildTextReply` directly:
```typescript
// Before
const container = buildTextContainer(msg);
await safeReply(interaction, { components: [container], flags: buildComponentsV2Flags(true) });
// After
await safeReply(interaction, buildTextReply(msg, true));
```

### Cleanup residue (Step 3c)

**Redundant `embeds: []` in v2 replies**

`IS_COMPONENTS_V2` tells Discord to ignore the embeds array. Passing `embeds: []`
alongside v2 components is noise.

Files: `game-journal.command.ts` (10+), `giveaway.command.ts` (8+), `mp-info.command.ts`.

Verification grep:
```
grep -rn "embeds:\s*\[\]" src/ --include="*.ts" | grep -v "build/"
```

**Raw `COMPONENTS_V2_FLAG` usage outside utility files**

Direct use of the constant in command/event files should be replaced with
`buildComponentsV2Flags`, `buildComponentsV2EditFlags`, `buildTextSend`, or
`buildContainerSend`. The only legitimate direct consumers are `ComponentsV2Utils.ts`
and `DiscordConsoleLogger.ts`.

Verification grep:
```
grep -rn "COMPONENTS_V2_FLAG" src/ --include="*.ts" \
  | grep -v "ComponentsV2Utils\|DiscordConsoleLogger\|config/flags\|build/"
```
