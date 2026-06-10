# Plan: Discord v2 Components Migration Pass 1

## Context

Pass 0 (baseline): no items shipped yet.

No behavior changes -- pure rendering consistency and factory adoption.

---

## Work Items (Ordered by ROI, infrastructure first)

### 1. Add 5 missing factory helpers to ComponentsV2Utils.ts (issue #678)

**Type:** Infrastructure
**Depends on:** none

**Problem:** Five helpers referenced by all downstream migration items do not yet exist in
`ComponentsV2Utils.ts`. Callers currently inline the same builder chains repeatedly or use
`EmbedBuilder` patterns instead.

**Solution:**
```typescript
// buildTextSend -- channel.send equivalent of buildTextReply
export function buildTextSend(
  content: string,
): { components: ContainerBuilder[]; flags: number } {
  return { components: [buildTextContainer(content)], flags: COMPONENTS_V2_FLAG };
}

// buildContainerSend -- wrap an arbitrary ContainerBuilder for channel sends
export function buildContainerSend(
  container: ContainerBuilder,
): { components: ContainerBuilder[]; flags: number } {
  return { components: [container], flags: COMPONENTS_V2_FLAG };
}

// buildAccentContainer -- replaces new EmbedBuilder().setColor(C).setDescription(D)
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

// buildTitledContainer -- replaces setTitle/setDescription/setColor/setFooter chains
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

// buildFieldsText -- converts addFields arrays to **name**\nvalue markdown
export function buildFieldsText(
  fields: { name: string; value: string }[],
): string {
  return fields.map(f => `**${f.name}**\n${f.value}`).join("\n\n");
}
```

**Key files to update:** `src/functions/ComponentsV2Utils.ts`

**Verification grep:**
```
grep -rn "buildTextSend\|buildContainerSend\|buildAccentContainer\|buildTitledContainer\|buildFieldsText" \
  src/functions/ComponentsV2Utils.ts
```
(Should return 5 definitions.)

---

### 2. Remove redundant embeds: [] from v2 component replies (issue #679)

**Type:** Cleanup
**Depends on:** none

**Problem:** `IS_COMPONENTS_V2` instructs Discord to ignore the embeds array, so passing
`embeds: []` alongside v2 component replies is noise. Examples:

- `src/commands/game-journal.command.ts:511` -- `{ embeds: [], components: ..., flags: cvFlags }`
- `src/commands/giveaway.command.ts:416` -- `{ embeds: [], components: ..., flags: ... }`
- `src/commands/gamedb/gamedb-profile.service.ts:604` -- `embeds: [],`

**Solution:**
```typescript
// Before
await safeReply(interaction, { embeds: [], components, flags: cvFlags });

// After
await safeReply(interaction, { components, flags: cvFlags });
```

**Key files to update:**
- `src/commands/game-journal.command.ts` (10+ sites)
- `src/commands/giveaway.command.ts` (8+ sites)
- `src/commands/mp-info.command.ts`
- `src/commands/help.command.ts`
- `src/commands/gamedb/gamedb-profile.service.ts` (4 sites)
- `src/commands/gamedb/gamedb-view.command.ts`
- `src/commands/gamedb/gamedb-search.command.ts`
- `src/services/GiveawayHubService.ts`

**Verification grep:**
```
grep -rn "embeds:\s*\[\]" src/ --include="*.ts" | grep -v "build/"
```
(Should return zero hits.)

---

### 3. Replace raw COMPONENTS_V2_FLAG and deduplicate local flag helpers (issue #680)

**Type:** Cleanup
**Depends on:** none

**Problem:** `COMPONENTS_V2_FLAG` is used directly in non-utility files (should use wrapper
helpers), and two local reimplementations of `buildComponentsV2Flags` exist:

- `src/commands/now-playing.command.ts:267-268` -- private reimplementation
- `src/commands/game-completion/completion-list.service.ts:37` -- private reimplementation

Raw flag usages:
- `src/commands/game-completion/completion-delete.service.ts:40`
- `src/commands/game-completion/completion-add.service.ts` (5 sites)
- `src/commands/game-completion/completion-edit.service.ts` (6 sites)
- `src/functions/CompletionHelpers.ts:236`
- `src/functions/journalView.ts:221`
- `src/services/GameReleaseAnnouncementService.ts:85`

**Solution:**
```typescript
// Before (local reimplementation)
function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

// After -- delete the local function, import from ComponentsV2Utils
import { buildComponentsV2Flags } from "../../functions/ComponentsV2Utils.js";

// Before (raw flag)
flags: COMPONENTS_V2_FLAG,

// After (non-ephemeral)
flags: buildComponentsV2Flags(false),
```

**Key files to update:**
- `src/commands/now-playing.command.ts` (remove local helper, import shared)
- `src/commands/game-completion/completion-list.service.ts` (remove local helper, import shared)
- `src/commands/game-completion/completion-delete.service.ts`
- `src/commands/game-completion/completion-add.service.ts`
- `src/commands/game-completion/completion-edit.service.ts`
- `src/functions/CompletionHelpers.ts`
- `src/functions/journalView.ts`
- `src/services/GameReleaseAnnouncementService.ts`

**Verification grep:**
```
grep -rn "COMPONENTS_V2_FLAG" src/ --include="*.ts" \
  | grep -v "ComponentsV2Utils\|DiscordConsoleLogger\|config/flags\|build/"
```
(Should return zero hits.)

---

### 4. Adopt buildTextContainer in now-playing.command.ts (issue #681)

**Type:** Migration
**Depends on:** 1

**Problem:** `src/commands/now-playing.command.ts` contains 83 inline
`new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(...))`
chains that should call `buildTextContainer()`. Example at line 373:

