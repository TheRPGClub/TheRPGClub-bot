// Challenges (spec api#376): how much the bot reads from the API at once.

/** Challenges or Runs an autocomplete reads, newest first (one request). */
export const CHALLENGE_AUTOCOMPLETE_READ = 100;
/** Assignment Challenges read when finding the Secret Santa (one request). */
export const CHALLENGE_ASSIGNMENT_READ = 100;
/** Runs read per request when a view needs them all. */
export const CHALLENGE_RUNS_PER_REQUEST = 100;
/** Pages of Runs read at most, so a member or Challenge with many can't stall a reply. */
export const CHALLENGE_RUNS_MAX_REQUESTS = 5;
