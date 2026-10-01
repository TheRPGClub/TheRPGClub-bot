import { DISCORD_V2_COMPONENTS_MAX, DISCORD_V2_TEXT_MAX } from "./textLimits.js";

export const DEFAULT_PAGE_SIZE         = 20;
export const AVATAR_HISTORY_PAGE_SIZE  = 20;
export const AVATAR_ALL_VIEW_PAGE_SIZE = 50;
export const AUDIT_PAGE_SIZE           = 10;
export const SYNONYM_LIST_PAGE_SIZE    = 25;
export const JOURNAL_LIST_PAGE_SIZE    = 20;
export const JOURNAL_ALL_PAGE_SIZE     = 50;
export const JOURNAL_SEARCH_PAGE_SIZE  = 1;
export const COMPLETION_PAGE_SIZE      = 20;
export const MP_INFO_PAGE_SIZE         = 25;
export const GUILD_FETCH_CHUNK_SIZE    = 100;
export const CLAIM_MENU_CHUNK_SIZE     = 25;
export const TODO_DEFAULT_PAGE_SIZE        = 15;
export const TODO_MAX_PAGE_SIZE            = 15;
export const COLLECTION_LIST_PAGE_SIZE     = 20;
export const BACKLOG_LIST_PAGE_SIZE        = 20;
export const GAMEDB_CSV_RESULT_LIMIT       = 15;

// A round history page is one container (title and intro text) plus a row holding prev,
// page indicator, and next buttons.
const ROUND_HISTORY_FIXED_COMPONENTS = 7;
// Each game is a section holding a text display and a thumbnail.
const ROUND_HISTORY_COMPONENTS_PER_GAME = 3;
export const ROUND_HISTORY_GAMES_PER_PAGE = Math.floor(
  (DISCORD_V2_COMPONENTS_MAX - ROUND_HISTORY_FIXED_COMPONENTS) /
    ROUND_HISTORY_COMPONENTS_PER_GAME,
);
// The page title and filter intro (its query capped at MAX_QUERY_LENGTH) stay under this.
const ROUND_HISTORY_HEADER_TEXT_RESERVE = 500;
export const ROUND_HISTORY_CARD_TEXT_BUDGET =
  DISCORD_V2_TEXT_MAX - ROUND_HISTORY_HEADER_TEXT_RESERVE;
