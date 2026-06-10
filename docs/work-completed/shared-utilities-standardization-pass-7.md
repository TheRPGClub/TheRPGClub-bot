# Plan: Shared Utilities & Standardization Pass 7

## Context

Passes 1-6 shipped: replyIfNotOwner (initial sweep), safeDeferUpdateOrBail,
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
replyIfNotOwner adoption sweep (#659), buildActionButton adoption sweep (#660),
customId.split(":") final migration (#661), console.error/warn routing (#662),
buildSelectOptions final migration (#663).

No behavior changes -- pure extraction, centralization, and consistency.

---

## Work Items (Ordered by ROI)

### 1. Complete `replyIfNotOwner` adoption sweep (issue #666)

**Problem:** Pass 6 (#659) converted the highest-density sites but ~46 inline owner-checks
remain across the codebase. Every surviving site follows the identical pattern:

```typescript
if (interaction.user.id !== <id>) {
  await interaction.reply({ content: "...", flags: MessageFlags.Ephemeral });
  return;
}
```

This duplicates the gate logic and the reply message text, preventing a single-point
change to the owner-check response.

Representative remaining sites:
- `src/commands/now-playing.command.ts` -- ~26 sites (lines 1364, 1512, 1774, 1820,
  1866, 1912, 1958, 2002, 2066, 2136, 2828, 2907, 3163, 3336, 3467, 3501, 3545,
  3591, 3637, 3667, 3728, 3763, 3922)
- `src/commands/collection/collection-view.command.ts` -- 5 sites (lines 281, 389,
  463, 503, 612)
- `src/commands/collection/collection-csv-import.command.ts` -- 4 sites (lines 730,
  851, 908, 1001)
- `src/commands/collection/collection-steam-import.command.ts` -- 4 sites (lines 682,
  804, 857, 942)
- `src/commands/gamedb/gamedb-completion.command.ts` -- 3 sites (lines 315, 359, 413)
- `src/commands/game-journal.command.ts` -- 1 site (line 1021)
- `src/commands/game-completion/completion-pagination.service.ts` -- 1 site (line 179)
- `src/commands/game-completion/completion-platform.service.ts` -- 1 site (line 96)
- `src/commands/gamedb/gamedb-search.command.ts` -- 1 site (line 475)

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

Skip sites in `src/functions/CompletionHelpers.ts` -- those have admin-override conditions
and are intentionally not a simple owner-gate pattern.

**Verification grep:**
```
grep -rn "interaction\.user\.id !== " src/ | grep -v "InteractionUtils\|CompletionHelpers"
```
Should return zero hits.

---

### 2. Add `buildButtonRow` factory and adopt across codebase (issue #667)

**Problem:** `uiComponents.ts` provides `buildTextInputRow` and a select-row builder, but
has no button-row equivalent. There are 75 instances of:

```typescript
new ActionRowBuilder<ButtonBuilder>().addComponents(btn1, btn2, ...)
```

across command and service files -- identical boilerplate that adds no unique information
at the call site.

Representative sites:
- `src/commands/game-completion/completionator-ui.service.ts` -- ~10 instances
- `src/commands/game-journal.command.ts` -- 5 instances (lines 125, 814, 850, 873, 908)
- `src/commands/todo.command.ts` -- multiple instances
- `src/commands/gamedb-admin.command.ts` -- multiple instances (lines 199, 319, 1051)
- `src/commands/game-completion/completion-edit.service.ts` -- 2 instances (lines 421, 422)

**Solution:** Add to `uiComponents.ts`:
```typescript
export function buildButtonRow(
  ...buttons: ButtonBuilder[]
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}
```

Then sweep all 75 call sites to use the factory. Skip only the two existing select-row
and text-input-row helpers inside `uiComponents.ts` itself.

**Verification grep:**
```
grep -rn "new ActionRowBuilder<ButtonBuilder>" src/ | grep -v "uiComponents\|PaginationUtils"
```
Should return zero hits.

---

### 3. Add `logInfo` to `LogUtils` and route `console.log` in production files (issue #668)

**Problem:** `LogUtils.ts` exposes `logError` and `logWarn` but not `logInfo`. This leaves
22 `console.log` calls in production command and service files using ad-hoc formats that
bypass structured logging. Scripts in `src/scripts/` and the top-level bootstrap file
`src/RPGClub_GameDB.ts` are intentionally excluded.

All remaining production sites:
- `src/commands/collection/collection-list.service.ts` -- 4 calls (lines 399, 441, 449,
  562)
- `src/commands/collection/collection-view.command.ts` -- 3 calls (lines 175, 199, 664)
- `src/services/UserEmojiService.ts` -- 3 calls (lines 124, 214, 226)
- `src/services/IGDB/IgdbScanService.ts` -- 3 calls (lines 113, 164, 184)
- `src/functions/SetPresence.ts` -- 2 calls (lines 28, 63)
- `src/events/MessageCreated.command.ts` -- 2 calls (lines 23, 27)
- `src/functions/InteractionUtils.ts` -- 1 call (line 409)
- `src/services/ThreadSyncService.ts` -- 1 call (line 93)
- `src/services/ThreadLinkPromptService.ts` -- 1 call (line 267)
- `src/services/raw-modal/RawModalLogging.ts` -- 1 call (line 56)
- `src/commands/now-playing.command.ts` -- 1 call (line 248)

**Solution:** Add to `LogUtils.ts`:
```typescript
export function logInfo(context: string, message: unknown): void {
  console.log(formatStructuredLog({ context, message }));
}
```

Then replace each call site:
```typescript
// Before
console.log("[ServiceName] some message", { detail });

// After
logInfo("ServiceName", { detail: "some message" });
```

**Verification grep:**
```
grep -rn "console\.log" src/ | \
  grep -v "scripts/\|build/\|LogUtils\|DiscordConsoleLogger\|RPGClub_GameDB\.ts"
```
Should return zero hits.

---

### 4. Finish `customId.split(":")` migration -- completion-pagination survivors (issue #669)

**Problem:** Pass 6 (#661) was intended to eliminate all `customId.split(":")` calls
outside `CustomIdUtils.ts`, but three survivors remain in
`src/commands/game-completion/completion-pagination.service.ts` (lines 42, 73, 236).
These bypass `parseCustomIdSegments` / `assertCustomIdSegments`, missing bounds checking
and the unified unexpected-customId error path.

All remaining sites:
```
src/commands/game-completion/completion-pagination.service.ts:42
src/commands/game-completion/completion-pagination.service.ts:73
src/commands/game-completion/completion-pagination.service.ts:236
```

**Solution:**
```typescript
// Before
const [, ownerId, yearRaw, modeRaw, ...queryParts] = interaction.customId.split(":");

// After
const segs = assertCustomIdSegments(interaction, 3);
if (!segs) return;
const [, ownerId, yearRaw, modeRaw, ...queryParts] = segs;
```

For the spread-rest case at line 236 (`const [, ...queryParts]`), use
`parseCustomIdSegments` with minimum count 1 and slice from index 1.

**Verification grep:**
```
grep -rn "\.split(\":\")" src/ --include="*.ts" | grep -v CustomIdUtils
```
Should return zero hits.

---

### 5. `buildActionButton` adoption sweep -- remaining `new ButtonBuilder()` sites (issue #670)

**Problem:** Pass 6 (#660) migrated the top-density files but 131 raw `new ButtonBuilder()`
chains remain. Buttons whose label and style match a `buildActionButton` action type
(add/edit/delete/confirm/cancel/close) should be converted; inconsistent manual construction
risks label typos and wrong styles.

Highest-density remaining files:
- `src/commands/now-playing.command.ts` -- ~26 instances
- `src/commands/game-completion/completionator-ui.service.ts` -- ~18 instances
- `src/commands/gamedb-admin.command.ts` -- ~15 instances
- `src/commands/game-completion/completion-edit.service.ts` -- 5 instances (lines 368,
  373, 378, 386, 391)
- `src/commands/game-completion/completion-list.service.ts` -- 3 instances (lines 294,
  302, 310)
- `src/commands/game-journal.command.ts` -- 3 instances (lines 129, 874, 917)
- `src/commands/collection/collection-csv-import.service.ts` -- 4 instances
- `src/commands/collection/collection-steam-import.service.ts` -- 3 instances
- `src/commands/game-completion/completion-common.service.ts` -- 2 instances
- `src/commands/game-completion/completion-add.service.ts` -- 1 instance (line 423)
- `src/commands/mp-info.command.ts` -- 1 instance (line 358)
- `src/commands/suggestion.command.ts` -- 1 instance (line 677)
- `src/commands/help.command.ts` -- 1 instance (line 412)

**Skip:** URL buttons, emoji buttons, nav buttons in `PaginationUtils.ts`,
`NominationListComponents.ts`, and `uiComponents.ts` internals, and any button with a
dynamic style that cannot be expressed as a factory action type.

**Verification grep:**
```
grep -rn "new ButtonBuilder" src/ | \
  grep -v "uiComponents\|PaginationUtils\|NominationList\|build/"
```
Remaining hits should be limited to explicitly excluded categories (URL, emoji, dynamic
style). Count should be under 10.

---

## What NOT to do in this pass

- Do not create a generic embed builder factory -- variation across embed use cases remains
  too high.
- Do not sweep `new ButtonBuilder()` mechanically -- URL buttons, emoji buttons, and nav
  buttons must stay as-is.
- Do not touch `src/scripts/` or `src/RPGClub_GameDB.ts` for the console.log item --
  scripts and the bootstrap entry point are excluded by design.
- Do not convert admin-override sites in `CompletionHelpers.ts` to `replyIfNotOwner` --
  those have conditional logic that is not a pure owner gate.
- Lines must stay under 100 characters.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific verification grep listed in each section.

---

## Prompt for Pass 8

> Move docs/plan/shared-utilities-standardization-pass-7.md to
> docs/work-completed/shared-utilities-standardization-pass-7.md.
>
> Then run a fresh codebase scan. Context: passes 1-7 shipped everything in passes 1-6
> plus: complete replyIfNotOwner adoption sweep (#666), buildButtonRow factory + adoption
> (#667), logInfo addition and console.log routing (#668), customId.split(":")
> completion-pagination survivors (#669), and remaining buildActionButton sweep (#670).
> Do NOT re-propose those items. Scan for new duplication and standardization gaps using
> the same grep strategy used in prior passes. Order by ROI. Create
> docs/plan/shared-utilities-standardization-pass-8.md following the same document
> structure as all prior passes. Create one GitHub issue per work item using:
> gh --repo mfagerstrom/RPGClub_GameDB issue create --title "refactor: <short description>"
> --body "<problem + solution, 3-5 sentences>" --label "refactor"
> Record each issue number next to its work item heading in the document.
