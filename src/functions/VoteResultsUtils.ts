import type { INominationEntry } from "../classes/Nomination.js";
import type { IVoteCastResult, IVoteEntry, IVoteTallyRow } from "../classes/Vote.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

export interface ITallyDisplayRow {
  gamedbGameId: number;
  gameTitle: string;
  nominationId: number;
  voteCount: number;
}

/**
 * One votable entry per game. Votes are per game server-side, so when two
 * members nominate the same game only the earliest nomination is offered in
 * the vote select. GOTM nominations without a resolvable game are skipped
 * (the API rejects votes on them anyway).
 */
export function dedupeNominationsByGame(
  nominations: INominationEntry[],
): INominationEntry[] {
  const byGame = new Map<number, INominationEntry>();
  for (const nomination of nominations) {
    if (!isPositiveInt(nomination.gamedbGameId)) {
      continue;
    }
    if (!byGame.has(nomination.gamedbGameId)) {
      byGame.set(nomination.gamedbGameId, nomination);
    }
  }
  return [...byGame.values()];
}

/**
 * Merges the anonymous tally into the round's nominations for display.
 * Tally rows are grouped per nomination server-side, so counts for the same
 * game cast through different nominations are summed. Games without votes
 * are included with a zero count. Sorted by votes (desc), then title.
 */
export function mergeTallyWithNominations(
  rows: IVoteTallyRow[],
  nominations: INominationEntry[],
): ITallyDisplayRow[] {
  const countsByGame = new Map<number, number>();
  for (const row of rows) {
    countsByGame.set(
      row.gamedbGameId,
      (countsByGame.get(row.gamedbGameId) ?? 0) + row.voteCount,
    );
  }

  const display = dedupeNominationsByGame(nominations).map((nomination) => ({
    gamedbGameId: nomination.gamedbGameId,
    gameTitle: nomination.gameTitle,
    nominationId: nomination.id,
    voteCount: countsByGame.get(nomination.gamedbGameId) ?? 0,
  }));

  return display.sort(
    (a, b) => b.voteCount - a.voteCount || a.gameTitle.localeCompare(b.gameTitle),
  );
}

export function sumTallyVotes(rows: IVoteTallyRow[]): number {
  return rows.reduce((total, row) => total + row.voteCount, 0);
}

/**
 * The winning row(s) of a merged tally: every game sharing the top vote
 * count. Empty when no votes were cast at all.
 */
export function pickWinningRows(rows: ITallyDisplayRow[]): ITallyDisplayRow[] {
  const top = rows[0]?.voteCount ?? 0;
  if (top <= 0) {
    return [];
  }
  return rows.filter((row) => row.voteCount === top);
}

/** "**A**", "**A** and **B**", or "**A**, **B** and **C**". */
function joinBoldTitles(titles: string[]): string {
  const bold = titles.map((title) => `**${title}**`);
  if (bold.length <= 1) {
    return bold[0] ?? "";
  }
  return `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
}

/**
 * The winner line for a category whose picks are settled, e.g. after the
 * admins break a tie.
 */
export function buildFinalWinnersText(params: {
  kindLabel: string;
  roundNumber: number;
  monthLabel: string;
  titles: string[];
}): string {
  if (!params.titles.length) {
    return `No ${params.kindLabel} winner was recorded for Round ${params.roundNumber}.`;
  }
  const plural = params.titles.length > 1;
  return (
    `# 🏆 The ${params.kindLabel} ${plural ? "winners" : "winner"} for Round ` +
    `${params.roundNumber} (${params.monthLabel}) ${plural ? "are" : "is"} ` +
    `${joinBoldTitles(params.titles)}!`
  );
}

export function buildWinnerAnnouncementText(params: {
  kindLabel: string;
  roundNumber: number;
  monthLabel: string;
  winners: ITallyDisplayRow[];
}): string {
  if (!params.winners.length) {
    return (
      `No ${params.kindLabel} votes were cast for Round ${params.roundNumber}, ` +
      "so no winner was decided."
    );
  }
  if (params.winners.length === 1) {
    return buildFinalWinnersText({
      ...params,
      titles: params.winners.map((row) => row.gameTitle),
    });
  }
  const list = joinBoldTitles(params.winners.map((row) => row.gameTitle));
  return (
    `# 🏆 ${params.kindLabel} Round ${params.roundNumber} (${params.monthLabel}) ` +
    `ends in a tie between ${list}! The admins will decide the final pick.`
  );
}

