# Plan: Shared Utilities & Standardization Pass

## Context

A three-agent codebase scan identified several patterns that are copy-pasted across 5-40+ files
with no central home. The goal is to create focused new utilities and constants that eliminate
the most common duplications, then update all call sites. No behavior changes -- pure
extraction and centralization.

---

## Work Items (Ordered by ROI)

### 1. Owner-check utility + error message constant

**Problem:** 30+ interaction handlers repeat this exact block:
```typescript
if (interaction.user.id !== ownerId) {
  await safeReply(interaction, buildTextReply("This list isn't for you.", true));
  return;
}
```
It also creates a dead-code `return` issue: callers still need the guard to short-circuit.

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
export const OWNER_ONLY_MESSAGE = "This list isn't for you.";

/** Returns true and replies ephemerally if user is not the owner. */
export async function replyIfNotOwner(
  interaction: AnyRepliable,
  ownerId: string,
): Promise<boolean> {
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply(OWNER_ONLY_MESSAGE, true));
    return true;
  }
  return false;
}
```

Call sites: replace `if (interaction.user.id !== ownerId) { ... return; }` with
`if (await replyIfNotOwner(interaction, ownerId)) return;`

Key files to update:
- `src/commands/game-completion/completion-pagination.service.ts` (lines 44, 86)
- `src/commands/gamedb-admin.command.ts` (lines ~1730, 1767, 1799, 1871)
- `src/commands/game-journal.command.ts` (15+ checks)
- `src/commands/avatar-history.command.ts` (lines ~337, 379, 415)
- `src/commands/completion-edit.service.ts` (lines ~44, 74, 94, 256)
- `src/commands/giveaway.command.ts` (lines ~612, 693)

---

### 2. `safeDeferUpdateOrBail()` wrapper

**Problem:** 15+ pagination/component handlers repeat:
```typescript
try {
  await safeDeferUpdate(interaction);
} catch {
  return;
}
```

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
/** Defers the update. Returns false if deferral failed (caller should return). */
export async function safeDeferUpdateOrBail(interaction: AnyRepliable): Promise<boolean> {
  try {
    await safeDeferUpdate(interaction);
    return true;
  } catch {
    return false;
  }
}
```

Call sites: replace the try/catch block with `if (!await safeDeferUpdateOrBail(interaction)) return;`

Key files to update:
- `src/commands/game-completion/completion-pagination.service.ts` (lines ~54-58, 96-100)
- All pagination handlers in `src/commands/game-journal.command.ts`
- `src/commands/completion-edit.service.ts`
- Any other file with the same try/catch pattern (grep: `await safeDeferUpdate` near `catch { return }`)

---

### 3. `deferWithShowInChat()` helper

**Problem:** 40+ command handlers repeat:
```typescript
const ephemeral = !showInChat;
await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });
```
Some variants use `ephemeralFlag(ephemeral)` instead of `buildComponentsV2Flags(ephemeral)`.

**Solution:** Add to `src/functions/InteractionUtils.ts`:
```typescript
/** Defers reply with ephemeral controlled by the showInChat option. */
export async function deferWithShowInChat(
  interaction: AnyRepliable,
  showInChat: boolean | null | undefined,
): Promise<void> {
  const ephemeral = !showInChat;
  await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });
}
```

Key files to update (representative -- grep for full list):
- `src/commands/round.command.ts` (lines ~27-31)
- `src/commands/hltb.command.ts` (lines ~64-74)
- `src/commands/avatar-history.command.ts` (lines ~198-220)
- `src/commands/mp-info.command.ts` (lines ~262-313)
- `src/commands/game-completion.command.ts` (lines ~312-331)
- `src/commands/profile.command.ts` (lines ~324-334)
- `src/commands/giveaway.command.ts` (lines ~530-551)

---

### 4. `SHOW_IN_CHAT_DESCRIPTION` constant

**Problem:** The string `"Show in chat (public) instead of ephemeral"` appears verbatim in 8
command files as a slash-command option description.

