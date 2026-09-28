import VotingRounds from "../classes/VotingRounds.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";

export interface INominationWindow {
  targetRound: number;
  nextVoteAt: Date;
  closesAt: Date;
  /** The API's verdict on whether members may nominate for `targetRound`. */
  nominationsOpen: boolean;
}

/**
 * The round members nominate for, from the API's current voting round. The
 * API owns which round that is and whether its nominations are open, so
 * nothing here derives either from a round number or the local clock.
 */
export async function getUpcomingNominationWindow(): Promise<INominationWindow> {
  const current = await VotingRounds.getCurrent();
  if (!current) {
    throw new Error("No voting round is scheduled. Set the next vote date first.");
  }

  return {
    targetRound: current.roundNumber,
    nextVoteAt: current.votingOpensAt,
    closesAt: current.votingOpensAt,
    nominationsOpen: current.nominationsOpen,
  };
}

export function areNominationsClosed(window: INominationWindow): boolean {
  return !window.nominationsOpen;
}

/**
 * Why nominations are closed. Once the round's vote has opened, the round
 * stays current until it is decided, so point members at that instead of a
 * vote time that has already passed.
 */
export function buildNominationsClosedText(
  window: INominationWindow,
  closedClause: string = "are closed",
  now: Date = new Date(),
): string {
  const head = `Nominations for Round ${window.targetRound} ${closedClause}.`;
  const voteUnix = toUnixTimestamp(window.nextVoteAt);
  if (window.nextVoteAt > now) {
    return `${head} Voting is scheduled for <t:${voteUnix}:F>.`;
  }
  return (
    `${head} Voting opened <t:${voteUnix}:R>; nominations for the next round ` +
    `open once Round ${window.targetRound} is decided.`
  );
}