function voteNoun(count: number): string {
  return count === 1 ? "vote" : "votes";
}

export function buildTallyText(params: {
  kindLabel: string;
  roundNumber: number;
  rows: ITallyDisplayRow[];
  cap: number;
  votingOpen: boolean;
  voteDeadline: Date | null;
}): string {
  const lines = params.rows.map(
    (row, index) => `${index + 1}. **${row.gameTitle}** - ${row.voteCount} ${voteNoun(row.voteCount)}`,
  );
  const body = lines.length ? lines.join("\n") : "No nominations to tally.";
  let footer = `-# Each member can vote for up to ${params.cap} games.`;
  if (params.votingOpen && params.voteDeadline) {
    const deadlineUnix = toUnixTimestamp(params.voteDeadline);
    footer += ` Voting is still open until <t:${deadlineUnix}:F>; counts can change.`;
  }
  return `## 🗳️ ${params.kindLabel} Results - Round ${params.roundNumber}\n${body}\n${footer}`;
}

export function buildHiddenTallyText(params: {
  kindLabel: string;
  roundNumber: number;
  totalVotes: number;
  voteDeadline: Date | null;
}): string {
  const revealNote = params.voteDeadline
    ? `Results are posted in the announcements channel when voting ends ` +
      `<t:${toUnixTimestamp(params.voteDeadline)}:R>.`
    : "Results are posted in the announcements channel when voting ends.";
  return (
    `${params.kindLabel} Round ${params.roundNumber} results are hidden while voting is open. ` +
    `${revealNote}\n**${params.totalVotes}** ${voteNoun(params.totalVotes)} cast so far.`
  );
}

export function buildMyVotesText(params: {
  kindLabel: string;
  roundNumber: number;
  votes: IVoteEntry[];
  cap: number;
}): string {
  const header =
    `**Your ${params.kindLabel} votes for Round ${params.roundNumber} ` +
    `(${params.votes.length}/${params.cap}):**`;
  if (!params.votes.length) {
    return `${header}\nYou have not voted yet.`;
  }
  const lines = params.votes.map(
    (vote, index) =>
      `${index + 1}. **${vote.gameTitle}** (voted <t:${toUnixTimestamp(vote.votedAt)}:R>)`,
  );
  return `${header}\n${lines.join("\n")}`;
}

export function buildCastResultText(params: {
  kindLabel: string;
  roundNumber: number;
  result: IVoteCastResult;
  votes: IVoteEntry[];
}): string {
  const { result } = params;
  const lines: string[] = [];
  if (result.action === "voted") {
    const title = result.vote?.gameTitle ?? "that game";
    lines.push(`✅ Vote recorded for **${title}**.`);
    if (result.warning) {
      lines.push(`⚠️ ${result.warning}`);
    }
  } else {
    const title = result.removedVotes[0]?.gameTitle ?? "that game";
    lines.push(`↩️ Removed your vote for **${title}**.`);
  }
  lines.push(
    buildMyVotesText({
      kindLabel: params.kindLabel,
      roundNumber: params.roundNumber,
      votes: params.votes,
      cap: result.cap,
    }),
  );
  return lines.join("\n");
}

/**
 * Banner for a rehearsal announcement. Posted above the tallies so a test run
 * in a staging channel can never be mistaken for the real winner post.
 */
export function buildRehearsalNoticeText(roundNumber: number): string {
  return (
    `## 🧪 TEST MODE\nRehearsal of the Round ${roundNumber} results announcement. ` +
    "No winner thread was created or renamed, and nothing was posted to announcements."
  );
}

/**
 * Banner for a test-mode voting panel. Casts from a test panel are real votes
 * on that round, so the notice names the cleanup command.
 */
export function buildTestPanelNoticeText(params: {
  kindLabel: string;
  roundNumber: number;
  castsAccepted: boolean;
  reason: string | null;
}): string {
  const status = params.castsAccepted
    ? `Casting is live: votes land on Round ${params.roundNumber} for real. ` +
      `Clear them with \`/admin votes-reset type:${params.kindLabel} ` +
      `round:${params.roundNumber}\`.`
    : `Casting is refused right now${params.reason ? `: ${params.reason}.` : "."}`;
  return `## 🧪 TEST MODE\n${status}`;
}
