import { escapeMarkdown } from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import {
  buildComponentsV2Flags,
  buildDivider,
  buildTextDisplay,
} from "../functions/ComponentsV2Utils.js";
import { gotyPageUrl } from "../config/website.js";
import { buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { plural } from "../utilities/TextUtils.js";
import {
  GOTY_AWARDS,
  GOTY_AWARD_LABELS,
  type GotyDecidedBy,
  type IGotyAward,
  type IGotyVote,
  type IGotyVoteApi,
  type IGotyVoteSummary,
} from "./GotyVoteApi.js";

// /goty results [year] (bot#1580): each Award's winner and final tally for a decided GOTY
// Vote, the latest decided year by default. Counts only: who voted for what stays on the
// website. Read-only, so there is nothing to resume.

/** How many candidates an Award's tally lists before "and N more". */
const TALLY_LINES_MAX = 10;

const DECIDED_BY_TEXT: Record<GotyDecidedBy, string> = {
  vote: "won the vote",
  runoff: "won the runoff",
  admin: "was picked by staff after the runoff tied again",
  uncontested: "won uncontested, as the only candidate",
};

export interface IGotyResultsView {
  components: ContainerBuilder[];
  flags: number;
  allowedMentions: { parse: [] };
}

export type GotyResultsReply = { view: IGotyResultsView } | { text: string } | { error: string };

function titleOf(award: IGotyAward, gameId: number): string {
  const game = award.ballot.find((entry) => entry.game_id === gameId) ??
    (award.winner?.gamedb_game_id === gameId ? award.winner.game : null);
  return escapeMarkdown(game?.title ?? `Game #${gameId}`);
}

function tallyText(award: IGotyAward): string | null {
  const rows = [...(award.result ?? [])].sort((a, b) =>
    b.runoff_votes - a.runoff_votes || b.votes - a.votes);
  if (!rows.length) return null;
  const hadRunoff = award.runoff_ballot.length > 0;
  const lines = rows.slice(0, TALLY_LINES_MAX).map((row) => {
    const runoff = hadRunoff && award.runoff_ballot.includes(row.gamedb_game_id)
      ? `, ${plural(row.runoff_votes, "vote")} in the runoff`
      : "";
    return `- ${titleOf(award, row.gamedb_game_id)}: ${plural(row.votes, "vote")}${runoff}`;
  });
  if (rows.length > TALLY_LINES_MAX) {
    lines.push(`- ...and ${plural(rows.length - TALLY_LINES_MAX, "more candidate")}`);
  }
  return lines.join("\n");
}

/** One Award's block: its winner (or why it was not given) and its tally. */
export function awardResultText(vote: IGotyVote, award: IGotyAward): string {
  const heading = `### ${GOTY_AWARD_LABELS[award.award]} ${vote.year}`;
  const winner = award.winner;
  if (!winner) {
    const why = award.ballot.length ? "nobody voted" : "it had no candidates";
    return `${heading}\nNot given: ${why}.`;
  }
  const line = `🏆 **${titleOf(award, winner.gamedb_game_id)}** ` +
    `${DECIDED_BY_TEXT[winner.decided_by] ?? "won"}.`;
  const tally = winner.decided_by === "uncontested" ? null : tallyText(award);
  return [heading, line, tally].filter(Boolean).join("\n");
}

export function buildGotyResultsView(vote: IGotyVote, isPrivate: boolean): IGotyResultsView {
  const body = new ContainerBuilder();
  body.addTextDisplayComponents(buildTextDisplay(`## ${vote.name}: the results`));
  for (const key of GOTY_AWARDS) {
    const award = vote.awards.find((entry) => entry.award === key);
    if (!award) continue;
    body.addSeparatorComponents(buildDivider());
    body.addTextDisplayComponents(buildTextDisplay(awardResultText(vote, award)));
  }
  body.addSeparatorComponents(buildDivider());
  body.addTextDisplayComponents(buildTextDisplay(`Every year's winners: ${gotyPageUrl()}`));
  return {
    components: [body],
    flags: buildComponentsV2Flags(isPrivate),
    allowedMentions: { parse: [] },
  };
}

function notDecidedText(vote: IGotyVoteSummary): string {
  return `${vote.name} is not decided yet, so it has no results. ` +
    "Use /goty vote to see where it stands.";
}

/** /goty results [year]: the year's results, or the latest decided year's. */
export async function gotyResultsReply(
  api: IGotyVoteApi,
  input: { userId: string; year: number | null; isPrivate: boolean },
): Promise<GotyResultsReply> {
  let votes: IGotyVoteSummary[];
  try {
    votes = await api.listVotes();
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not read the GOTY Votes.") };
  }
  const summary = input.year === null
    ? votes.find((vote) => vote.phase === "decided") ?? null
    : votes.find((vote) => vote.year === input.year) ?? null;
  if (!summary) {
    return {
      text: input.year === null
        ? "No GOTY Vote has been decided yet."
        : `There is no GOTY Vote for ${input.year}.`,
    };
  }
  if (summary.phase !== "decided") return { text: notDecidedText(summary) };

  let vote: IGotyVote | null;
  try {
    vote = await api.getVote(summary.year, input.userId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, `Could not read ${summary.name}.`) };
  }
  if (!vote) return { text: `There is no GOTY Vote for ${summary.year}.` };
  return { view: buildGotyResultsView(vote, input.isPrivate) };
}

