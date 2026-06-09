# Plan: Shared Utilities & Standardization Pass 3

## Context

All 8 pass-2 items have shipped (colors, getModalField, isInteractionSettled,
DelayUtils, pagination constants, roles, LogUtils, channel constants). This document captures
the next tier of duplication and standardization gaps found in the subsequent scan.

No behavior changes -- pure extraction, centralization, and consistency fixes.

---

## Work Items (Ordered by ROI)

### 1. Expand `src/config/colors.ts` -- add missing named embed colors

**Problem:** Five distinct hex values remain hardcoded in source files, not covered by the
existing six constants in `colors.ts`:

| Suggested name | Hex | Current locations |
|---|---|---|
| `COLOR_NEUTRAL` | `0x95a5a6` | `DiscordConsoleLogger.ts:12`, `GuildMemberRemove.command.ts:97` |
| `COLOR_PURPLE` | `0x9b59b6` | `DiscordConsoleLogger.ts:16` |
| `COLOR_HEALTH_OK` | `0x57f287` | `sql-health-check.service.ts:51` |
| `COLOR_HEALTH_FAIL` | `0xed4245` | `sql-health-check.service.ts:51` |
| `COLOR_BLUE_INFO` | `0x2d7ff9` | `ThreadLinkPromptService.ts:45` |
| `COLOR_DARK` | `0x2f3136` | `Starboard.command.ts:87` |

**Solution:** Append to `src/config/colors.ts`:
```typescript
export const COLOR_NEUTRAL     = 0x95a5a6;
export const COLOR_PURPLE      = 0x9b59b6;
export const COLOR_HEALTH_OK   = 0x57f287;
export const COLOR_HEALTH_FAIL = 0xed4245;
export const COLOR_BLUE_INFO   = 0x2d7ff9;
export const COLOR_DARK        = 0x2f3136;
```

Then update each file to import and use the constant.

**Verification:** `grep -rn "0x95a5a6\|0x9b59b6\|0x57f287\|0xed4245\|0x2d7ff9\|0x2f3136" src/`
should return zero hits after the pass (only `colors.ts` defines them).

---

### 2. Extract date-formatting utilities out of `profile.command.ts`

**Problem:** `formatTableDate()`, `formatDiscordTimestamp()`, and `formatPlaytimeHours()` are
defined in `src/commands/profile.command.ts` but imported by 9+ unrelated files:

- `src/functions/journalView.ts:16`
- `src/commands/game-completion/completion-add.service.ts:24`
- `src/commands/game-completion/completion-edit.service.ts:17`
- `src/commands/game-completion/completion-list.service.ts:18`
- `src/commands/game-completion/completionator-workflow.service.ts:30`

Additionally, two independent re-implementations exist that should be removed:
- `src/commands/todo.command.ts:350` -- local `formatDiscordTimestamp()` with `:f` default
  (vs. profile.command.ts uses `:F`)
- `src/commands/avatar-history.command.ts:48` -- local `formatTimestamp()` with no format arg

These inconsistencies mean the same date renders differently depending on which command calls it.

**Solution:**
1. Create `src/functions/DateFormatUtils.ts` and move the three exported functions there.
2. Re-export from `profile.command.ts` (to avoid a breaking import change for files not yet
   updated) and mark for removal in pass 3.
3. Delete the local reimplementations in `todo.command.ts` and `avatar-history.command.ts`;
   update their call sites to use the shared versions.
4. Update all 9+ import sites to point to `DateFormatUtils.ts`.

**Verification:** `grep -rn "from.*profile.command.*formatTable\|from.*profile.command.*formatDiscord\|from.*profile.command.*formatPlaytime"
src/` should return zero hits (all imports now from `DateFormatUtils`).

---

### 3. Centralize access-denied error messages

**Problem:** Eight variations of "Access denied" strings are scattered across 7+ files with
no shared source. `OWNER_ONLY_MESSAGE` is already centralized in `InteractionUtils.ts:514`
but the remaining messages are not:

