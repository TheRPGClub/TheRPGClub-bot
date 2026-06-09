# Plan: Shared Utilities & Standardization Pass 4

## Context

Passes 1-3 shipped: colors, DateFormatUtils, access-denied messages, textLimits.ts (initial),
parseCustomIdSegments, isAdmin/isModerator unification, parsePageNumber, isValidPlaytimeHours,
pagination constants, roles, LogUtils, and channel constants.

This pass continues the sweeps that pass 3 scoped intentionally short, closes gaps in
textLimits.ts, and introduces one new utility for silent-catch noise.

No behavior changes -- pure extraction, centralization, and consistency fixes.

---

## Work Items (Ordered by ROI)

### 1. Sweep remaining `slice(0, 100)` calls -- use `DISCORD_SELECT_LABEL_MAX`

**Problem:** `textLimits.ts` already exports `DISCORD_SELECT_LABEL_MAX = 100` but 65 call
sites across the codebase still use the bare literal. Pass 3 converted only the highest-traffic
files.

Top remaining files:
- `src/commands/superadmin.command.ts` (multiple)
- `src/commands/now-playing.command.ts` (multiple)
- `src/commands/nominate.command.ts` (multiple)
- `src/commands/giveaway.command.ts` (multiple)
- `src/commands/game-journal.command.ts` (multiple)
- `src/commands/hltb.command.ts` (multiple)
- `src/commands/mp-info.command.ts` (multiple)
- `src/commands/profile.command.ts` (multiple)
- `src/commands/create-thread.command.ts` (multiple)
- `src/commands/game-completion/completionator-ui.service.ts` (multiple)

**Solution:** Import `DISCORD_SELECT_LABEL_MAX` from `src/config/textLimits.ts` in each file
and replace every `.slice(0, 100)` with `.slice(0, DISCORD_SELECT_LABEL_MAX)`.

**Verification:** `grep -rn "\.slice(0, 100)" src/` should return zero hits.

---

### 2. Add missing Discord limits to `textLimits.ts` and sweep their call sites

**Problem:** Two values recur across the codebase that are not yet named in `textLimits.ts`:

| Value | Occurrences | Usage |
|---|---|---|
| `95` | 19 | Autocomplete option descriptions (Discord API limit is 100; 95 leaves room for suffix) |
| `1024` | 3 | Embed field value max (Discord API hard limit) |

**Solution:** Append to `src/config/textLimits.ts`:
```typescript
export const DISCORD_AUTOCOMPLETE_DESC_MAX = 95;
export const DISCORD_EMBED_FIELD_VALUE_MAX = 1024;
```

Then sweep all 22 call sites to replace bare literals:
- `.slice(0, 95)` -- 19 instances across `mod.command.ts`, `superadmin.command.ts`,
  `help.command.ts` (5x), `now-playing.command.ts`, `gamedb-csv-import.command.ts` (2x),
  `admin/admin-help.service.ts`, `completion-add.service.ts`,
  `completionator-ui.service.ts` (2x), `completionator-workflow.service.ts`,
  `gamedb-csv-import.service.ts`, `profile.command.ts`
- `.slice(0, 1024)` -- 3 instances in `collection-steam-import.command.ts` and
  `collection-csv-import.command.ts`

**Verification:**
```
grep -rn "\.slice(0, 95)\|\.slice(0, 1024)" src/
```
should return zero hits.

---

### 3. Extract `truncateWithEllipsis()` shared utility

**Problem:** Three files independently implement the same "truncate to max length and append
ellipsis" pattern with no shared helper:

- `src/commands/gamedb-admin.command.ts:97` --
  `value.slice(0, Math.max(0, maxLength - 3)) + "..."`
- `src/functions/GotmEntryEmbeds.ts:60` -- `value.slice(0, MAX - 3) + "..."`
- `src/functions/GotmEntryEmbeds.ts:70` -- `body.slice(0, Math.max(0, availForBody - 3)) + "..."`

