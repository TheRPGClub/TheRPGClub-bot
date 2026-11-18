// Collection list pagination and filter interaction IDs
export const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
export const COLLECTION_LIST_FILTER_PREFIX = "collection-list-filter-v1";
export const COLLECTION_LIST_FILTER_PANEL_PREFIX = "clf1";
export const COLLECTION_LIST_FILTER_MODAL_PREFIX = "clfm1";
export const COLLECTION_START_PLAYING_PREFIX = "collection-start-playing-v1";

// Backlog list pagination and filter interaction IDs
export const BACKLOG_LIST_NAV_PREFIX = "backlog-list-nav-v1";
export const BACKLOG_LIST_FILTER_PREFIX = "backlog-list-filter-v1";
export const BACKLOG_LIST_FILTER_MODAL_PREFIX = "blm1";
export const BACKLOG_START_PLAYING_PREFIX = "backlog-start-playing-v1";

// Backlog pick (random suggestion) interaction IDs
export const BACKLOG_PICK_REROLL_PREFIX = "backlog-pick-reroll-v1";
export const BACKLOG_PICK_START_PREFIX = "backlog-pick-start-v1";
export const BACKLOG_PICK_DISMISS_PREFIX = "backlog-pick-dismiss-v1";

// Completionator CSV import interaction IDs
export const COMPLETIONATOR_CHOOSE_PREFIX = "comp-import-choose-v1";

// GameDB search interaction IDs
export const GAMEDB_SEARCH_PREFIX = "gamedb-search-";

// GameDB profile action interaction IDs
export const GAMEDB_NOWPLAYING_PLATFORM_SELECT_PREFIX = "gamedb-nowplaying-platform-select";
export const GAMEDB_COLLECTION_PLATFORM_PREFIX = "gamedb-collection-platform";
export const GAMEDB_COLLECTION_OWNERSHIP_PREFIX = "gamedb-collection-ownership";

// Conductor test runner interaction IDs (separate process, see src/conductor)
export const CONDUCTOR_CHECK_PREFIX = "conductor-check-v1";
export const CONDUCTOR_ABORT_PREFIX = "conductor-abort-v1";
export const CONDUCTOR_REPORT_PREFIX = "conductor-report-v1";
export const CONDUCTOR_APPROVE_PREFIX = "conductor-approve-v1";
export const CONDUCTOR_ACCEPT_PREFIX = "conductor-accept-v1";
export const CONDUCTOR_CONFIRM_PREFIX = "conductor-confirm-v1";
export const CONDUCTOR_NOTE_PREFIX = "conductor-note-v1";
export const CONDUCTOR_NOTE_MODAL_PREFIX = "conductor-note-modal-v1";

// Game completion confirmation interaction IDs
export const COMPLETION_ADD_DUPLICATE_PREFIX = "comp-add-dup-v1";
export const NOW_PLAYING_REMOVE_CONFIRM_PREFIX = "np-remove-confirm-v1";

// Admin GOTM / NR-GOTM round interaction IDs
export const ADMIN_ROUND_ADD_PREFIX = "admin-round-add-v1";
export const ADMIN_ROUND_ADD_MODAL_PREFIX = "admin-round-add-modal-v1";
export const ADMIN_ROUND_EDIT_PREFIX = "admin-round-edit-v1";
export const ADMIN_ROUND_EDIT_MODAL_PREFIX = "admin-round-edit-modal-v1";

// Admin legacy voting setup interaction IDs
export const ADMIN_VOTING_TITLES_PREFIX = "admin-voting-titles-v1";
export const ADMIN_VOTING_TITLES_MODAL_PREFIX = "admin-voting-titles-modal-v1";

// News Channel "Change news category" picker (custom ID carries channel and message IDs)
export const NEWS_CATEGORY_PICK_PREFIX = "news-category-pick-v1";

// Challenges (spec api#376). Every Challenge component's custom ID starts with this, so
// the Feature gate maps them all to the challenges Feature.
export const CHALLENGE_CUSTOM_ID_PREFIX = "challenge-";
/** /challenge create and edit: the steps of the wizard, keyed by the session ID. */
export const CHALLENGE_WIZARD_PREFIX = "challenge-wiz-v1";
/** /challenge show: the view (by game or by member) and page, with the Challenge ID. */
export const CHALLENGE_SHOW_PREFIX = "challenge-show-v1";
/** /challenge list: the page and the Open filter. */
export const CHALLENGE_LIST_PREFIX = "challenge-list-v1";
/** A member's Run: start one from a post, and confirm abandoning or deleting it. */
export const CHALLENGE_RUN_PREFIX = "challenge-run-v1";
/** /challenge edit: the edit panel's buttons and the Host picker, with the Challenge ID. */
export const CHALLENGE_EDIT_PREFIX = "challenge-edit-v1";
/** A Slots Run: its decade pages, and moving games or picking past play into its years. */
export const CHALLENGE_SLOTS_PREFIX = "challenge-slots-v1";
/** Secret Santa sign-up: join, leave, and confirm leaving after the draw, with the Edition ID. */
export const CHALLENGE_SANTA_PREFIX = "challenge-santa-v1";
/** A Santa's pick: open, page, search and choose, with the Edition ID, page and search. */
export const CHALLENGE_SANTA_PICK_PREFIX = "challenge-santa-pick-v1";

// Club Codex (spec api#397). Every Club Codex component's custom ID starts with this, so
// the Feature gate maps them all to the club_codex Feature.
export const CODEX_CUSTOM_ID_PREFIX = "codex-";
/** /codex fun-fact delete: the question's Delete and Keep buttons, keyed by Fun Fact ID. */
export const CODEX_FUN_FACT_PREFIX = `${CODEX_CUSTOM_ID_PREFIX}fun-fact`;
/** /codex lore read: Previous, Next and Post this page, keyed by Lore Entry, page and owner. */
export const CODEX_LORE_PREFIX = `${CODEX_CUSTOM_ID_PREFIX}lore`;
/** /codex history: Newer and Older, keyed by page and owner. */
export const CODEX_HISTORY_PREFIX = `${CODEX_CUSTOM_ID_PREFIX}history`;
