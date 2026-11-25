import { resolveId } from "./testMode.js";

export const BOT_DEV_PING_USER_ID = resolveId("BOT_DEV_PING_USER_ID", "191938640413327360");
/**
 * The dev bot application PR previews run under. It exists only in the test guild, so
 * production never matches it; the conductor trusts ready announcements from it alone.
 */
export const PREVIEW_BOT_USER_ID = "1461187162228916540";
/**
 * The bot owner, DMed operational alerts such as a PSN login expiry. Read from the
 * environment (each deployment sets its own); empty when unset, which skips the DM.
 */
export const BOT_OWNER_USER_ID: string = (process.env.BOT_OWNER_USER_ID ?? "").trim();
