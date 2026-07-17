import { foldAccentE } from "./GameAutocompleteCache.js";

type IGameTitleAutocompleteEntry = {
  title: string;
  initialReleaseDate?: Date | string | null;
};

type IParseTitleWithYearResult = {
  title: string;
  year: number | null;
  hasYearSuffix: boolean;
};

const UNKNOWN_YEAR_LABEL = "Unknown Year";

export function getReleaseYear(
  game: Pick<IGameTitleAutocompleteEntry, "initialReleaseDate">,
): number | null {
  const releaseDate = game.initialReleaseDate;
  if (!releaseDate) return null;

  const date = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return null;

  return date.getFullYear();
}

export function formatGameTitleWithYear(
  game: IGameTitleAutocompleteEntry,
): string {
  const year = getReleaseYear(game);
  const yearText = year ? String(year) : UNKNOWN_YEAR_LABEL;
  return `${game.title} (${yearText})`;
}

export function parseTitleWithYear(
  input: string,
): IParseTitleWithYearResult {
  const match = input.match(/^(.*)\s\((\d{4}|Unknown Year)\)$/);
  if (!match) {
    return { title: input, year: null, hasYearSuffix: false };
  }

  const baseTitle = match[1].trim();
  const yearToken = match[2];
  if (yearToken === UNKNOWN_YEAR_LABEL) {
    return { title: baseTitle, year: null, hasYearSuffix: true };
  }

  const parsedYear = Number(yearToken);
  if (!Number.isNaN(parsedYear)) {
    return { title: baseTitle, year: parsedYear, hasYearSuffix: true };
  }

  return { title: input, year: null, hasYearSuffix: false };
}

/**
 * Collapses a title to a punctuation/accent-insensitive key so titles that
 * differ only by colon vs. hyphen, curly quotes, or spacing still compare
 * equal (e.g. "X: Definitive Edition" vs "X - Definitive Edition").
 */
export function normalizeTitleKey(title: string): string {
  return foldAccentE(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolves a single unambiguous GameDB match for a user-supplied title.
 * Tries a literal (case-insensitive) title match first, falls back to a
 * punctuation-normalized match, then finally to the sole search result if
 * the search itself was already unambiguous.
 */
export function resolveExactTitleMatch<T extends IGameTitleAutocompleteEntry>(
  candidates: T[],
  searchTerm: string,
): T | null {
  const parsed = parseTitleWithYear(searchTerm);
  const normalizedSearchTerm = parsed.title.trim();
  if (!normalizedSearchTerm) {
    return null;
  }

  const matchesYear = (game: T): boolean => {
    if (parsed.year == null) return true;
    return getReleaseYear(game) === parsed.year;
  };

  const literalMatch = candidates.find(
    (game) => game.title.toLowerCase() === normalizedSearchTerm.toLowerCase() && matchesYear(game),
  );
  if (literalMatch) {
    return literalMatch;
  }

  const searchKey = normalizeTitleKey(normalizedSearchTerm);
  const normalizedMatches = candidates.filter(
    (game) => normalizeTitleKey(game.title) === searchKey && matchesYear(game),
  );
  if (normalizedMatches.length === 1) {
    return normalizedMatches[0] ?? null;
  }

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  return null;
}
