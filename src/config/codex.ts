// The Club Codex (spec api#397): its limits and how much the bot reads from the API.

/** A Fun Fact's most characters, mention tokens included (the API's limit too). */
export const FUN_FACT_MAX_LENGTH = 300;
/**
 * /funfact answers the draw without a defer when it is back this soon after the member ran
 * it, leaving a second of Discord's 3 for a defer when it isn't.
 */
export const FUN_FACT_ANSWER_BY_MS = 2000;
/** The longest /funfact waits on the draw before deferring, whatever the clocks say. */
export const FUN_FACT_DRAW_WAIT_MAX_MS = 1500;
/** The Fun Facts ink (design picks, www#122): the edge of every Fun Fact card in Discord. */
export const FUN_FACT_INK = 0xff8ad8;

// /codex lore read and /codex history (bot#1563, design picks 3B+3C+3D and 4B).

/**
 * A Lore Entry page's story text at most, in characters. Discord allows 4000 across a
 * message's text; the rest holds the title and byline (about 300 at most), and on the last
 * page as many See also links as fit in what is left.
 */
export const LORE_PAGE_TEXT_MAX = 2800;
/** "See also" links a Lore Entry's last page lists at most before "and N more". */
export const LORE_SEE_ALSO_MAX = 5;
/** Lore Entries the `entry:` autocomplete offers (Discord's most). */
export const LORE_AUTOCOMPLETE_READ = 25;
/** History Events on one page of /codex history, newest first. */
export const HISTORY_PAGE_SIZE = 4;
/** A History Event's description on its card at most, cut at a sentence end. */
export const HISTORY_DESCRIPTION_MAX = 500;

/** The Club Lore ink: a Lore Entry card's accent. */
export const CLUB_LORE_INK = 0x52d6a4;
/** Each History Event Kind's ink, a History Event card's accent (as on the website). */
export const HISTORY_KIND_INKS = {
  founding: 0xf59ac0,
  staff: 0x3fd0c9,
  platform: 0x7cb6ff,
  rules: 0xb7dd5e,
  milestone: 0xeadcb8,
} as const;
