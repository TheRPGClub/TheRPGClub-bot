import type { IGotyVoteApi } from "../services/GotyVoteApi.js";

// Shared by the /goty tests: a fake GOTY Vote API client whose every endpoint throws, for
// a test to override only the ones it expects to be called.

function unexpected(name: string): never {
  throw new Error(`unexpected GOTY API call: ${name}`);
}

export const UNUSED_GOTY_API: IGotyVoteApi = {
  listVotes: async () => unexpected("listVotes"),
  getVote: async () => unexpected("getVote"),
  castVote: async () => unexpected("castVote"),
  listNominations: async () => unexpected("listNominations"),
  nominate: async () => unexpected("nominate"),
  withdrawNomination: async () => unexpected("withdrawNomination"),
  eligibility: async () => unexpected("eligibility"),
  moveDates: async () => unexpected("moveDates"),
  resolveTie: async () => unexpected("resolveTie"),
};
