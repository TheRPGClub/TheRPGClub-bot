# Plan: Shared Utilities & Standardization Pass 8

## Context

Passes 1-7 shipped: replyIfNotOwner (initial sweep), safeDeferUpdateOrBail,
deferWithShowInChat, SHOW_IN_CHAT_DESCRIPTION, isPositiveInt/requirePositiveInt,
BotPresenceHistory, row mapper extraction, colors.ts (12 constants), getModalField,
isInteractionSettled/canSafeReply, DelayUtils.ts, pagination.ts, roles.ts, LogUtils.ts,
channel constant fixes, DateFormatUtils.ts, ACCESS_DENIED_* constants, textLimits.ts,
isAdmin/isModerator unification, parseCustomIdSegments, parsePageNumber,
isValidPlaytimeHours, slice(0,100) sweep, DISCORD_AUTOCOMPLETE_DESC_MAX,
DISCORD_EMBED_FIELD_VALUE_MAX, truncateWithEllipsis, customId.split migration (top files),
role name constants, giveaway/todo constant alignment, safeIgnore complete sweep,
chunk<T>, buildSelectOptions, safeUserFetch/safeMemberFetch, buildTextInputRow,
userMention/channelMention adoption, buildActionButton factory, truncateWithEllipsis
remaining, NO_RESULTS_MESSAGE/GAME_NOT_FOUND_MESSAGE, public-first visibility default,
buildPageFooterText, assertCustomIdSegments/logUnexpectedCustomId,
formatLocalNumber/formatMonthYear, PaginationUtils nav button row factories,
replyIfNotOwner adoption sweep (#666), buildButtonRow factory + partial adoption (#667),
logInfo addition and console.log routing (#668), customId.split(":")
completion-pagination survivors (#669), and remaining buildActionButton sweep (#670).

No behavior changes -- pure extraction, centralization, and consistency.

---

## Work Items (Ordered by ROI)

### 1. Complete `buildActionButton` and `buildButtonRow` adoption sweep (issue #672)

**Problem:** Pass 7 added `buildButtonRow` to `uiComponents.ts` and partially migrated
`buildActionButton` usage, but ~130 `new ButtonBuilder()` chains and 5
`new ActionRowBuilder<ButtonBuilder>` sites remain unconverted across command and service
files.

Representative remaining sites:
- `src/commands/now-playing.command.ts` -- ~25 `new ButtonBuilder()` instances (lines 367,
  3572, 3620, 4555, 4578, 4585, 4589, 4593, 4597, 4631, 4635, 4641, 4645, 4760, 4764,
  4805, 4809, 4971, 4975, 4980, 5028, 5032, 5037, 5591)
- `src/commands/game-completion/completionator-ui.service.ts` -- ~15 instances (lines 472,
  477, 503, 508, 527, 532, 537, 544, 549, 579, 584, 589, 612, 617, 622)
- `src/commands/game-completion/completion-edit.service.ts` -- 5 instances (lines 368,
  373, 378, 386, 391)
- `src/commands/collection/collection-list.service.ts` -- 5 instances (lines 274, 286,
  298, 310, 542)
- `src/commands/gamedb/gamedb-csv-import.service.ts` -- 5 instances (lines 141, 146, 151,
  158, 163)
- `src/commands/collection/collection-csv-import.service.ts` -- 4 instances (lines 221,
  233, 245, 257)
- `src/commands/collection/collection-steam-import.service.ts` -- 4 instances (lines 195,
  206, 217, 228)

Remaining `new ActionRowBuilder<ButtonBuilder>` sites:
- `src/commands/todo.command.ts:1080`
- `src/commands/gamedb-admin.command.ts:1244`
- `src/commands/collection/collection-list.service.ts:539`
- `src/commands/now-playing.command.ts:4550`
- `src/functions/journalView.ts:192`

**Solution:**
```typescript
// Before (action button)
new ButtonBuilder()
  .setCustomId(someId)
  .setLabel("Delete")
  .setStyle(ButtonStyle.Danger)

// After (action button)
buildActionButton("delete", someId)

// Before (button row)
new ActionRowBuilder<ButtonBuilder>().addComponents(btn1, btn2)

// After (button row)
buildButtonRow(btn1, btn2)
```

**Key files to update:** `now-playing.command.ts`, `completionator-ui.service.ts`,
`completion-edit.service.ts`, `collection-list.service.ts`, `gamedb-csv-import.service.ts`,
`collection-csv-import.service.ts`, `collection-steam-import.service.ts`,
`completion-add.service.ts`, `completion-list.service.ts`, `completion-common.service.ts`,
`game-journal.command.ts`, `admin/gotm-audit-ui.service.ts`, `admin/round-setup-wizard.service.ts`,
`gamedb-admin.command.ts` (remaining), `events/PresenceUpdate.command.ts`,
`events/MessageReactionAdd.command.ts`, `functions/ReminderUi.ts`,
`functions/journalView.ts`, `functions/CompletionHelpers.ts`, `services/ThreadLinkPromptService.ts`,
`services/GiveawayHubService.ts`, `services/IGDB/IgdbSelectService.ts`,
`gamedb/gamedb-profile.service.ts` (non-URL only), `gamedb/gamedb-utils.ts`,
`gamedb/gamedb-search.command.ts`, `todo.command.ts`, `suggestion.command.ts`

**Skip:** URL buttons, emoji buttons, nav buttons (already in PaginationUtils/NominationListComponents).
Any `ButtonStyle.Link` button stays as raw `new ButtonBuilder()`.

**Verification grep:**
```
grep -rn "new ActionRowBuilder<ButtonBuilder>" src/ | grep -v "uiComponents\|PaginationUtils"
```
Should return zero hits.

```
grep -rn "new ButtonBuilder" src/ | \
  grep -v "uiComponents\|PaginationUtils\|NominationList\|build/"
```
Remaining hits should be limited to URL/emoji/dynamic-style exclusions only (under 10).

---

### 2. Complete `replyIfNotOwner` adoption sweep (issue #673)

**Problem:** Pass 7 (#666) was intended to eliminate all inline owner-gate patterns but
~30 sites remain. These follow the identical
`if (interaction.user.id !== id) { reply ephemeral; return; }` pattern that duplicates
gate logic and reply text.

Remaining sites:
- `src/commands/now-playing.command.ts` -- ~24 guard sites (lines 1365, 1513, 1775, 1821,
  1867, 1913, 1959, 2003, 2067, 2137, 2829, 2908, 3164, 3337, 3468, 3502, 3546, 3592,
  3638, 3668, 3729, 3764, 3923, 4083)
- `src/events/MessageReactionAdd.command.ts` -- 4 sites (lines 281, 338, 373, 468)
- `src/commands/game-completion/completion-pagination.service.ts:188` -- 1 site
- `src/commands/gamedb/gamedb-completion.command.ts:408` -- 1 site
- `src/commands/gamedb/gamedb-search.command.ts:476` -- 1 site

**Solution:**
```typescript
// Before
if (interaction.user.id !== ownerId) {
  await interaction.reply({ content: "...", flags: MessageFlags.Ephemeral });
  return;
}

// After
if (await replyIfNotOwner(interaction, ownerId)) return;
```

**Skip:** Lines in `now-playing.command.ts` using `===` in ternary/argument position
(lines 3263, 3369, 3407, 3446) -- those are expression comparisons, not guard blocks.
Skip admin-override sites in `CompletionHelpers.ts`.

**Verification grep:**
```
grep -rn "interaction\.user\.id !== " src/ | \
  grep -v "InteractionUtils\|CompletionHelpers"
```
Should return zero hits.

---

### 3. Consolidate `buildComponentsV2Flags` import path to `ComponentsV2Utils` (issue #674)

**Problem:** `buildComponentsV2Flags` is defined in `ComponentsV2Utils.ts` but
`NominationListComponents.ts` re-exports it (`export { buildComponentsV2Flags }`), causing
6 files to import from the wrong source. This creates a misleading dependency on
`NominationListComponents` for a utility that has nothing to do with nomination lists.

Files importing from the wrong path:
- `src/commands/round.command.ts`
- `src/commands/profile.command.ts`
- `src/commands/admin/gotm-audit-handlers.ts`
- `src/commands/game-completion/completionator-ui.service.ts`
- `src/commands/admin/gotm-audit.service.ts`
- `src/functions/EphemeralOwnerMenu.ts`

**Solution:**
```typescript
// Before
import { buildComponentsV2Flags } from "../functions/NominationListComponents.js";

// After
import { buildComponentsV2Flags } from "../functions/ComponentsV2Utils.js";
```

After updating all 6 import sites, remove the re-export line from
`NominationListComponents.ts`:
```typescript
// Remove this line from NominationListComponents.ts:
export { buildComponentsV2Flags };
```

**Key files to update:** The 6 files listed above, plus `NominationListComponents.ts`.

**Verification grep:**
```
grep -rn "buildComponentsV2Flags" src/ | grep "NominationListComponents" | grep -v "^src/functions/NominationListComponents"
```
Should return zero hits (no file outside NominationListComponents imports from it).

---

### 4. Eliminate final `customId.split(":")` survivor (issue #675)

**Problem:** One `.split(":")` call remains outside `CustomIdUtils.ts` at
`completion-pagination.service.ts:79`, where `interaction.customId.split(":")[0]`
extracts the prefix to derive the pagination mode. The file already calls
`parseCustomIdSegmentsMin` which internally splits the same string, making the
second call redundant.

```
src/commands/game-completion/completion-pagination.service.ts:79:
  const prefixPart = interaction.customId.split(":")[0];
```

**Solution:** Add a `getCustomIdPrefix` helper to `CustomIdUtils.ts`:
```typescript
// Add to CustomIdUtils.ts
export function getCustomIdPrefix(customId: string): string {
  const idx = customId.indexOf(":");
  return idx >= 0 ? customId.slice(0, idx) : customId;
}
```

Then update the call site:
```typescript
// Before
const prefixPart = interaction.customId.split(":")[0];

// After
const prefixPart = getCustomIdPrefix(interaction.customId);
```

**Key files to update:** `src/utilities/CustomIdUtils.ts` (add helper),
`src/commands/game-completion/completion-pagination.service.ts` (update call site).

**Verification grep:**
```
grep -rn "\.split(\":\")" src/ --include="*.ts" | grep -v CustomIdUtils
```
Should return zero hits.

---

## What NOT to do in this pass

- Do not convert URL buttons (`ButtonStyle.Link`) -- those require a `.setURL()` call that
  cannot be expressed as a factory action type.
- Do not convert emoji buttons or dynamically-styled buttons (style determined at runtime).
- Do not touch `src/scripts/` files for any logging or split changes.
- Do not convert admin-override sites in `CompletionHelpers.ts` to `replyIfNotOwner` --
  those have conditional logic that is not a pure owner gate.
- Do not create a generic embed builder factory -- variation across embed use cases remains
  too high.
- Lines must stay under 100 characters.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific verification grep listed in each section.

---

## Prompt for Pass 9

> Move docs/plan/shared-utilities-standardization-pass-8.md to
> docs/work-completed/shared-utilities-standardization-pass-8.md.
>
> Then run a fresh codebase scan. Context: passes 1-8 shipped everything in passes 1-7
> plus: complete buildActionButton and buildButtonRow adoption (#672), complete
> replyIfNotOwner sweep (#673), buildComponentsV2Flags import path consolidation (#674),
> and final customId.split(":") survivor via getCustomIdPrefix helper (#675).
> Do NOT re-propose those items. Scan for new duplication and standardization gaps using
> the same grep strategy used in prior passes. Order by ROI. Create
> docs/plan/shared-utilities-standardization-pass-9.md following the same document
> structure as all prior passes. Create one GitHub issue per work item using:
>   gh --repo mfagerstrom/RPGClub_GameDB issue create \
>     --title "refactor: <short description>" \
>     --body "<problem + solution, 3-5 sentences>" \
>     --label "refactor"
> Record each issue number next to its work item heading in the document.
