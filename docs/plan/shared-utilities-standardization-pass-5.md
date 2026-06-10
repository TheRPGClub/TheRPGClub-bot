# Plan: Shared Utilities & Standardization Pass 5

## Context

Passes 1-4 shipped: colors, DateFormatUtils, access-denied messages, textLimits.ts,
parseCustomIdSegments, isAdmin/isModerator, parsePageNumber, isValidPlaytimeHours,
pagination constants, roles, LogUtils, channel constants, truncateWithEllipsis,
remaining slice(0,100) sweeps, DISCORD_AUTOCOMPLETE_DESC_MAX, DISCORD_EMBED_FIELD_VALUE_MAX,
safeIgnore() (top-density files), role name constants, and giveaway/todo constant alignment.

This pass picks up what pass 4 deferred, closes the safeIgnore migration, adds new shared
builders/factories, and migrates the command visibility default from ephemeral to public.

No behavior changes except item 11 (explicit default-flip request).

---

## Work Items (Ordered by ROI)

### 1. Route ad-hoc `console.error` calls through `DiscordConsoleLogger` / `formatStructuredLog`

**Problem:** 237 `console.error()` calls exist outside of `DiscordConsoleLogger.ts`. Pass 4
explicitly deferred this sweep. The calls use ad-hoc `[Context]` prefixes with no consistent
format, making log aggregation and filtering difficult.

Heaviest contributors:
- `src/commands/game-completion/completionator-handlers.service.ts` -- 12+ inline errors
- `src/commands/game-completion/completionator-workflow.service.ts` -- 10+
- `src/commands/collection/collection-view.command.ts` -- 15+ (proof-of-concept noted in pass 2)
- `src/commands/now-playing.command.ts` -- 10+

**Solution:** Route errors through `formatStructuredLog()` (already in `LogUtils.ts`) then
`console.error()`, or through a new `logError(context, error)` wrapper in `LogUtils.ts`.
Sweep files in descending call-count order; one PR per 3-4 files.

The `[Unexpected customId]` pattern (item 13 below) should be absorbed into this effort.

**Verification:** After each file, `grep -n "console\.error" <file>` should show only
structured calls using `formatStructuredLog` or the new `logError` wrapper.

---

### 2. Complete `safeIgnore()` sweep for remaining `.catch(() => {})` sites

**Problem:** Pass 4 introduced `safeIgnore()` and migrated the top-density files. 148
instances of `.catch(() => {})` remain across the codebase. These unnamed suppressions make
intentional vs. accidental error swallowing indistinguishable in code review.

Top remaining contributors (estimate; verify with grep):
- `src/events/MessageReactionAdd.command.ts` -- if not yet migrated
- `src/commands/gamedb/gamedb-completion.command.ts`
- `src/commands/collection/collection-view.command.ts`
- `src/commands/superadmin.command.ts`

**Solution:** For each remaining `.catch(() => {})`, replace with `safeIgnore(promise)`.
Where the suppression is not clearly intentional, add a brief comment or escalate to a
`console.error` (see item 1).

**Verification:** `grep -rn "\.catch(() => {})" src/` should return zero hits.

---

### 3. Extract shared `chunk<T>()` utility to `ArrayUtils.ts`

**Problem:** Two local inline chunk functions exist in unrelated files with no shared home:

- `src/commands/mp-info.command.ts:93` -- `function chunkIds(ids: string[], size: number): string[][]`
- `src/commands/profile.command.ts:137` -- `function chunkOptions<T>(items: T[], size: number): T[][]`

Both implement identical logic. Any new paginated feature would add a third copy.

**Solution:** Create `src/utilities/ArrayUtils.ts`:
```typescript
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
```

Remove the two local functions and update their call sites to import from `ArrayUtils.ts`.

**Verification:** `grep -rn "function chunk\|function chunkIds\|function chunkOptions" src/`
should return zero hits (excluding `ArrayUtils.ts`).

---

### 4. Add select menu option builder helper to `uiComponents.ts`

**Problem:** Across 10+ commands, options for `StringSelectMenuBuilder` are built with near-
identical inline `.map()` transforms:
```typescript
items.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((x) => ({
  label: x.title.slice(0, DISCORD_SELECT_LABEL_MAX),
  value: String(x.id),
  description: x.platform?.slice(0, 95),
}))
```
The shape varies slightly (description present/absent, value format) but the label-truncation
and options-cap boilerplate is universal.

**Files:** `now-playing.command.ts`, `nominate.command.ts`, `hltb.command.ts`,
`game-completion/completion-add.service.ts`, `game-completion/completion-platform.service.ts`,
`superadmin.command.ts` and others.

