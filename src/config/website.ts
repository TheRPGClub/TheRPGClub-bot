// The club website, for links in the bot's posts and DMs. The API sends IDs, never
// absolute URLs, so the bot builds them here (spec api#376, Orchestrator note).

/** The production website, used when `WEBSITE_BASE_URL` is not set. */
export const DEFAULT_WEBSITE_BASE_URL = "https://the-rpg-club-www.vercel.app";

/** The base URL from the environment's value: trimmed, no trailing slash, else production. */
export function resolveWebsiteBaseUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/\S+$/i.test(value) ? value : DEFAULT_WEBSITE_BASE_URL;
}

/** Read once at module load; `WEBSITE_BASE_URL` overrides it (a test or staging site). */
export const WEBSITE_BASE_URL: string = resolveWebsiteBaseUrl(process.env.WEBSITE_BASE_URL);

/** A Challenge's page, which shows the viewer's own Run first. */
export function challengePageUrl(challengeId: number): string {
  return `${WEBSITE_BASE_URL}/challenges/${challengeId}`;
}

/** A member's profile page. */
export function memberProfileUrl(userId: string): string {
  return `${WEBSITE_BASE_URL}/members/${encodeURIComponent(userId)}`;
}

/** A Lore Entry's page on the website (the Club Codex, spec api#397). */
export function loreEntryPageUrl(entryId: number): string {
  return `${WEBSITE_BASE_URL}/codex/lore/${entryId}`;
}

/** Club History, the whole record (public). */
export function codexHistoryUrl(): string {
  return `${WEBSITE_BASE_URL}/codex/history`;
}

/** Every Fun Fact. */
export function codexFunFactsUrl(): string {
  return `${WEBSITE_BASE_URL}/codex/fun-facts`;
}