**Solution:** Add to `src/functions/InteractionUtils.ts` (or a new
`src/config/commandOptions.ts` if it grows):
```typescript
export const SHOW_IN_CHAT_DESCRIPTION = "Show in chat (public) instead of ephemeral";
```

Files to update:
- `src/commands/avatar-history.command.ts:198`
- `src/commands/todo.command.ts:1325`
- `src/commands/giveaway.command.ts:530`
- `src/commands/gamedb-admin.command.ts` (lines 446, 589, 1541, 1596)
- `src/commands/nominate.command.ts:290`

---

### 5. `isPositiveInt()` validation utility

**Problem:** `Number.isInteger(x) && x > 0` guard appears 20+ times in commands and classes,
always with a different error message thrown inline. `now-playing.command.ts` alone has 10+
instances.

**Solution:** Add `src/utilities/ValidationUtils.ts`:
```typescript
export function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Throws with the given label if value is not a positive integer. */
export function requirePositiveInt(value: unknown, label = "ID"): number {
  if (!isPositiveInt(value)) throw new Error(`Invalid ${label}.`);
  return value as number;
}
```

Key files to update (representative):
- `src/commands/now-playing.command.ts` (10+ identical checks)
- `src/commands/game-completion/completion-add.service.ts` (lines ~252, 265)
- `src/commands/game-completion/completion-delete.service.ts` (line ~20)
- `src/commands/admin/round-setup-wizard.utils.ts` (lines ~36, 52, 250)
- `src/commands/superadmin.command.ts` (line ~639)
- `src/commands/suggestion.command.ts` (line ~130)
- `src/classes/UserGameCollection.ts`, `src/classes/Thread.ts`

---

### 6. Move raw SQL out of `SetPresence.ts`

**Problem:** `src/functions/SetPresence.ts` embeds raw Oracle SQL strings inline -- the only
utility file that bypasses the standard `src/db/sql/` + class pattern.

**Solution:**
1. Create `src/classes/BotPresenceHistory.ts` with `savePresence()` and
   `getLatestPresenceActivity()` static methods following the same pattern as other classes.
2. Create `src/db/sql/botPresenceHistory.sql.ts` with Oracle SQL entries for INSERT and SELECT.
3. Update `SetPresence.ts` to call `BotPresenceHistory` methods instead of raw `oraMutate`/`oraQuery`.

---

### 7. Standardize inline row mappers in `Member.ts` and `RssFeed.ts`

**Problem:** Some classes define `mapRow` inline inside a method body (inconsistent with the
module-level mapper pattern used by `Game.ts`, `Nomination.ts`, etc.).

**Solution:** Extract inline `mapRow` lambdas to module-level named functions in:
- `src/classes/Member.ts` (lines ~1419, 1494)
- `src/classes/RssFeed.ts` (lines ~161, 179)

No SQL or behavior changes -- purely lifting anonymous functions to module scope.

---

## What NOT to do in this pass

- Do not refactor custom ID parsing into a generic parser. Formats vary enough per command
  that a generic split wrapper would add indirection without clear benefit.
- Do not add a help embed builder abstraction. The help embed duplication is within a single
  file (`help.command.ts`), not cross-file.
- Do not touch CSV import unification -- three import services share surface-level similarity
  but have enough domain-specific branching to warrant individual files.

---

## Verification

After each work item:
1. Run `npx tsc --noEmit` -- must pass with zero errors.
2. Run ESLint (`npx eslint src/`) -- must pass per `eslint.config.ts`.
3. For item 1 (owner check): `grep -rn "This list isn't for you"` -- should return zero hits
   outside `InteractionUtils.ts`.
4. For item 4 (constant): `grep -rn "Show in chat (public)"` -- should return zero hits
   outside the constant definition.
5. For item 5 (validation): `grep -rn "Number.isInteger.*<= 0"` -- count should drop
   significantly (any remaining are intentional divergences).