| String | File(s) |
|---|---|
| `"Access denied. Command requires Administrator role."` | `admin-auth.utils.ts:15` |
| `"Access denied. Command requires Moderator role or above."` | `mod.command.ts:217` |
| `"Access denied. Command requires Moderator, Administrator, or server owner."` | `todo.command.ts:397`, `gamedb-utils.ts:133` |
| `"Access denied. Command is restricted to the server owner."` | `superadmin.command.ts:927` |
| `"Access denied. Command requires server owner."` | `todo.command.ts:420`, `gamedb-csv-import.command.ts:368` |
| `"Access denied. Command requires the Regulars role."` | `thread-admin.command.ts:35, 63` |

**Solution:** Add to `src/functions/InteractionUtils.ts` (near the existing `OWNER_ONLY_MESSAGE`):
```typescript
export const ACCESS_DENIED_ADMIN    = "Access denied. Command requires Administrator role.";
export const ACCESS_DENIED_MOD      = "Access denied. Command requires Moderator role or above.";
export const ACCESS_DENIED_MOD_ADMIN = "Access denied. Command requires Moderator, Administrator, or server owner.";
export const ACCESS_DENIED_OWNER    = "Access denied. Command is restricted to the server owner.";
export const ACCESS_DENIED_REGULARS = "Access denied. Command requires the Regulars role.";
```

Update each call site to import and use the constant.

**Verification:** `grep -rn '"Access denied\.' src/` should return zero hits.

---

### 4. Create `src/config/textLimits.ts` -- replace 89 magic-number truncations

**Problem:** `grep` finds 89 occurrences of `.slice(0, N)` with hardcoded lengths across the
codebase. The same numeric values recur (100, 25, 50, 256) with no names, no comments, and
no indication whether the limit is a Discord constraint or a UX choice.

Common patterns:
- `.slice(0, 100)` -- select option label max (Discord limit)
- `.slice(0, 25)` -- select menu option count max (Discord limit)
- `.slice(0, 50)` -- query truncation for SQL (application choice)
- `.slice(0, 256)` -- embed title max (Discord limit)

**Solution:** Create `src/config/textLimits.ts`:
```typescript
// Discord API hard limits
export const DISCORD_SELECT_LABEL_MAX    = 100;
export const DISCORD_SELECT_OPTIONS_MAX  = 25;
export const DISCORD_EMBED_TITLE_MAX     = 256;
export const DISCORD_EMBED_DESCRIPTION_MAX = 4096;
export const DISCORD_BUTTON_LABEL_MAX    = 80;
export const DISCORD_MODAL_TITLE_MAX     = 45;
export const DISCORD_TEXT_INPUT_MAX      = 4000;

// Application-defined limits
export const MAX_QUERY_LENGTH            = 50;
export const MAX_CONTAINER_TEXT          = 3500;
export const MAX_SECTION_TEXT            = 1000;
```

Replace the highest-frequency `.slice(0, 100)` and `.slice(0, 25)` truncations in:
- `src/commands/game-completion/completion-list.service.ts` (lines 44, 52, 85, 127, 141)
- `src/commands/game-completion/completion-common.service.ts` (lines 126, 334, 420, 446)
- `src/commands/gamedb/gamedb-search.command.ts` (lines 183-185, 223)
- `src/functions/uiComponents.ts` (lines 29, 33, 45, 71)

Full sweep of all 89 sites can be done in a follow-on PR.

**Verification:** After the pass, targeted files should contain no bare `.slice(0, 100)` or
`.slice(0, 25)` calls -- only named-constant form.

---

### 5. Unify `isAdmin` / `isModerator` import paths and extract to a single module

**Problem:** `isAdmin` is imported from two different sources:
- `src/commands/admin.command.ts` (used by `publicreminder.command.ts`, `rss.command.ts`)
- `src/commands/admin/admin-auth.utils.ts` (used by `generate-vote-image.command.ts`,
  `avatar-history.command.ts`)

