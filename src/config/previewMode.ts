/**
 * Set by docker-compose.preview.yml from scripts/preview/preview.sh, so only the PR
 * preview container sees them. Read once at module load, like TEST_GUILD_ID.
 */
export const PREVIEW_PR: string = (process.env.PREVIEW_PR ?? "").trim();
export const PREVIEW_SHA: string = (process.env.PREVIEW_SHA ?? "").trim();

export const IS_PREVIEW: boolean = PREVIEW_PR.length > 0;

const SHORT_SHA_LENGTH = 7;

/** The preview bot's status, naming the PR and commit it was built from. */
export function formatPreviewPresence(pr: string, sha: string): string {
  const shortSha = sha.slice(0, SHORT_SHA_LENGTH);
  return shortSha ? `Testing PR #${pr} (${shortSha})` : `Testing PR #${pr}`;
}

/** The fixed status for this process, or null outside a PR preview. */
export const PREVIEW_PRESENCE: string | null = IS_PREVIEW
  ? formatPreviewPresence(PREVIEW_PR, PREVIEW_SHA)
  : null;
