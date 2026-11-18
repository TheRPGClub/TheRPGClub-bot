import { VOTE_TIME_ZONE } from "../functions/VoteDateUtils.js";

/**
 * The club's day decides whose Birthday it is (spec api#396): New York time, as Voting's
 * and the API's Birthdays::TIME_ZONE.
 */
export const BIRTHDAY_TIME_ZONE = VOTE_TIME_ZONE;
