# Plan: Shared Utilities & Standardization Pass 2

## Context

Pass 1 extracted owner-check guards, deferral wrappers, the `showInChat` defer helper, the
`SHOW_IN_CHAT_DESCRIPTION` constant, `ValidationUtils.ts`, `BotPresenceHistory`, and row-mapper
standardization. This pass targets the next tier of replication identified by a fresh codebase
scan: embed colors, modal input extraction, interaction state guards, delay utilities, error
logging, hardcoded IDs, and pagination constants.

No behavior changes -- pure extraction and centralization.

---

## Work Items (Ordered by ROI)

### 1. `src/config/colors.ts` -- centralize embed colors

**Problem:** Six distinct hex color values are hardcoded across 11+ files with no shared names.
The same value means different things in different contexts (e.g., `0x0099ff` is used for both
informational and primary embeds):

| Constant name | Hex | Current locations |
|---|---|---|
| `COLOR_PRIMARY` | `0x0099ff` | gamedb-admin.command.ts, hltb.command.ts, GotmEntryEmbeds.ts, GamedbAuditService.ts |
| `COLOR_SUCCESS` | `0x2ecc71` | giveaway.command.ts:130, gamedb-admin.command.ts, GuildMemberAdd.command.ts, GamedbAuditService.ts, Starboard.command.ts |
| `COLOR_INFO` | `0x3498db` | AvatarLogUtils.ts:121, DiscordConsoleLogger.ts |
| `COLOR_WARNING` | `0xf39c12` | GuildMemberRemove.command.ts:71, DiscordConsoleLogger.ts:13 |
| `COLOR_ERROR` | `0xe74c3c` | (audit fail path in sql-health-check.service.ts) |
| `COLOR_HIGHLIGHT` | `0xFFA500` | gamedb-admin.command.ts:1146 |

**Solution:** Create `src/config/colors.ts`:
```typescript
export const COLOR_PRIMARY   = 0x0099ff;
export const COLOR_SUCCESS   = 0x2ecc71;
export const COLOR_INFO      = 0x3498db;
export const COLOR_WARNING   = 0xf39c12;
export const COLOR_ERROR     = 0xe74c3c;
export const COLOR_HIGHLIGHT = 0xffa500;
```

Key files to update (replace hardcoded hex with named constant):
- `src/commands/giveaway.command.ts:130`
- `src/commands/hltb.command.ts:149`
- `src/commands/gamedb-admin.command.ts:1146, 1318, 1352, 1402, 1426, 1451, 1508`
- `src/utilities/AvatarLogUtils.ts:121`
- `src/utilities/DiscordConsoleLogger.ts:11-15`
- `src/services/GamedbAuditService.ts:513, 527, 548, 557`
- `src/functions/GotmEntryEmbeds.ts:167, 189`
- `src/events/GuildMemberAdd.command.ts:34`
- `src/events/GuildMemberRemove.command.ts:71`
- `src/events/Starboard.command.ts:87`
- `src/commands/admin/round-setup-wizard.service.ts:284`
- `src/commands/admin/sql-health-check.service.ts:51`

**Verification:** `grep -rn "0x0099ff\|0x2ecc71\|0x3498db\|0xf39c12\|0xFFA500" src/` should
return zero hits after the pass.

---

### 2. `getModalField()` -- strip repeated modal input extraction

**Problem:** `stripModalInput(interaction.fields.getTextInputValue(INPUT_ID))` appears 25+ times
across giveaway, todo, gamedb-completion, suggestion, round-history, game-journal, and
gamedb-admin commands. Every call site manually pairs `stripModalInput` with `getTextInputValue`.

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
/**
 * Retrieves a modal text input and strips surrounding whitespace.
 * Drop-in for: stripModalInput(interaction.fields.getTextInputValue(id))
 */
