import { ButtonStyle, StringSelectMenuBuilder, type ActionRowBuilder } from "discord.js";
import { ContainerBuilder, type ButtonBuilder } from "@discordjs/builders";
import {
  buildComponentsV2Flags,
  buildDivider,
  buildTextContainer,
  buildTextDisplay,
} from "../functions/ComponentsV2Utils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectOptions,
  buildSelectRow,
} from "../functions/uiComponents.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import {
  DISCORD_BUTTON_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_V2_COMPONENTS_MAX,
} from "../config/textLimits.js";
import { GOTY_VOTE_PICK_PREFIX, GOTY_VOTE_SELECT_PREFIX } from "../config/customIdPrefixes.js";
import { buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { chunk } from "../utilities/ArrayUtils.js";
import { validateCustomId } from "../utilities/CustomIdUtils.js";
import { isPositiveInt, truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import {
  GOTY_AWARDS,
  GOTY_AWARD_LABELS,
  parseGotyAward,
  type GotyAwardKey,
  type IGotyAward,
  type IGotyGame,
  type IGotyVote,
  type IGotyVoteApi,
  type IGotyVoteCastResult,
  type IGotyVoteSummary,
} from "./GotyVoteApi.js";

// /goty vote (bot#1581): a ballot panel per Award, built from the /gotm vote panel's
// pieces (title list, rules lines, one button per game with a select fallback). The panel
// is the member's own ephemeral message: a press casts or toggles through the API and
// redraws the panel from a fresh read, so the ids alone (year, Award, ballot, game)
// carry everything a press needs, across restarts.

export const GOTY_MEMBERS_ONLY_MESSAGE =
  "Voting is limited to server members with the Members role.";

/** The main vote, or the runoff between an Award's tied games. */
export type GotyBallot = "main" | "runoff";

export interface IGotyVoteTarget {
  year: number;
  award: GotyAwardKey;
  ballot: GotyBallot;
}

/** A Components V2 message: a reply, a follow-up or a panel update. */
export interface IGotyView {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>)[];
  flags: number;
}

const BALLOT_SEGMENT: Record<GotyBallot, string> = { main: "m", runoff: "r" };
const GAME_BUTTONS_PER_ROW = 5;
const GAME_LIST_TEXT_BUDGET = 2400;

function targetSegments(target: IGotyVoteTarget): string {
  return `${target.year}:${target.award}:${BALLOT_SEGMENT[target.ballot]}`;
}

export function buildGotyVotePickId(target: IGotyVoteTarget, gameId: number): string {
  return validateCustomId(`${GOTY_VOTE_PICK_PREFIX}:${targetSegments(target)}:${gameId}`);
}

export function buildGotyVoteSelectId(target: IGotyVoteTarget, page: number): string {
  return validateCustomId(`${GOTY_VOTE_SELECT_PREFIX}:${targetSegments(target)}:${page}`);
}

/**
 * A pick button or select id back to its target. `gameId` is the button's game, or null
 * for a select (whose game is its value).
 */
export function parseGotyVoteId(
  customId: string,
): { target: IGotyVoteTarget; gameId: number | null } | null {
  const [prefix, rawYear, rawAward, rawBallot, rawLast] = customId.split(":");
  const isPick = prefix === GOTY_VOTE_PICK_PREFIX;
  if (!isPick && prefix !== GOTY_VOTE_SELECT_PREFIX) return null;
  const year = Number(rawYear);
  const award = parseGotyAward(rawAward ?? "");
  const ballot = rawBallot === "m" ? "main" : rawBallot === "r" ? "runoff" : null;
  if (!isPositiveInt(year) || !award || !ballot) return null;
  const gameId = isPick ? Number(rawLast) : null;
  if (isPick && !isPositiveInt(gameId)) return null;
  return { target: { year, award, ballot }, gameId };
}

/**
 * The GOTY Vote /goty vote is about: the one taking votes, else the newest still under
 * way, else the newest. Null when the club has none yet.
 */
export function pickCurrentGotyVote(votes: IGotyVoteSummary[]): IGotyVoteSummary | null {
  return votes.find((vote) => vote.voting_open || vote.runoff_open) ??
    votes.find((vote) => vote.phase !== "decided") ??
    votes[0] ??
    null;
}

function awardOf(vote: IGotyVote, award: GotyAwardKey): IGotyAward | null {
  return vote.awards.find((entry) => entry.award === award) ?? null;
}

function gameTitle(game: IGotyGame | null | undefined, gameId: number): string {
  return game?.title ?? `Game #${gameId}`;
}

/** A ballot taking this member's votes right now. */
interface IOpenBallot {
  target: IGotyVoteTarget;
  games: IGotyGame[];
  ownVotes: number[];
  cap: number;
  deadline: string | null;
}

/** The open ballot for an Award, or the text that says why there is none. */
function openBallotOf(vote: IGotyVote, award: IGotyAward): IOpenBallot | string {
  const target = { year: vote.year, award: award.award };
  if (vote.voting_open) {
    if (award.ballot.length < 2) return awardStatusText(vote, award);
    return {
      target: { ...target, ballot: "main" },
      games: award.ballot,
      ownVotes: award.own_votes,
      cap: award.cap,
      deadline: vote.voting_closes_at,
    };
  }
  if (vote.runoff_open && award.runoff_ballot.length) {
    return {
      target: { ...target, ballot: "runoff" },
      games: award.runoff_ballot.map((id) => ({
        game_id: id,
        title: gameTitle(award.ballot.find((game) => game.game_id === id), id),
      })),
      ownVotes: award.own_runoff_votes,
      cap: award.cap,
      deadline: vote.runoff_closes_at ?? null,
    };
  }
  return awardStatusText(vote, award);
}

const DECIDED_BY_TEXT: Record<string, string> = {
  vote: "by vote",
  runoff: "in the runoff",
  admin: "by a staff pick after the runoff tied again",
  uncontested: "uncontested, as the only candidate",
};

function discordTime(iso: string, style: "F" | "R"): string {
  return `<t:${toUnixTimestamp(new Date(iso))}:${style}>`;
}

/** Where an Award stands when it is not taking this member's votes. */
export function awardStatusText(vote: IGotyVote, award: IGotyAward): string {
  const label = GOTY_AWARD_LABELS[award.award];
  if (award.winner) {
    const title = gameTitle(award.winner.game, award.winner.gamedb_game_id);
    const how = DECIDED_BY_TEXT[award.winner.decided_by] ?? "";
    return `🏆 **${title}** won ${label} ${vote.year} ${how}.`.replace(" .", ".");
  }
  if (vote.voting_open && award.ballot.length === 1) {
    const only = award.ballot[0];
    return `🏆 **${gameTitle(only, only.game_id)}** is the only candidate, so it wins ` +
      `${label} ${vote.year} uncontested. There is nothing to vote on.`;
  }
  const noCandidates = award.ballot.length === 0 && vote.candidates_frozen_at != null;
  if (noCandidates || (vote.voting_open && award.ballot.length === 0)) {
    return `${label} ${vote.year} is not given: it has no candidates.`;
  }
  switch (vote.phase) {
    case "upcoming":
    case "nominating":
      return `Voting for ${label} opens ${discordTime(vote.voting_opens_at, "F")} ` +
        `(${discordTime(vote.voting_opens_at, "R")}).`;
    case "closed":
      return `Voting for ${label} has closed. The result comes once the votes are counted.`;
    case "runoff":
      return `${label} did not tie, so it has no runoff. Its result comes with the others.`;
    case "tie":
      return award.pending_tie.length
        ? `The ${label} runoff tied again, so staff will settle it.`
        : `${label} is waiting on staff to settle a tie in another Award.`;
    case "decided":
      return `${label} ${vote.year} is not given: nobody voted.`;
    default:
      return `Voting for ${label} is not open right now.`;
  }
}

function headingText(vote: IGotyVote, award: GotyAwardKey, ballot: GotyBallot | null): string {
  const label = GOTY_AWARD_LABELS[award];
  const runoff = ballot === "runoff" ? " Runoff" : "";
  const question: Record<GotyAwardKey, string> = {
    gotm: `Which of ${vote.year}'s GOTM winners should be GOTM of the Year?`,
    nr_gotm: `Which of ${vote.year}'s NR-GOTM winners should be NR-GOTM of the Year?`,
    game_of_the_year: `Which nominated game should be Game of the Year ${vote.year}?`,
  };
  return [
    `## ${vote.name}: ${label}${runoff}`,
    ...(ballot ? [question[award]] : []),
    "-# The club's yearly GOTY Vote, not this month's GOTM round.",
  ].join("\n");
}

function gameListText(games: IGotyGame[], ownVotes: number[]): string {
  const lines: string[] = [];
  let length = 0;
  for (const [index, game] of games.entries()) {
    const mark = ownVotes.includes(game.game_id) ? "✅ " : "";
    const line = `- ${mark}**${truncateWithEllipsis(game.title, DISCORD_BUTTON_LABEL_MAX)}**`;
    if (length + line.length > GAME_LIST_TEXT_BUDGET) {
      lines.push(`-# ...and ${games.length - index} more`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

function rulesText(open: IOpenBallot, useButtons: boolean): string {
  const label = GOTY_AWARD_LABELS[open.target.award];
  const lines = [
    ...(open.target.ballot === "runoff"
      ? [`🤝 The ${label} vote ended in a tie, so this runoff between the tied games decides it`]
      : []),
    "🙈 Votes are anonymous, and results stay hidden until voting ends",
    `🔢 Vote for up to **${open.cap}** ${open.cap === 1 ? "game" : "games"}`,
    `↩️ ${useButtons ? "Press" : "Pick"} a game you already voted for to take that vote back`,
  ];
  if (open.deadline) {
    lines.push(`⏳ Ends ${discordTime(open.deadline, "R")} (${discordTime(open.deadline, "F")})`);
  }
  lines.push("🔒 Members role required");
  return lines.join("\n");
}

function ownVotesText(open: IOpenBallot): string {
  const used = open.ownVotes.filter((id) => open.games.some((game) => game.game_id === id));
  return `🗳️ You have used **${used.length}** of your **${open.cap}** ` +
    `${open.cap === 1 ? "vote" : "votes"}.`;
}

/**
 * Components the panel has besides the game controls: the header container and its text;
 * the panel container with the notice and its divider, the list, a divider, the rules, a
 * divider and the votes line.
 */
const FIXED_COMPONENTS = 2 + 8;

function fitsGameButtons(gameCount: number): boolean {
  return FIXED_COMPONENTS + gameCount + Math.ceil(gameCount / GAME_BUTTONS_PER_ROW) <=
    DISCORD_V2_COMPONENTS_MAX;
}

function gameButtonRows(open: IOpenBallot): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = open.games.map((game) =>
    buildActionButton({
      customId: buildGotyVotePickId(open.target, game.game_id),
      label: truncateWithEllipsis(game.title, DISCORD_BUTTON_LABEL_MAX),
      style: open.ownVotes.includes(game.game_id) ? ButtonStyle.Success : ButtonStyle.Secondary,
    }),
  );
  return chunk(buttons, GAME_BUTTONS_PER_ROW).map((row) => buildButtonRow(...row));
}

function gameSelectRows(open: IOpenBallot): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = open.games.map((game) => ({
    label: game.title,
    value: String(game.game_id),
    description: open.ownVotes.includes(game.game_id) ? "Your vote" : undefined,
  }));
  return chunk(options, DISCORD_SELECT_OPTIONS_MAX).map((page, index) =>
    buildSelectRow(
      new StringSelectMenuBuilder()
        .setCustomId(buildGotyVoteSelectId(open.target, index))
        .setPlaceholder("Cast or take back a vote...")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(buildSelectOptions(page)),
    ),
  );
}

function addText(container: ContainerBuilder, content: string): void {
  container.addTextDisplayComponents(buildTextDisplay(content));
}

/**
 * One Award's panel: the ballot with a button per game (a select on a large ballot) when
 * it takes this member's votes, else where the Award stands, with no controls. `notice`
 * (the last press's outcome) leads the panel.
 */
export function buildGotyAwardPanel(
  vote: IGotyVote,
  award: GotyAwardKey,
  notice: string | null = null,
): IGotyView {
  const entry = awardOf(vote, award);
  const open: IOpenBallot | string = entry
    ? openBallotOf(vote, entry)
    : `${GOTY_AWARD_LABELS[award]} is not on this GOTY Vote.`;
  const flags = buildComponentsV2Flags(true);
  // No accent, like the /gotm vote panel.
  const body = new ContainerBuilder();
  if (notice) {
    addText(body, notice);
    body.addSeparatorComponents(buildDivider());
  }
  if (typeof open === "string") {
    addText(body, open);
    return { components: [buildTextContainer(headingText(vote, award, null)), body], flags };
  }
  const useButtons = fitsGameButtons(open.games.length);
  addText(body, gameListText(open.games, open.ownVotes));
  body.addSeparatorComponents(buildDivider());
  addText(body, rulesText(open, useButtons));
  body.addSeparatorComponents(buildDivider());
  addText(body, ownVotesText(open));
  return {
    components: [
      buildTextContainer(headingText(vote, award, open.target.ballot)),
      body,
      ...(useButtons ? gameButtonRows(open) : gameSelectRows(open)),
    ],
    flags,
  };
}

/** One message for a GOTY Vote taking no votes: each Award's standing. */
function buildGotyStatusView(vote: IGotyVote): IGotyView {
  const lines = GOTY_AWARDS.map((award) => {
    const entry = awardOf(vote, award);
    return `### ${GOTY_AWARD_LABELS[award]}\n` +
      (entry ? awardStatusText(vote, entry) : "Not on this GOTY Vote.");
  });
  return {
    components: [
      buildTextContainer(
        `## ${vote.name}\n-# The club's yearly GOTY Vote, not this month's GOTM round.`,
      ),
      buildTextContainer(lines.join("\n\n")),
    ],
    flags: buildComponentsV2Flags(true),
  };
}

export type GotyVoteReply = { views: IGotyView[] } | { text: string } | { error: string };

/**
 * /goty vote: the panel for `award`, or with no Award one panel per Award taking votes
 * (all three while voting is open, the tied ones in a runoff). A GOTY Vote taking no
 * votes gets one message with each Award's standing.
 */
export async function gotyVoteCommandReply(
  api: IGotyVoteApi,
  userId: string,
  award: GotyAwardKey | null,
): Promise<GotyVoteReply> {
  try {
    const current = pickCurrentGotyVote(await api.listVotes());
    if (!current) return { text: "There is no GOTY Vote yet." };
    const vote = await api.getVote(current.year, userId);
    if (!vote) return { text: `There is no GOTY Vote for ${current.year}.` };
    if (award) return { views: [buildGotyAwardPanel(vote, award)] };
    if (!vote.voting_open && !vote.runoff_open) return { views: [buildGotyStatusView(vote)] };
    const awards = vote.runoff_open
      ? vote.awards.filter((entry) => entry.runoff_ballot.length).map((entry) => entry.award)
      : GOTY_AWARDS;
    if (!awards.length) return { views: [buildGotyStatusView(vote)] };
    return { views: awards.map((key) => buildGotyAwardPanel(vote, key)) };
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not load the GOTY Vote") };
  }
}

/** The panel's notice for a cast: what changed, and any vote dropped at the cap. */
export function castNoticeText(result: IGotyVoteCastResult, gameTitleOf: string): string {
  if (result.action === "unvoted") return `↩️ Took back your vote for **${gameTitleOf}**.`;
  const lines = [`✅ Voted for **${gameTitleOf}**.`];
  if (result.removed_votes.length) {
    const dropped = result.removed_votes
      .map((removed) => `**${gameTitle(removed.game, removed.gamedb_game_id)}**`)
      .join(", ");
    lines.push(
      result.warning
        ? `⚠️ ${result.warning}`
        : `⚠️ You were at your cap of ${result.cap}, so your vote for ${dropped} was dropped.`,
    );
  }
  return lines.join("\n");
}

export interface IGotyCastOutcome {
  /** The redrawn panel; null when the GOTY Vote could not be read back. */
  panel: IGotyView | null;
  /** A refusal or failure, for the member privately (request and response included). */
  error: string | null;
}

/**
 * A press on a panel: casts or toggles the vote, then redraws the panel from a fresh read
 * with the outcome as its notice. A refused cast (voting closed, say) still redraws the
 * panel, so stale buttons go away.
 */
export async function gotyVoteCast(
  api: IGotyVoteApi,
  target: IGotyVoteTarget,
  gameId: number,
  userId: string,
): Promise<IGotyCastOutcome> {
  let result: IGotyVoteCastResult | null = null;
  let error: string | null = null;
  try {
    result = await api.castVote(target.year, userId, target.award, gameId);
  } catch (err: unknown) {
    error = buildApiRefusalMessage(err, "Could not record your vote");
  }
  try {
    const vote = await api.getVote(target.year, userId);
    if (!vote) {
      return { panel: null, error: error ?? `There is no GOTY Vote for ${target.year}.` };
    }
    const listed = awardOf(vote, target.award)?.ballot.find((game) => game.game_id === gameId);
    const cast = result?.vote?.game ?? result?.removed_votes[0]?.game;
    const notice = result ? castNoticeText(result, gameTitle(listed ?? cast, gameId)) : null;
    return { panel: buildGotyAwardPanel(vote, target.award, notice), error };
  } catch (err: unknown) {
    return {
      panel: null,
      error: error ?? buildApiRefusalMessage(err, "Could not refresh the GOTY Vote panel"),
    };
  }
}
