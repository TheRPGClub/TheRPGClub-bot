const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const promptCache = new Map<string, number>();

export function shouldPrompt(threadId: string): boolean {
  const last = promptCache.get(threadId) ?? 0;
  return Date.now() - last > PROMPT_COOLDOWN_MS;
}

export function markPrompted(threadId: string): void {
  promptCache.set(threadId, Date.now());
}

export function getGameReleaseYear(firstReleaseDate: number | null | undefined): string | number {
  if (!firstReleaseDate) return "TBD";
  return new Date(firstReleaseDate * 1000).getFullYear();
}