export function getModalField(
  interaction: ModalSubmitInteraction,
  customId: string,
): string {
  return stripModalInput(interaction.fields.getTextInputValue(customId));
}
```

Key files to update (representative -- grep for full list):
- `src/commands/giveaway.command.ts:973-977, 988`
- `src/commands/now-playing.command.ts:932, 935`
- `src/commands/gamedb/gamedb-csv-import.command.ts:717, 785`
- `src/commands/gamedb/gamedb-completion.command.ts:441, 452, 462, 535`
- `src/commands/gamedb/gamedb-thread.command.ts:253, 256`
- `src/commands/suggestion.command.ts:344, 511-512`
- `src/commands/todo.command.ts:1864-1865, 1867, 1953, 2049-2050, 2052, 2158, 2244, 2329`
- `src/commands/round-history.command.ts:571, 574-576`
- `src/commands/gamedb-admin.command.ts:944, 979, 1636, 1821`
- `src/commands/game-journal.command.ts:1027, 1031, 1063, 1067`

**Verification:** `grep -rn "stripModalInput(interaction.fields" src/` should return zero hits
after the pass.

---

### 3. `isInteractionSettled()` / `canSafeReply()` -- interaction state guards

**Problem:** The pattern `if (interaction.deferred || interaction.replied)` (and its inverse)
appears 13+ times as a manual guard before reply/followup calls.

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
/** True if the interaction has already been deferred or replied to. */
export function isInteractionSettled(
  interaction: RepliableInteraction,
): boolean {
  return interaction.deferred || interaction.replied;
}

/** True if the interaction can still receive an initial reply or deferral. */
export function canSafeReply(interaction: RepliableInteraction): boolean {
  return !interaction.deferred && !interaction.replied;
}
```

Key files to update:
- `src/commands/game-completion/completion-add.service.ts:97, 239, 442`
- `src/commands/game-completion/completion-edit.service.ts:60`
- `src/commands/game-completion/completionator-workflow.service.ts:536`
- `src/commands/game-completion/completionator-ui.service.ts:661`
- `src/commands/superadmin.command.ts:467, 720`
- `src/commands/gamedb/gamedb-thread.command.ts:124`
- `src/commands/collection/collection-steam-import.command.ts:167-168`
- `src/commands/collection/collection-csv-import.command.ts:158-159`
- `src/commands/igdb-select.handler.ts:15, 23`
- `src/commands/now-playing.command.ts:361`
- `src/functions/CompletionHelpers.ts:275`
- `src/services/IGDB/IgdbSelectService.ts:194, 229`

**Verification:** `grep -rn "interaction.deferred || interaction.replied" src/` should return
zero hits after the pass.

---

### 4. `src/utilities/DelayUtils.ts` -- centralize sleep/delay patterns

**Problem:** `new Promise((resolve) => setTimeout(resolve, ms))` is inlined in 6+ files.
`GamedbAuditService.ts` alone has seven hardcoded `1000` ms delays. Some services have local
`sleep()` helpers (e.g., `IgdbScanService.ts:26`) that are not exported.

