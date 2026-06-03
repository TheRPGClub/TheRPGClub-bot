import Game from "../classes/Game.js";
import { igdbService, type IGDBGame } from "../services/IGDB/IgdbService.js";
import { sanitizeUserInput } from "./InteractionUtils.js";
import {
  buildProgressiveTitleVariants,
  normalizeTitleWithSteps,
} from "./ImportTitleNormalization.js";

export type ImportCandidate = {
  gameId: number;
  title: string;
};

export type ImportMatchConfidence = "EXACT" | "FUZZY";

export function dedupeImportCandidates(candidates: ImportCandidate[]): ImportCandidate[] {
  const seen = new Set<number>();
  const deduped: ImportCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.gameId)) continue;
    seen.add(candidate.gameId);
    deduped.push(candidate);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

export function buildImportMatchConfidence(
  searchTitle: string,
  candidates: ImportCandidate[],
): ImportMatchConfidence | null {
  if (!candidates.length) return null;
  return candidates[0].title.toLowerCase() === searchTitle.toLowerCase() ? "EXACT" : "FUZZY";
}

export function isExactImportTitleMatch(sourceTitle: string, gameDbTitle: string): boolean {
  return normalizeTitleWithSteps(sourceTitle).toLowerCase() ===
    normalizeTitleWithSteps(gameDbTitle).toLowerCase();
}

export function parseImportCandidates(raw: unknown): ImportCandidate[] {
  if (typeof raw !== "string") return [];
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ gameId?: number; title?: string }>;
    return dedupeImportCandidates(
      parsed
        .map((value) => ({
          gameId: Number(value.gameId ?? 0),
          title: String(value.title ?? ""),
        }))
        .filter(
          (value) =>
            Number.isInteger(value.gameId) && value.gameId > 0 && value.title.length > 0,
        ),
    );
  } catch {
    return [];
  }
}

export async function buildImportCandidates(title: string): Promise<ImportCandidate[]> {
  function normalizeCandidate(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreCandidate(search: string, candidate: string): number {
    if (candidate === search) return 100;
    if (candidate.startsWith(search)) return 85;
    if (candidate.includes(search)) return 70;
    const searchWords = search.split(" ").filter(Boolean);
    if (!searchWords.length) return 0;
    const matchedWords = searchWords.filter((word) => candidate.includes(word)).length;
    return Math.floor((matchedWords / searchWords.length) * 60);
  }

  const rawSearch = sanitizeUserInput(title, { preserveNewlines: false });
  const variants = buildProgressiveTitleVariants(rawSearch);
  if (!variants.length) return [];

  for (const variant of variants) {
    const results = await Game.searchGames(variant);
    if (!results.length) continue;

    const normalizedSearch = normalizeCandidate(variant);
    const ranked = results
      .map((game) => ({
        gameId: game.id,
        title: game.title,
        score: scoreCandidate(normalizedSearch, normalizeCandidate(game.title)),
      }))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .filter((entry, index) => entry.score > 0 || index < 3)
      .slice(0, 10)
      .map((entry) => ({ gameId: entry.gameId, title: entry.title }));

    return dedupeImportCandidates(ranked);
  }

  return [];
}

export async function buildImportCandidatesFromMappedIds(
  gameIds: number[],
): Promise<ImportCandidate[]> {
  if (!gameIds.length) return [];
  const uniqueIds = Array.from(
    new Set(gameIds.filter((value) => Number.isInteger(value) && value > 0)),
  );
  if (!uniqueIds.length) return [];
  const games = await Game.getGamesByIds(uniqueIds);
  const byId = new Map(games.map((game) => [game.id, game]));
  const ordered = uniqueIds
    .map((id) => byId.get(id))
    .filter((game): game is NonNullable<typeof game> => Boolean(game))
    .map((game) => ({ gameId: game.id, title: game.title }));
  return dedupeImportCandidates(ordered);
}

export async function searchIgdbWithProgressiveTitleVariants(
  title: string,
  limit: number,
): Promise<IGDBGame[]> {
  const rawSearch = sanitizeUserInput(title, { preserveNewlines: false });
  const variants = buildProgressiveTitleVariants(rawSearch);
  if (!variants.length) return [];

  for (const variant of variants) {
    const results = await igdbService.searchGames(variant, limit);
    if (results.results.length) {
      return results.results;
    }
  }

  return [];
}
