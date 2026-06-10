# Plan: Shared Utilities & Standardization Pass 6

## Context

Passes 1-5 shipped: replyIfNotOwner, safeDeferUpdateOrBail, deferWithShowInChat,
SHOW_IN_CHAT_DESCRIPTION, isPositiveInt/requirePositiveInt, BotPresenceHistory, row mapper
extraction, colors.ts (12 constants), getModalField, isInteractionSettled/canSafeReply,
DelayUtils.ts, pagination.ts, roles.ts, LogUtils.ts, channel constant fixes,
DateFormatUtils.ts, ACCESS_DENIED_* constants, textLimits.ts, isAdmin/isModerator
unification, parseCustomIdSegments, parsePageNumber, isValidPlaytimeHours, slice(0,100)
sweep, DISCORD_AUTOCOMPLETE_DESC_MAX, DISCORD_EMBED_FIELD_VALUE_MAX, truncateWithEllipsis,
customId.split migration (top files), role name constants, giveaway/todo constant alignment,
safeIgnore complete sweep, chunk<T>, buildSelectOptions, safeUserFetch/safeMemberFetch,
buildTextInputRow, userMention/channelMention adoption, buildActionButton factory,
truncateWithEllipsis remaining, NO_RESULTS_MESSAGE/GAME_NOT_FOUND_MESSAGE,
public-first visibility default, buildPageFooterText, assertCustomIdSegments/
logUnexpectedCustomId, formatLocalNumber/formatMonthYear, PaginationUtils nav button row
factories.

No behavior changes -- pure extraction, centralization, and consistency.

---

## Work Items (Ordered by ROI)

### 1. `replyIfNotOwner` adoption sweep (issue #659)

**Problem:** `replyIfNotOwner()` was introduced in Pass 1 but ~100 handler functions still
perform the inline check `if (interaction.user.id !== ownerId)` followed by a manual reply
rather than delegating to the utility. This duplicates the reply message logic and makes it
impossible to change the owner-gate response text in one place.

Representative examples:
- `src/commands/now-playing.command.ts:2695` -- `if (interaction.user.id !== ownerId)`
  (50+ occurrences in this file alone)
- `src/commands/game-completion/completionator-handlers.service.ts:51`
- `src/commands/collection/collection-steam-import.command.ts:682`
- `src/commands/collection/collection-csv-import.command.ts:730`
- `src/commands/gamedb/gamedb-csv-import.command.ts:489`
- `src/commands/admin/gotm-audit-handlers.ts:49`

**Solution:** For each site that matches the pattern:
```typescript
// Before
if (interaction.user.id !== ownerId) {
  await interaction.reply({ content: "...", flags: ... });
  return;
}

// After
if (await replyIfNotOwner(interaction, ownerId)) return;
```

Verify the signature of `replyIfNotOwner` in `InteractionUtils.ts` before sweeping;
if the current signature only accepts a string `ownerId`, expand it to accept the full
session/context object where needed, or extract the id before calling.

Sites with extra conditions (admin overrides, etc.) must be handled case-by-case
rather than mechanically replaced.

**Key files to update:**
- `src/commands/now-playing.command.ts` (50+ sites)
- `src/commands/game-completion/completionator-handlers.service.ts` (~8 sites)
- `src/commands/collection/collection-steam-import.command.ts` (~4 sites)
- `src/commands/collection/collection-csv-import.command.ts` (~4 sites)
- `src/commands/gamedb/gamedb-csv-import.command.ts` (~4 sites)
- `src/commands/admin/gotm-audit-handlers.ts` (~4 sites)

**Verification grep:**
```
grep -rn "interaction\.user\.id !== \|interaction\.user\.id ===" src/
```
Count should fall to near zero outside of `InteractionUtils.ts` and sites with
admin-override logic.

---

### 2. `buildActionButton` adoption sweep (issue #660)

**Problem:** `buildActionButton()` was introduced in Pass 5 but 100+ `new ButtonBuilder()`
chains in command/service files still construct buttons with hardcoded label/style combos
matching the factory's action types (add/edit/delete/confirm/cancel/close). Inconsistent
styling (e.g., Primary where Secondary was intended) and label typos are preventable.

Representative examples:
- `src/commands/game-completion/completionator-ui.service.ts:438` -- ~20 instances
- `src/commands/gamedb-admin.command.ts:191` -- ~15 instances
- `src/commands/now-playing.command.ts:364` -- ~30 instances
- `src/commands/game-completion/completion-edit.service.ts:368` -- ~5 instances
- `src/commands/collection/collection-csv-import.service.ts:220` -- ~4 instances
- `src/commands/gamedb/gamedb-csv-import.service.ts:140` -- ~5 instances

**Solution:** For each button whose label and style match a factory action type:
```typescript
// Before
new ButtonBuilder()
  .setCustomId("confirm-delete")
  .setLabel("Confirm")
  .setStyle(ButtonStyle.Success)

// After
buildActionButton("confirm", "confirm-delete")
```

Skip: URL buttons, link buttons, buttons with emojis, dynamically-styled buttons,
buttons in `PaginationUtils.ts` (those belong to the nav factory), and buttons whose
label differs meaningfully from the factory default (pass the label override parameter).

**Key files to update:**
- `src/commands/game-completion/completionator-ui.service.ts`
- `src/commands/gamedb-admin.command.ts`
- `src/commands/now-playing.command.ts`
- `src/commands/game-completion/completion-edit.service.ts`
- `src/commands/collection/collection-csv-import.service.ts`
- `src/commands/gamedb/gamedb-csv-import.service.ts`
- `src/commands/game-completion/completion-add.service.ts`
- `src/commands/admin/gotm-audit-ui.service.ts`

