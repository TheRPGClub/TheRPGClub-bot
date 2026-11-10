/**
 * Which bot commands and components belong to which Feature (spec api#347). The keys are
 * the API registry's Feature keys. Anything not listed here is never gated: utility, mod,
 * admin and superadmin commands, help, profile, and shared pickers such as `igdb-select`.
 */

/** Top-level slash command or context menu name -> Feature key. */
export const FEATURE_COMMANDS: Readonly<Record<string, string>> = {
  gamedb: "game_index",
  gotm: "voting_gotm",
  // Legacy GOTM aliases only point at /gotm, but they belong to the same Feature.
  nominate: "voting_gotm",
  "nominate-delete": "voting_gotm",
  noms: "voting_gotm",
  vote: "voting_gotm",
  round: "voting_gotm",
  "round-history": "voting_gotm",
  backlog: "backlog",
  collection: "collection",
  "now-playing": "now_playing",
  "Now playing": "now_playing",
  "game-completion": "game_completions",
  "Compare completions": "game_completions",
  "game-journal": "journals",
  giveaway: "giveaways",
  gamegiveaway: "giveaways",
  suggestion: "suggestions",
};

/**
 * Component and modal custom ID prefix -> Feature key. The longest matching prefix wins,
 * so a journal view opened from a Now Playing list (`nowplaying-journal-`) belongs to
 * Journals while the rest of `nowplaying-` belongs to Now Playing.
 */
export const FEATURE_COMPONENT_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["gamedb-search-", "game_index"],
  ["gamedb-action:video:", "game_index"],
  ["gamedb-action:hltb-import:", "game_index"],
  ["gamedb-action:igdb-import:", "game_index"],
  ["gamedb-syn-", "game_index"],

  ["gotm-nom-details:", "voting_gotm"],
  ["nr-gotm-nom-details:", "voting_gotm"],
  ["vote-", "voting_gotm"],
  ["round-history-page:", "voting_gotm"],
  ["modal:round-history:", "voting_gotm"],

  ["gamedb-action:backlog:", "backlog"],
  ["gamedb-backlog-platform", "backlog"],
  ["backlog-", "backlog"],
  ["blm1:", "backlog"],

  ["gamedb-action:collection:", "collection"],
  ["gamedb-collection-", "collection"],
  ["collection-", "collection"],
  ["clf1:", "collection"],
  ["clfm1:", "collection"],

  ["gamedb-action:nowplaying:", "now_playing"],
  ["gamedb-nowplaying-platform-select", "now_playing"],
  ["nowplaying-", "now_playing"],
  ["np-", "now_playing"],

  ["gamedb-completion-", "game_completions"],
  ["comp-", "game_completions"],
  ["completion-", "game_completions"],

  ["game-journal-", "journals"],
  ["gj-", "journals"],
  ["journal-public-close", "journals"],
  ["nowplaying-journal-", "journals"],
  ["nowplaying-view-journal", "journals"],
  ["nowplaying-edit-menu-start-journal", "journals"],
  ["comp-journal-", "journals"],

  ["giveaway-", "giveaways"],

  ["suggestion-", "suggestions"],
  ["todo-review-suggestions", "suggestions"],
];

/**
 * The Feature each kind of automated public post belongs to (the registry's `posts`
 * coverage). Its flag decides where the post goes: the normal channel when Live, the
 * bot-dev channel in Preview, nowhere when Off.
 */
export const POST_FEATURE_KEYS = {
  voting: "voting_gotm",
  completions: "game_completions",
  giveawayHub: "giveaways",
  suggestions: "suggestions",
} as const;
