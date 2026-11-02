/**
 * Repos a Suggestion can be approved into (RpgClubSuggestion::TARGET_REPOS in the API).
 * The API opens the GitHub issue there; any other value is a 422.
 */
export const SUGGESTION_TARGET_REPOS = [
  { value: "TheRPGClub/TheRPGClub-bot", label: "Bot", description: "The Discord bot" },
  { value: "TheRPGClub/TheRPGClub-api", label: "API", description: "The API" },
  { value: "TheRPGClub/TheRPGClub-www", label: "Website", description: "The website" },
] as const;

export type SuggestionTargetRepo = (typeof SUGGESTION_TARGET_REPOS)[number]["value"];

export const DEFAULT_SUGGESTION_TARGET_REPO: SuggestionTargetRepo = "TheRPGClub/TheRPGClub-bot";

export function isSuggestionTargetRepo(value: unknown): value is SuggestionTargetRepo {
  return SUGGESTION_TARGET_REPOS.some((repo) => repo.value === value);
}
