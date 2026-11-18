import { CODEX_FUN_FACT_PREFIX } from "../config/customIdPrefixes.js";

// Club Codex custom IDs (spec api#397). Each holds what it acts on, and the clicking member
// is who acts, so every button still works after a bot restart.

/**
 * The /codex fun-fact delete question's buttons, each on a Fun Fact ID: `delete` (deletes
 * it) and `keep` (leaves it be). Each custom ID is `<prefix>:<action>:<ID>`.
 */
export const CODEX_FUN_FACT_ACTIONS = ["delete", "keep"] as const;

export type CodexFunFactAction = (typeof CODEX_FUN_FACT_ACTIONS)[number];

export function buildCodexFunFactId(action: CodexFunFactAction, factId: number): string {
  return `${CODEX_FUN_FACT_PREFIX}:${action}:${factId}`;
}

export function parseCodexFunFactId(
  customId: string,
): { action: CodexFunFactAction; factId: number } | null {
  const [prefix, action, raw, ...rest] = customId.split(":");
  const factId = Number(raw);
  if (
    prefix !== CODEX_FUN_FACT_PREFIX || rest.length ||
    !Number.isInteger(factId) || factId < 1
  ) {
    return null;
  }
  const known = (CODEX_FUN_FACT_ACTIONS as readonly string[]).includes(action ?? "");
  return known ? { action: action as CodexFunFactAction, factId } : null;
}

/** The Club Codex entry ID an autocompleted option holds, or null when it is not one. */
export function parseCodexEntryOption(raw: string | undefined): number | null {
  const id = Number((raw ?? "").trim());
  return (raw ?? "").trim() && Number.isInteger(id) && id > 0 ? id : null;
}
