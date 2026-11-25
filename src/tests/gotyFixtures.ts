import type { IGotyVoteApi } from "../services/GotyVoteApi.js";

// Shared by the /goty tests: a fake GOTY Vote API client whose every endpoint throws, for
// a test to override only the ones it expects to be called.

function unexpected(name: string): never {
  throw new Error(`unexpected GOTY API call: ${name}`);
}

export const UNUSED_GOTY_API: IGotyVoteApi = {
  listVotes: async () => unexpected("listVotes"),
  getVote: async () => unexpected("getVote"),
  current: async () => unexpected("current"),
  castVote: async () => unexpected("castVote"),
  listNominations: async () => unexpected("listNominations"),
  nominate: async () => unexpected("nominate"),
  withdrawNomination: async () => unexpected("withdrawNomination"),
  eligibility: async () => unexpected("eligibility"),
  eligibilities: async () => unexpected("eligibilities"),
  moveDates: async () => unexpected("moveDates"),
  resolveTie: async () => unexpected("resolveTie"),
};

/**
 * The API's Current GOTY Vote rule (api#482), for fakes that serve `current` from a list
 * of votes: among the undecided ones, oldest year first, the first that is not upcoming;
 * else the oldest upcoming one; else null.
 */
export function apiCurrentGotyVote<T extends { year: number; phase: string }>(
  votes: T[],
): T | null {
  const undecided = votes
    .filter((vote) => vote.phase !== "decided")
    .sort((a, b) => a.year - b.year);
  return undecided.find((vote) => vote.phase !== "upcoming") ?? undecided[0] ?? null;
}