A near-identical pattern also exists inline in `todo.command.ts:543`:
`value.slice(0, MAX_TEXT_DISPLAY_CONTENT - 3)}...`

**Solution:** Add to `src/utilities/ValidationUtils.ts` (or a new `src/utilities/StringUtils.ts`
if the file grows too large):
```typescript
export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)) + "...";
}
```

Update the four call sites to use the shared function.

**Verification:** `grep -rn '+ "\.\.\."' src/` should return zero hits after the pass.

---

### 4. Complete `parseCustomIdSegments()` migration sweep

**Problem:** `parseCustomIdSegments()` was added to `src/utilities/CustomIdUtils.ts` in pass 3
and has 24 usages, but 155 inline `.split(":")` calls remain across 32 files. Unmigrated sites
carry no segment-count validation; a typo in a custom ID template is a silent runtime bug.

Top files by split-call count:
- `src/commands/now-playing.command.ts`
- `src/commands/collection/collection-view.command.ts`
- `src/commands/gamedb/gamedb-completion.command.ts`
- `src/commands/superadmin.command.ts`
- `src/commands/giveaway.command.ts`

**Solution:** For each component/modal handler in unmigrated files, replace the inline
destructured split with `parseCustomIdSegments(customId, N)`. When `null` is returned
(unexpected segment count), log an error and return early.

Recommended sweep order: highest-traffic commands first (`now-playing`, `collection-view`,
`gamedb-completion`), then a follow-on PR for the rest.

**Verification:** After migrating a file, it should contain no `customId.split(":")` outside
of `CustomIdUtils.ts` itself. Full completion: `grep -rln "\.split(\":\")" src/` list shrinks
to zero files (excluding `CustomIdUtils.ts`).

---

### 5. Add role name constants to `roles.ts`

**Problem:** Two hardcoded role-name strings appear in event handlers that look up roles by
name instead of ID:

- `src/events/MessageCreated.command.ts:16-19` -- `'members'` and `'newcomers'`

`roles.ts` already exports IDs (`MEMBER_ROLE_ID`, `NEWCOMERS_ROLE_ID`) but has no name
constants. Role lookups by name are fragile if the server renames a role.

**Solution:** Append to `src/config/roles.ts`:
```typescript
export const MEMBER_ROLE_NAME = "members";
export const NEWCOMERS_ROLE_NAME = "newcomers";
```

Update `MessageCreated.command.ts` to import and use these constants.

**Note:** Prefer ID-based lookups (`guild.roles.cache.get(MEMBER_ROLE_ID)`) where possible.
The constants at minimum centralize the strings so a rename is a one-line change.

**Verification:** `grep -rn "'members'\|'newcomers'" src/` should return zero hits.

---

### 6. Move giveaway command local max-length constants to `textLimits.ts`

**Problem:** `src/commands/giveaway.command.ts` defines three max-length constants as file-local
`const` values:

```typescript
const MAX_TITLE_LENGTH = 200;    // line 59
const MAX_PLATFORM_LENGTH = 50;  // line 60
const MAX_KEY_LENGTH = 200;      // line 61
```

These are application-defined business rules, not Discord limits, and belong in the centralized
config alongside the existing application limits in `textLimits.ts`.

**Solution:** Append to `src/config/textLimits.ts`:
```typescript
// Application-defined field limits
export const GIVEAWAY_MAX_TITLE_LENGTH    = 200;
export const GIVEAWAY_MAX_PLATFORM_LENGTH = 50;
export const GIVEAWAY_MAX_KEY_LENGTH      = 200;
```

Remove the three local `const` declarations in `giveaway.command.ts` and import from
`textLimits.ts`.

**Verification:** `grep -n "MAX_TITLE_LENGTH\|MAX_PLATFORM_LENGTH\|MAX_KEY_LENGTH"
src/commands/giveaway.command.ts` should show only import-path references, no `const`
declarations.

---

### 7. Align `todo.command.ts` local constants with existing config files