**Solution:** Create `src/utilities/DelayUtils.ts`:
```typescript
export const AUDIT_STEP_DELAY_MS = 1000;
export const IGDB_RATE_LIMIT_DELAY_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Remove local `sleep` definitions from:
- `src/services/IGDB/IgdbScanService.ts:26`
- `src/services/SteamApiService.ts` (delay utility)
- `src/scripts/import-igdb-platforms.ts:14`

Replace all inline `new Promise((resolve) => setTimeout(resolve, ...))` patterns.

Replace the seven hardcoded `1000` delays in `src/services/GamedbAuditService.ts:85, 164, 236,
307, 375, 385, 473` with `await sleep(AUDIT_STEP_DELAY_MS)`.

---

### 5. `src/config/pagination.ts` -- centralize page size constants

**Problem:** Seven commands each define their own local page size constant with inconsistent
naming. There is no canonical default.

**Solution:** Create `src/config/pagination.ts`:
```typescript
export const DEFAULT_PAGE_SIZE          = 20;
export const AVATAR_HISTORY_PAGE_SIZE   = 20;
export const AVATAR_ALL_VIEW_PAGE_SIZE  = 50;
export const ROUND_HISTORY_PAGE_SIZE    = 10;
export const AUDIT_PAGE_SIZE            = 10;
export const SYNONYM_LIST_PAGE_SIZE     = 25;
export const JOURNAL_LIST_PAGE_SIZE     = 20;
export const JOURNAL_ALL_PAGE_SIZE      = 50;
export const COMPLETION_PAGE_SIZE       = 20;
export const MP_INFO_PAGE_SIZE          = 25;
export const CLAIM_MENU_CHUNK_SIZE      = 25;
```

Files to update (remove local constant, import from config):
- `src/commands/avatar-history.command.ts:44-45`
- `src/commands/profile.command.ts:47`
- `src/commands/mp-info.command.ts:41-42`
- `src/commands/gamedb-admin.command.ts:68, 84`
- `src/commands/round-history.command.ts:52`
- `src/commands/game-journal.command.ts:73-74`
- `src/commands/giveaway.command.ts:75`

---

### 6. `src/config/roles.ts` -- move hardcoded role ID out of command file

**Problem:** `const MEMBER_ROLE_ID = "747520789003239530"` is defined locally in
`src/commands/giveaway.command.ts:59`. Role IDs belong in config per project conventions.

**Solution:** Create `src/config/roles.ts` (if it does not exist) or add to the existing roles
config file:
```typescript
export const MEMBER_ROLE_ID = "747520789003239530";
```

Update `src/commands/giveaway.command.ts` to import from config.

**Verification:** `grep -rn "747520789003239530" src/` should return one hit (the config file).

---

### 7. Standardize `formatStructuredLog()` -- extract from generate-vote-image.command.ts

**Problem:** `src/commands/generate-vote-image.command.ts` defines a `formatStructuredLog()`
function locally (line ~54) but it is not used anywhere else. The broader codebase has 40+
`console.error()` calls with ad-hoc `[context]` prefixes (e.g., `[Journal]`, `[collection list]`)
that would benefit from the same structure.

**Solution:**
1. Move `formatStructuredLog()` to `src/utilities/LogUtils.ts` (create if needed).
2. Export it for use across the codebase.
3. Update `generate-vote-image.command.ts` to import from `LogUtils`.
4. (Optional follow-on) Replace the most common ad-hoc `console.error('[X]', ...)` patterns in
   `src/commands/collection/collection-view.command.ts` and `src/commands/now-playing.command.ts`
   as a proof-of-concept. Do not attempt a full sweep in this pass -- error logging unification
   is large enough to be its own pass.

---

### 8. Harden hardcoded channel references in non-config files

**Problem:** Two non-config files embed raw channel IDs or channel references as string literals:
- `src/commands/help.command.ts:264` -- inline `<#1461101188572254351>` in help text
- `src/commands/admin/voting-admin.service.ts:94` -- inline `channel:#announcements` string

**Solution:** Confirm whether these IDs are already in `src/config/channels.ts`. If yes,
replace the inline literals with the existing constant (formatted as a Discord mention where
needed: `` `<#${CHANNEL_ID}>` ``). If no, add the constant and then replace.

**Verification:** `grep -rn "1461101188572254351" src/` should return one hit (channels.ts).

---

## What NOT to do in this pass

- Do not add a generic embed builder factory. The 57 `new EmbedBuilder()` chains vary too much
  per use case; a factory would save few lines while adding an abstraction layer with no clear
  contract. Evaluate in pass 3 once color constants are in place and patterns are clearer.
- Do not unify the 188 `ActionRowBuilder` usages. Custom ID schemes differ significantly per
  command; a generic row builder would require a union of all possible formats.
- Do not touch the `isAdmin()` import path inconsistency in this pass -- it requires confirming
  the canonical source file before touching 30+ call sites.
- Do not attempt a full error-logging standardization sweep. Items 7 scopes it to a proof of
  concept only; the full sweep is pass 3 work.

---

## Verification (per item)

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run `npm run lint` -- must pass with zero violations.
3. Run the item-specific grep check listed in each section above.