`isModerator` lives in `mod.command.ts:202` -- a command file, not a utility -- and has no
shared import point for other commands.

**Solution:**
1. Confirm that the `isAdmin` in `admin.command.ts` delegates to `admin-auth.utils.ts` (or
   is itself the source). If it re-exports, remove the re-export and standardize all imports
   directly to `admin-auth.utils.ts`.
2. Move `isModerator()` from `mod.command.ts` to `admin-auth.utils.ts` (or a new
   `src/functions/PermissionUtils.ts`).
3. Update all call sites to import from the single canonical location.

**Verification:** `grep -rn "from.*admin\.command.*isAdmin" src/` should return zero hits.

---

### 6. Add `parseCustomIdSegments()` to `CustomIdUtils.ts`

**Problem:** 174 occurrences of `interaction.customId.split(":")` with inline destructuring.
No shared parser; segment count is never validated, making typos in custom ID templates silent
at runtime.

Representative examples:
- `mp-info.command.ts:328` -- `const [, ownerId, filterKey, pageRaw] = ...split(":")`
- `game-journal.command.ts:606` -- `const [, callerId, targetUserId] = ...split(":")`
- `avatar-history.command.ts:343` -- `const [, userId, pageRaw, dir] = ...split(":")`

**Solution:** Add to `src/utilities/CustomIdUtils.ts`:
```typescript
/**
 * Splits a colon-delimited custom ID and returns the segments after the prefix.
 * Returns null if the segment count doesn't match expectedCount.
 */
export function parseCustomIdSegments(
  customId: string,
  expectedCount: number,
): string[] | null {
  const parts = customId.split(":");
  // parts[0] is the command/action prefix
  const segments = parts.slice(1);
  if (segments.length !== expectedCount) return null;
  return segments;
}
```

Migrate the highest-traffic handlers first (mp-info, game-journal, avatar-history), then
sweep the rest in a follow-on PR.

**Verification:** No single-function verification grep -- confirm migrated files no longer
contain bare `.split(":")` + destructuring in component handlers.

---

### 7. Expand `ValidationUtils.ts` -- add page number and playtime validators

**Problem:** Repeated inline validation logic not covered by the existing `isPositiveInt` /
`requirePositiveInt` utilities:

- `Number.isNaN(page)` guard after `parseInt` -- appears 10+ times with no wrapper
- `Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0` -- appears in 3 files
  (`completion-add.service.ts:150`, `game-completion.command.ts:190`,
  `superadmin.command.ts:246`)

**Solution:** Add to `src/utilities/ValidationUtils.ts`:
```typescript
/** Returns the parsed page number, or null if not a valid positive integer. */
export function parsePageNumber(raw: string | null | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/** Returns true if value is a valid non-negative playtime in hours. */
export function isValidPlaytimeHours(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0;
}
```

Update the three playtime validation call sites to use `isValidPlaytimeHours`, and migrate
the most common `parseInt` + `Number.isNaN` guard patterns to `parsePageNumber`.

**Verification:** `grep -rn "Number.isNaN.*PlaytimeHours\|finalPlaytimeHours < 0" src/` should
return zero hits after the pass.

---

## What NOT to do in this pass

- Do not build a generic embed factory. The 57+ `new EmbedBuilder()` chains vary too widely
  per use case; a factory would add abstraction with no clear contract.
- Do not attempt a full sweep of all 174 `customId.split` sites in a single PR. Migrate the
  top 3-4 commands in item 6, then open a follow-on.
- Do not tackle the full 89 `.slice` truncations in item 4 -- focus on the files listed.
- Do not move `isModerator` if it requires touching more than 10 call sites in this pass;
  scope to the import-path unification only and leave the move for pass 3.

---

## Verification (per item)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific grep check listed in each section above.