**Problem:** `src/commands/todo.command.ts` defines multiple constants that duplicate or
overlap values already exported from config:

| Local constant | Value | Existing canonical export |
|---|---|---|
| `MAX_ISSUE_BODY = 4000` | 4000 | `DISCORD_TEXT_INPUT_MAX = 4000` in `textLimits.ts` |
| `MAX_TEXT_DISPLAY_CONTENT = 4000` | 4000 | `DISCORD_TEXT_INPUT_MAX = 4000` in `textLimits.ts` |
| `MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE = 4000` | 4000 | `DISCORD_TEXT_INPUT_MAX = 4000` in `textLimits.ts` |
| `DEFAULT_PAGE_SIZE = 9` | 9 | No match in `pagination.ts` (closest is `DEFAULT_PAGE_SIZE = 20`) |
| `MAX_PAGE_SIZE = 9` | 9 | No match -- todo-specific cap |

For the three `4000` constants: `todo.command.ts` should import `DISCORD_TEXT_INPUT_MAX` and
use it at every site. The three local `const` declarations can be removed.

For `DEFAULT_PAGE_SIZE = 9` and `MAX_PAGE_SIZE = 9`: these are todo-specific and should be
added to `src/config/pagination.ts` with descriptive names:
```typescript
export const TODO_DEFAULT_PAGE_SIZE = 9;
export const TODO_MAX_PAGE_SIZE     = 9;
```

**Solution:** Remove the five local declarations, add the two pagination constants, and update
all call sites in `todo.command.ts` to import from config.

**Verification:** `grep -n "MAX_ISSUE_BODY\|MAX_TEXT_DISPLAY_CONTENT\|MAX_COMPONENT_DISPLAYABLE"
src/commands/todo.command.ts` should show only import-path lines, no `const` declarations.

---

### 8. Create `safeIgnore()` utility to replace `.catch(() => {})` noise

**Problem:** 220 instances of `.catch(() => {})` throughout the codebase. This silently swallows
errors with no indication that suppression is intentional vs. an oversight. There is also no
central place to instrument or audit which Discord operations are being silenced.

Top contributors:
- `src/events/MessageReactionAdd.command.ts` -- 32 instances
- `src/commands/gamedb/gamedb-completion.command.ts` -- 24 instances
- `src/commands/now-playing.command.ts` -- 22 instances
- `src/commands/collection/collection-view.command.ts` -- 19 instances

**Solution:** Add to `src/utilities/DelayUtils.ts` (or a new `src/utilities/AsyncUtils.ts`):
```typescript
/**
 * Attaches a no-op catch handler to a promise, explicitly marking it as
 * fire-and-forget. Errors are intentionally discarded.
 */
export function safeIgnore(promise: Promise<unknown>): void {
  promise.catch(() => {});
}
```

Replace the highest-density files first (`MessageReactionAdd`, `now-playing`,
`collection-view`). A full sweep of all 220 sites can span multiple PRs.

Using the named utility makes intentional suppression visible in code review and provides a
single hook point if logging is added later.

**Verification:** After migrating a file, `grep -n "\.catch(() => {})" <file>` should return
zero hits.

---

## What NOT to do in this pass

- Do not attempt a generic embed factory. The 57+ `EmbedBuilder` chains vary too widely.
- Do not sweep all 220 `.catch(() => {})` sites in a single PR; migrate the top-density files
  and open follow-ons.
- Do not sweep all 155 remaining `customId.split` sites in a single PR; do top 3 files per PR.
- Do not touch `MAX_COMMENT_PREVIEW_LENGTH = 500` or `MAX_TODO_IMAGES_PER_VIEW = 10` in
  `todo.command.ts` -- these are todo-specific with no reasonable shared parallel.
- Do not consolidate `console.error` calls into `DiscordConsoleLogger` in this pass -- that
  is a separate audit requiring understanding of each call site's context. Defer to pass 5.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific grep check listed in each section above.
