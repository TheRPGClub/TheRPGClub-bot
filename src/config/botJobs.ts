// The API's bot job queue (website -> Discord). See src/services/BotJobService.ts.

/**
 * How often the bot polls for jobs. The API answers an empty claim from a machine-local
 * flag without touching Postgres, so this pace does not keep Neon awake.
 */
export const BOT_JOB_POLL_INTERVAL_MS = 10 * 1000;
/** Wait after a failed claim (API down or mid-deploy) before polling again. */
export const BOT_JOB_ERROR_BACKOFF_MS = 30 * 1000;
/** Jobs claimed per poll (the API allows 1 to 50). */
export const BOT_JOB_CLAIM_LIMIT = 10;
/** The API's limit on a failed job's error_message. */
export const BOT_JOB_ERROR_MESSAGE_MAX = 2000;
/**
 * Claims a job gets before the API fails it (BotJob::MAX_ATTEMPTS). A temporary failure is
 * left unacked for the lease to hand back until this attempt, which acks it failed.
 */
export const BOT_JOB_MAX_ATTEMPTS = 3;