**Solution:** Add to `src/functions/uiComponents.ts`:
```typescript
export interface SelectOptionInput {
  label: string;
  value: string;
  description?: string;
}

export function buildSelectOptions(
  inputs: SelectOptionInput[],
  maxOptions = DISCORD_SELECT_OPTIONS_MAX,
): StringSelectMenuOptionBuilder[] {
  return inputs
    .slice(0, maxOptions)
    .map((item) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(item.label.slice(0, DISCORD_SELECT_LABEL_MAX))
        .setValue(item.value)
        .setDescription(item.description?.slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX) ?? ""),
    );
}
```

Migrate the highest-traffic call sites first.

**Verification:** After migrating a file, it should contain no inline `.map()` that constructs
select option literal objects -- only `buildSelectOptions()` calls.

---

### 5. Add user/member safe-fetch helpers to `InteractionUtils.ts`

**Problem:** `users.fetch(id).catch(() => null)` and `members.fetch(id).catch(() => null)`
appear in at least 8 locations across 5 files with no shared wrapper:

- `src/commands/avatar-history.command.ts:134, 347, 417`
- `src/commands/game-journal.command.ts:654, 686, 779`
- `src/commands/mp-info.command.ts:346`
- `src/commands/superadmin.command.ts:590, 599, 621`

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
export async function safeUserFetch(
  client: Client,
  userId: string,
): Promise<User | null> {
  return client.users.fetch(userId).catch(() => null);
}