**Verification grep:**
```
grep -rn "new ButtonBuilder" src/ | grep -v buildActionButton
```
Remaining hits should be limited to PaginationUtils.ts, NominationListComponents.ts,
uiComponents.ts internals, and buttons with URLs or dynamic styles.

---

### 3. Complete `customId.split(":")` migration (issue #661)

**Problem:** Pass 4 migrated the top-density files but 6 `customId.split(":")` calls
remain across 4 files. These bypass `parseCustomIdSegments`/`assertCustomIdSegments`,
missing bounds checking and the unified error path.

All remaining sites:
- `src/commands/game-journal.command.ts:694`
- `src/commands/game-completion/completion-pagination.service.ts:42`
- `src/commands/game-completion/completion-pagination.service.ts:73`
- `src/commands/game-completion/completion-pagination.service.ts:236`
- `src/commands/now-playing.command.ts:3022`
- `src/commands/giveaway.command.ts:848`

**Solution:**
```typescript
// Before
const [, callerId, targetUserId, gameIdStr, pageRaw, ...queryParts] =
  interaction.customId.split(":");

// After
const segs = assertCustomIdSegments(interaction, 5);
if (!segs) return;
const [, callerId, targetUserId, gameIdStr, pageRaw, ...queryParts] = segs;
```

For spread-rest (`...queryParts`) destructuring, use `parseCustomIdSegments` with a
minimum count and collect remaining segments manually.

**Key files to update:**
- `src/commands/game-journal.command.ts`
- `src/commands/game-completion/completion-pagination.service.ts`
- `src/commands/now-playing.command.ts`
- `src/commands/giveaway.command.ts`

**Verification grep:**
```
grep -rn "\.split(\":\")" src/ --include="*.ts" | grep -v CustomIdUtils
```
Should return zero hits.

---

### 4. Route `console.error`/`console.warn` in production command/service files
through `LogUtils` (issue #662)

**Problem:** Two production (non-script) files use raw `console.error`/`console.warn`
after Pass 5's sweep. Scripts in `src/scripts/` are intentionally excluded -- the problem
is confined to command and service code.

All remaining production sites:
- `src/commands/generate-vote-image.command.ts:180` -- raw `console.error`
- `src/services/raw-modal/RawModalLogging.ts:47` -- `console.error(line)`
- `src/services/raw-modal/RawModalLogging.ts:51` -- `console.warn(line)`

**Solution:**
```typescript
// generate-vote-image.command.ts (inside a catch block)
// Before
console.error(err);
// After
logError("generate-vote-image", err);

// RawModalLogging.ts
// Before
console.error(line);
console.warn(line);
// After
logError("RawModalLogging", line);
logWarn("RawModalLogging", line);
```

Import `logError` and `logWarn` from `LogUtils.ts` in each file.

**Key files to update:**
- `src/commands/generate-vote-image.command.ts`
- `src/services/raw-modal/RawModalLogging.ts`

**Verification grep:**
```
grep -rn "console\.error\|console\.warn" src/ | grep -v "LogUtils\|DiscordConsoleLogger\|scripts/"
```
Should return zero hits.

---

### 5. Complete `buildSelectOptions` migration (issue #663)

**Problem:** `buildSelectOptions()` was introduced in Pass 5 and most call sites were
migrated, but 2 files still construct `StringSelectMenuOptionBuilder` instances inline.

Remaining files:
- `src/commands/avatar-history.command.ts`
- `src/functions/uiComponents.ts`

**Solution:** Replace inline `new StringSelectMenuOptionBuilder()` chains with
`buildSelectOptions(inputs)` where the options list can be expressed as
`SelectOptionInput[]`. Where `uiComponents.ts` has internal builder logic that IS the
implementation, verify it is the `buildSelectOptions` definition itself and not a
separate call site.

**Key files to update:**
- `src/commands/avatar-history.command.ts`
- `src/functions/uiComponents.ts`

**Verification grep:**
```
grep -rln "new StringSelectMenuOptionBuilder\|new SelectMenuOptionBuilder" src/
```
Should return zero hits.

---

## EmbedBuilder density (informational, not a work item)

`help.command.ts` has 13 `new EmbedBuilder()` instances; `gamedb-admin.command.ts` has
7. Per Pass 5, a generic embed factory is deferred because variation per use case is too
high. This is noted for Pass 7 re-evaluation if usage patterns converge.

---

## What NOT to do in this pass

- Do not create a generic embed builder factory -- still too much per-use-case variation.
- Do not sweep all `new ButtonBuilder()` instances mechanically -- URL buttons, emoji
  buttons, and nav buttons must stay as-is.
- Do not change owner-check logic at sites with admin overrides -- handle those manually.
- Do not touch `src/scripts/` for the console.error item -- scripts are excluded by design.
- Lines must stay under 100 characters.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific verification grep listed in each section.

---

## Prompt for Pass 7

> Move docs/plan/shared-utilities-standardization-pass-6.md to
> docs/work-completed/shared-utilities-standardization-pass-6.md.
>
> Then run a fresh codebase scan. Context: passes 1-6 shipped replyIfNotOwner adoption
> sweep (#659), buildActionButton adoption sweep (#660), customId.split(":") final
> migration (#661), console.error/warn routing in production command/service files (#662),
> and buildSelectOptions final migration (#663). Do NOT re-propose those items.
> Scan for new duplication and standardization gaps using the same grep strategy
> used in the pass 6 prompt. Order by ROI. Create
> docs/plan/shared-utilities-standardization-pass-7.md following the same document
> structure as all prior passes. Create one GitHub issue per work item using:
> gh --repo mfagerstrom/RPGClub_GameDB issue create --title "refactor:
> <short description>" --body "<problem + solution, 3-5 sentences>" --label "refactor"
> Record each issue number next to its work item heading in the document.
