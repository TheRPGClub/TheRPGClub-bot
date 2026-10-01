/**
 * Set by docker-compose.preview.yml from scripts/preview/preview.sh, so only the PR
 * preview container sees them. Read once at module load, like TEST_GUILD_ID.
 */
const PREVIEW_PR: string = (process.env.PREVIEW_PR ?? "").trim();
const PREVIEW_SHA: string = (process.env.PREVIEW_SHA ?? "").trim();

const SHORT_SHA_LENGTH = 7;

/**
 * The preview application's name (docs/pr-preview.md). The Playwright conductor runner
 * picks a slash command only from this app's entries, never the test-mode bot's.
 */
export const PREVIEW_BOT_NAME = "RPGClub Bot (preview)";

/** The preview bot's status, naming the PR and commit it was built from. */
export function formatPreviewPresence(pr: string, sha: string): string {
  const shortSha = sha.slice(0, SHORT_SHA_LENGTH);
  return shortSha ? `Testing PR #${pr} (${shortSha})` : `Testing PR #${pr}`;
}

/**
 * The fixed status for this process, or null outside a PR preview. Non-null is the one
 * preview-mode check, so callers never test the environment themselves.
 */
export const PREVIEW_PRESENCE: string | null = PREVIEW_PR
  ? formatPreviewPresence(PREVIEW_PR, PREVIEW_SHA)
  : null;

/**
 * The preview bot's one post in the dev channel once startup completes. The conductor
 * matches it to start a run, so both processes build and read it only through these.
 */
const PREVIEW_READY_PATTERN = /^Ready for testing PR #([1-9]\d*) at ([0-9a-f]{40})$/;

export interface IPreviewReady {
  pr: number;
  sha: string;
}

export function formatPreviewReadyAnnouncement(pr: string | number, sha: string): string {
  return `Ready for testing PR #${pr} at ${sha}`;
}

/** The PR and full head sha an announcement names, or null for any other text. */
export function parsePreviewReadyAnnouncement(content: string): IPreviewReady | null {
  const match = PREVIEW_READY_PATTERN.exec(content.trim());
  if (!match) return null;
  return { pr: Number(match[1]), sha: match[2] };
}

/**
 * The announcement this process posts, or null outside a PR preview. A preview whose
 * sha is not a full commit sha posts nothing, since the conductor could not verify it.
 */
export const PREVIEW_READY_ANNOUNCEMENT: string | null = (() => {
  if (!PREVIEW_PR) return null;
  const text = formatPreviewReadyAnnouncement(PREVIEW_PR, PREVIEW_SHA);
  return parsePreviewReadyAnnouncement(text) ? text : null;
})();