export async function safeMemberFetch(
  guild: Guild,
  userId: string,
): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}
```

Update all 8+ call sites.

**Verification:** `grep -rn "\.fetch(.*\.catch(() => null)" src/` should return zero hits.

---

### 6. Extract modal text input row builder helper

**Problem:** 43 `new ActionRowBuilder<TextInputBuilder>()` constructions exist, all following
the same shape:
```typescript
new ActionRowBuilder<TextInputBuilder>().addComponents(
  new TextInputBuilder()
    .setCustomId(CUSTOM_ID)
    .setLabel("Label")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200),
)
```

Changing min/max length or required defaults means touching each builder individually.

**Files include:** `gamedb-admin.command.ts`, `giveaway.command.ts`,
`game-journal.command.ts`, `suggestion.command.ts`, `todo.command.ts` and others.

**Solution:** Add to `src/functions/uiComponents.ts`:
```typescript
export interface ModalTextInputOptions {
  customId: string;
  label: string;
  style?: TextInputStyle;
  required?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

export function buildTextInputRow(
  options: ModalTextInputOptions,
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(options.customId)
    .setLabel(options.label)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setRequired(options.required ?? true);
  if (options.placeholder != null) input.setPlaceholder(options.placeholder);
  if (options.minLength != null) input.setMinLength(options.minLength);
  if (options.maxLength != null) input.setMaxLength(options.maxLength);
  if (options.value != null) input.setValue(options.value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}
```

Migrate highest-density files first.

**Verification:** After migrating a file, it should contain no `new ActionRowBuilder<TextInputBuilder>()` -- only `buildTextInputRow()` calls.

---

### 7. Adopt Discord.js mention utilities over inline template literals

**Problem:** 50+ instances of `` `<@${userId}>` `` and 25+ instances of `` `<#${channelId}>` ``
appear as inline template literals. Discord.js exports `userMention()`, `channelMention()`,
and `roleMention()` as first-class utilities that accomplish the same thing with a named call.
Currently only 2 files use the Discord.js built-ins.

**Files:** `avatar-history.command.ts`, `profile.command.ts`, `create-thread.command.ts`,
`rss.command.ts`, `mp-info.command.ts`, event handlers, and others.

**Solution:** Import `userMention`, `channelMention`, `roleMention` from `discord.js` and
replace each inline template literal. No behavior change -- the output strings are identical.

```typescript
// Before
`<@${userId}>`
// After
userMention(userId)
```

**Verification:**
```
grep -rn '<@\${' src/
grep -rn '<#\${' src/
grep -rn '<&\${' src/
```
All should return zero hits after the pass.

---

### 8. Extract ButtonBuilder factories for common action patterns

**Problem:** 190 `new ButtonBuilder()` instances exist. The most repeated patterns are
add/edit/delete/confirm/cancel actions whose label, style, and emoji follow clear conventions
but are constructed inline each time. A consistent factory reduces typos in styles
(e.g., using Primary where Danger was intended).

Common patterns observed in:
- `src/commands/game-journal.command.ts`
- `src/commands/collection/collection-list.service.ts`
- `src/commands/game-completion/completion-edit.service.ts`
- `src/services/GiveawayHubService.ts`

**Solution:** Add to `src/functions/uiComponents.ts`:
```typescript
type ButtonAction = "add" | "edit" | "delete" | "confirm" | "cancel" | "close";

export function buildActionButton(
  action: ButtonAction,
  customId: string,
  label?: string,
): ButtonBuilder {
  const defaults: Record<ButtonAction, { label: string; style: ButtonStyle }> = {
    add:     { label: "Add",     style: ButtonStyle.Success  },
    edit:    { label: "Edit",    style: ButtonStyle.Primary  },
    delete:  { label: "Delete",  style: ButtonStyle.Danger   },
    confirm: { label: "Confirm", style: ButtonStyle.Success  },
    cancel:  { label: "Cancel",  style: ButtonStyle.Secondary },
    close:   { label: "Close",   style: ButtonStyle.Secondary },
  };
  const d = defaults[action];
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label ?? d.label)
    .setStyle(d.style);
}
```

Migrate the highest-density command files first.

**Verification:** After migrating a file, audit that no `new ButtonBuilder()` uses hardcoded
label/style combos matching the factory -- only `buildActionButton()` calls.

---

### 9. Sweep remaining inline truncation sites to use `truncateWithEllipsis()`

**Problem:** Pass 4 adds `truncateWithEllipsis()` to `ValidationUtils.ts` and migrates the
four sites it identified. Additional inline truncation patterns exist beyond those four:

- `value.slice(0, MAX - 3) + "..."` variants in embed/component builders
- Template literal truncation in `suggestion.command.ts` and `admin/round-setup-wizard.service.ts`

**Solution:** Grep for remaining `+ "..."` and `+ '...'` concatenations in source:
```
grep -rn '+ "\.\.\."' src/
grep -rn "+ '\.\.\.'" src/
```
For each hit, replace with `truncateWithEllipsis(text, maxLength)`.

**Verification:** Both greps should return zero hits after the pass.

---

### 10. Add common "not found" and "nothing to show" response message constants

**Problem:** Scattered one-off "not found" messages appear inline across commands with no
consistency. The access-denied constants (pass 3) set the pattern; this extends it to the
next tier of repeated strings.

Common patterns observed:
- `"No results found."` / `"No games found."`
- `"Nothing to display."`
- `"Could not find that game."` / `"Game not found."`

**Solution:** Add to `src/functions/InteractionUtils.ts` (near existing `ACCESS_DENIED_*`):
```typescript
export const NO_RESULTS_MESSAGE       = "No results found.";
export const NOTHING_TO_DISPLAY       = "Nothing to display.";
export const GAME_NOT_FOUND_MESSAGE   = "Could not find that game.";
export const USER_NOT_FOUND_MESSAGE   = "Could not find that user.";
```

Sweep each command file replacing inline strings with the matching constant.

**Verification:** `grep -rn '"No results found\.\|Nothing to display\.' src/` should return
zero hits outside `InteractionUtils.ts`.

---

### 11. Flip command visibility default: public-first with `private` boolean param

**Problem:** Commands that expose a visibility option currently use `showInChat: boolean` with
an ephemeral default. The requested new convention is: default to public, with an optional
`private` boolean that makes the reply ephemeral.

This affects:
- The option description constant (`SHOW_IN_CHAT_DESCRIPTION` -- needs a new variant)
- `deferWithShowInChat()` in `InteractionUtils.ts` -- signature changes
- `ephemeralFlag()` helper -- callers change from `!showInChat` to `privateFlag`
- Every command that registers the `show_in_chat` option

**Solution:**
1. Add `PRIVATE_OPTION_DESCRIPTION = "Send reply privately (only visible to you)."` to
   `InteractionUtils.ts`.
2. Add `deferWithPrivateFlag(interaction, privateFlag?: boolean)` -- defaults to `false` (public).
3. Rename the slash-command option from `show_in_chat` to `private` in each affected command.
4. Update all call sites that currently invert `showInChat` to instead pass `privateFlag`
   directly.

Scope each command as its own commit. Do not rename `SHOW_IN_CHAT_DESCRIPTION` (keep for
backward reference until all sites are migrated).

**Verification:** After the pass, `grep -rn "show_in_chat\|showInChat" src/` should return
zero hits.

---

### 12. Extract embed page footer builder to `PaginationUtils.ts`

**Problem:** The `Page X/Y` and `Page X/Y • N total` footer strings are constructed inline
in at least 5 files:

- `src/services/GiveawayHubService.ts:46` -- `` `Page ${page + 1}/${totalPages} • ${totalCount} total` ``
- `src/commands/gamedb-admin.command.ts:1117` -- `` `Page ${page + 1}/${totalPages}` ``
- `src/commands/mp-info.command.ts:152` -- static footer text
- `src/events/GuildBanLog.command.ts:34` -- `ID: ${userId} • ${timestamp}` footer pattern

**Solution:** Add to `src/utilities/PaginationUtils.ts`:
```typescript
export function buildPageFooterText(page: number, totalPages: number, suffix?: string): string {
  const base = `Page ${page + 1}/${totalPages}`;
  return suffix ? `${base} • ${suffix}` : base;
}
```

For the audit-log `ID: X • timestamp` footer pattern, add to `InteractionUtils.ts`:
```typescript
export function buildIdTimestampFooter(id: string, timestamp: string): string {
  return `ID: ${id} • ${timestamp}`;
}
```

**Verification:** `grep -rn "Page \${page" src/` should return zero hits after migration.

---

### 13. Extract "Unexpected customId" log guard to a shared utility

**Problem:** 20+ instances of this verbatim pattern across game-completion service files:
```typescript
if (!segs) { console.error(`Unexpected customId: ${interaction.customId}`); return; }
```
All in component/modal handlers after `parseCustomIdSegments()`. The pattern is identical
in every handler with no variation.

**Files:** `completionator-handlers.service.ts` (6+), `completion-edit.service.ts` (4+),
`completionator-workflow.service.ts`, and others.

**Solution:** Add to `src/utilities/CustomIdUtils.ts`:
```typescript
export function logUnexpectedCustomId(customId: string): void {
  console.error(`Unexpected customId: ${customId}`);
}
```

And a guard helper if the return pattern warrants it:
```typescript
export function assertCustomIdSegments(
  interaction: { customId: string },
  expectedCount: number,
): string[] | null {
  const segs = parseCustomIdSegments(interaction.customId, expectedCount);
  if (!segs) logUnexpectedCustomId(interaction.customId);
  return segs;
}
```

Callers replace `parseCustomIdSegments` + inline error with `assertCustomIdSegments`.

**Verification:** `grep -rn "Unexpected customId" src/` should return zero hits outside
`CustomIdUtils.ts`.

---

### 14. Add `formatLocalNumber()` to `DateFormatUtils.ts`

**Problem:** `.toLocaleString("en-US")` for integer display appears in 5 places across
`collection-overview.service.ts` (3 inline, 1 in a `.map()`). Two additional date-locale
formatting calls appear in `voting-admin.service.ts` and `round-setup-wizard.service.ts`.
None use a shared helper.

**Solution:** Add to `src/functions/DateFormatUtils.ts`:
```typescript
export function formatLocalNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatMonthYear(date: Date, timeZone = "UTC"): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone });
}
```

Update all 7 call sites.

**Verification:** `grep -rn '\.toLocaleString("en-US")' src/` should return zero hits.

---

### 15. Add navigation button row factory to `PaginationUtils.ts`

**Problem:** Paginated commands build prev/next/close navigation button rows inline with
no shared factory. `PaginationUtils.ts` already exports `buildPrevNextButtons()` from an
earlier pass but coverage is incomplete -- at least 15 paginated commands build navigation
rows manually.

Files verified as building nav rows inline:
- `src/commands/avatar-history.command.ts`
- `src/commands/game-journal.command.ts`
- `src/commands/collection/collection-list.service.ts`
- `src/commands/mp-info.command.ts`
- `src/services/GiveawayHubService.ts`
- `src/commands/round-history.command.ts`

**Solution:** Audit `PaginationUtils.ts` to confirm what's already exported, then add
any missing factories for prev/next/jump/close combinations. Migrate inline nav row
construction to the shared factory.

**Verification:** After migrating a file, it should contain no `ButtonBuilder` chains for
prev/next/close navigation -- only `PaginationUtils` factory calls.

---

## What NOT to do in this pass

- Do not attempt a generic embed factory. Still too much variation per use case.
- Do not sweep all 237 `console.error` sites in a single PR -- process 3-4 files per PR.
- Do not sweep all 148 `safeIgnore` sites in a single PR -- process highest-density files first.
- Do not refactor `ButtonBuilder` factory to cover URL buttons or dynamic emoji buttons --
  scope only to the add/edit/delete/confirm/cancel patterns.
- Do not change option names in item 11 all at once -- scope one command per PR or commit.

---

## Verification (all items)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific grep check listed in each section above.