```typescript
// Inline (before)
new ContainerBuilder().addTextDisplayComponents(
  new TextDisplayBuilder().setContent(safeV2TextContent(msg, 3500)),
)
```

**Solution:**
```typescript
// Factory (after)
buildTextContainer(msg)
```

**Key files to update:** `src/commands/now-playing.command.ts`

**Verification grep:**
```
grep -n "new ContainerBuilder" src/commands/now-playing.command.ts \
  | grep "addTextDisplayComponents"
```
(Should return zero hits.)

---

### 5. Adopt buildTextContainer across remaining inline-builder files (issue #682)

**Type:** Migration
**Depends on:** 1

**Problem:** 73 additional inline `ContainerBuilder().addTextDisplayComponents()` chains
exist outside `now-playing.command.ts`:

- `src/commands/game-journal.command.ts` -- 12 sites
- `src/commands/profile.command.ts` -- 7 sites
- `src/commands/game-completion/completion-list.service.ts` -- 7 sites
- `src/commands/game-completion/completion-edit.service.ts` -- 6 sites
- `src/commands/avatar-history.command.ts` -- 6 sites
- `src/commands/game-completion/completion-common.service.ts` -- 5 sites
- `src/commands/mp-info.command.ts` -- 3 sites
- `src/commands/game-completion/completionator-ui.service.ts` -- 3 sites
- `src/functions/uiComponents.ts` -- 2 sites
- `src/commands/suggestion.command.ts` -- 2 sites
- `src/commands/imports/import-scaffold.service.ts` -- 2 sites
- `src/commands/gamedb/gamedb-add.command.ts` -- 2 sites
- `src/commands/collection/collection-overview.service.ts` -- 2 sites
- `src/commands/collection/collection-list.service.ts` -- 2 sites
- `src/commands/collection/collection-import-ui.utils.ts` -- 2 sites
- Single-hit files: `NominationListComponents.ts`, `NominationAdminHelpers.ts`,
  `InteractionUtils.ts`, `GotmSearchComponents.ts`, `nominate.command.ts`,
  `gamedb-search.command.ts`, `gamedb-completion.command.ts`, `gamedb-admin.command.ts`,
  `completionator-import-command.service.ts`, `completion-pagination.service.ts`

**Solution:**
```typescript
// Before
new ContainerBuilder().addTextDisplayComponents(
  new TextDisplayBuilder().setContent(safeV2TextContent(msg, 3500)),
)

// After
buildTextContainer(msg)
```

**Key files to update:** All files listed above.

**Verification grep:**
```
grep -rn "new ContainerBuilder" src/ --include="*.ts" \
  | grep "addTextDisplayComponents" \
  | grep -v "build/\|ComponentsV2Utils\|DiscordConsoleLogger"
```
(Should return zero hits.)

---

### 6. Convert EmbedBuilder in help.command.ts, mod.command.ts, superadmin.command.ts (issue #683)

**Type:** Migration
**Depends on:** 1

**Problem:** These three files use `new EmbedBuilder().setTitle().setDescription().addFields()`
chains returned as `{ embeds: [embed], components }` payloads -- a direct match for
`buildTitledContainer` + `buildFieldsText`. Example from `help.command.ts:443-453`:

```typescript
// Before
const embed = new EmbedBuilder()
  .setTitle(`${topic.label} help`)
  .setDescription(topic.summary)
  .addFields({ name: "Syntax", value: topic.syntax });
if (topic.notes) embed.addFields({ name: "Notes", value: topic.notes });
return { embeds: [embed], components };
```

Files and hit counts:
- `src/commands/help.command.ts` -- 13+ embeds
- `src/commands/mod.command.ts` -- 2 embeds
- `src/commands/superadmin.command.ts` -- 2 embeds

**Solution:**
```typescript
// After
const body = buildFieldsText([
  { name: "Syntax", value: topic.syntax },
  ...(topic.notes ? [{ name: "Notes", value: topic.notes }] : []),
]);
return {
  components: [buildTitledContainer(`${topic.label} help`, `${topic.summary}\n\n${body}`)],
  flags: buildComponentsV2Flags(false),
};
```

**Key files to update:**
- `src/commands/help.command.ts`
- `src/commands/mod.command.ts`
- `src/commands/superadmin.command.ts`

**Verification grep:**
```
grep -rn "new EmbedBuilder" src/commands/help.command.ts \
  src/commands/mod.command.ts src/commands/superadmin.command.ts
```
(Should return zero hits.)

---

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

## Prompt for Pass 2

> Move docs/plan/discord-v2-components-pass-1.md to
> docs/work-completed/discord-v2-components-pass-1.md.
>
> Then run a fresh codebase scan. Context: pass 1 shipped: #678 add buildTextSend,
> buildContainerSend, buildAccentContainer, buildTitledContainer, buildFieldsText;
> #679 remove redundant embeds: []; #680 replace raw COMPONENTS_V2_FLAG and deduplicate
> local flag helpers; #681 adopt buildTextContainer in now-playing.command.ts (83 sites);
> #682 adopt buildTextContainer across remaining inline-builder files (73 sites);
> #683 convert EmbedBuilder in help/mod/superadmin to buildTitledContainer.
> Do NOT re-propose those items. Scan for v2 migration and helper-extraction gaps using
> the same grep strategy used in prior passes. Order by ROI, infrastructure first. Create
> docs/plan/discord-v2-components-pass-2.md following the same document structure as all
> prior passes. Create one GitHub issue per work item using:
>   gh --repo mfagerstrom/RPGClub_GameDB issue create \
>     --title "refactor: <short description>" \
>     --body "<problem + solution, 3-5 sentences>" \
>     --label "refactor"
> Record each issue number next to its work item heading in the document.
