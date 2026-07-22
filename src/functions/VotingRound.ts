import BotVotingInfo, { type IBotVotingInfoEntry } from "../classes/BotVotingInfo.js";
import Gotm from "../classes/Gotm.js";

/**
 * A round is decided once its winners exist in the GOTM data. Guards voting
 * flows against stale rounds: a historic round's voting_info window can look
 * "open" again after the setup wizard re-dates it for the next cycle.
 */
export function isRoundDecided(roundNumber: number): boolean {
  return Gotm.getByRound(roundNumber).length > 0;
}

/** The round currently accepting first-party votes, or null when none is. */
export async function getActiveVotingRound(): Promise<IBotVotingInfoEntry | null> {
  const current = await BotVotingInfo.getCurrentRound();
  if (!current?.votingOpen) {
    return null;
  }
  if (isRoundDecided(current.roundNumber)) {
    return null;
  }
  return current;
}
