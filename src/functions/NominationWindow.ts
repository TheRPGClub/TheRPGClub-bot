import VotingRounds from "../classes/VotingRounds.js";

export interface INominationWindow {
  targetRound: number;
  nextVoteAt: Date;
  closesAt: Date;
}

/**
 * The round members nominate for, from the API's current voting round. The
 * API owns which round that is, so nothing here derives one round number
 * from another. Nominations close the moment that round's voting opens.
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
  };
}

export function areNominationsClosed(window: INominationWindow, now: Date = new Date()): boolean {
  return now >= window.closesAt;
}
