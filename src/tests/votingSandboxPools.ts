import type { NominationKind } from "../classes/Nomination.js";
import {
  sandboxPoolFromWinners,
  type ISandboxNominationSeed,
  type ISandboxWinnerRound,
} from "../services/VotingSandboxModel.js";

/** One winner per round, named "<label> Winner <round>", with ids from `idBase + 1`. */
export function winnerRounds(label: string, count: number, idBase: number): ISandboxWinnerRound[] {
  return Array.from({ length: count }, (_, index) => ({
    round: index + 1,
    gameOfTheMonth: [{ gamedbGameId: idBase + index + 1, title: `${label} Winner ${index + 1}` }],
  }));
}

/** Past-winner pools large enough for the 30-game option in both categories. */
export const TEST_SANDBOX_POOLS: Record<NominationKind, ISandboxNominationSeed[]> = {
  "gotm": sandboxPoolFromWinners("gotm", winnerRounds("GOTM", 40, 100)),
  "nr-gotm": sandboxPoolFromWinners("nr-gotm", winnerRounds("NR-GOTM", 40, 500)),
};
