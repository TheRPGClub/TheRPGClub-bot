import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { ButtonBuilder } from "@discordjs/builders";
import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import { nominationKindLabel } from "../classes/Nomination.js";
import type { IVoteEntry, VoteBallot } from "../classes/Vote.js";
import { safeV2TextContent } from "./ComponentsV2Utils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectOptions,
  buildSelectRow,
  type ISelectOptionInput,
} from "./uiComponents.js";
import { validateCustomId } from "../utilities/CustomIdUtils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { chunk } from "../utilities/ArrayUtils.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";
import { COLOR_PRIMARY } from "../config/colors.js";
import {
  DISCORD_BUTTON_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_V2_COMPONENTS_MAX,
  MAX_CONTAINER_TEXT,
  MAX_SECTION_TEXT,
} from "../config/textLimits.js";
import {
  ballotKindLabel,
  buildMyVotesText,
  dedupeNominationsByGame,
} from "./VoteResultsUtils.js";

export type VotePanelComponent =
  | ContainerBuilder
  | ActionRowBuilder<StringSelectMenuBuilder>
  | ActionRowBuilder<ButtonBuilder>;

/**
 * Custom ids a panel's controls carry. Live panels route to /vote's handlers;
 * the voting sandbox swaps in ids that route to its own round.
 */
export interface IVotePanelIds {
  /** One game's vote button; the nomination id is in the id, so it survives a restart. */
  pick(kind: NominationKind, roundNumber: number, nominationId: number): string;
  /** The select fallback for a ballot too large for one button per game. */
  cast(kind: NominationKind, roundNumber: number, chunk: number): string;
  mine(kind: NominationKind, roundNumber: number): string;
  tally(kind: NominationKind, roundNumber: number): string;
}

/** Custom id prefixes of the live panels, per ballot. */
export const LIVE_VOTE_PANEL_PREFIX: Record<VoteBallot, Record<keyof IVotePanelIds, string>> = {
  main: { pick: "vote-pick", cast: "vote-cast", mine: "vote-mine", tally: "vote-tally" },
  runoff: {
    pick: "vote-runoff-pick",
    cast: "vote-runoff-cast",
    mine: "vote-runoff-mine",
    tally: "vote-runoff-tally",
  },
};

function buildLivePanelIds(ballot: VoteBallot): IVotePanelIds {
  const prefix = LIVE_VOTE_PANEL_PREFIX[ballot];
  return {
    pick: (kind, roundNumber, nominationId) =>
      `${prefix.pick}:${kind}:${roundNumber}:${nominationId}`,
    cast: (kind, roundNumber, chunk) => `${prefix.cast}:${kind}:${roundNumber}:${chunk}`,
    mine: (kind, roundNumber) => `${prefix.mine}:${kind}:${roundNumber}`,
    tally: (kind, roundNumber) => `${prefix.tally}:${kind}:${roundNumber}`,
  };
}

/** Live panel ids per ballot; a runoff panel's ids name the runoff ballot. */
export const LIVE_VOTE_PANEL_IDS: Record<VoteBallot, IVotePanelIds> = {
  main: buildLivePanelIds("main"),
  runoff: buildLivePanelIds("runoff"),
};

export interface IVotePanelParams {
  kind: NominationKind;
  roundNumber: number;
  /** The month the round's winners are played, e.g. "November 2026". */
  monthLabel?: string | null;
  voteDeadline: Date | null;
  cap: number;
  /** For a runoff panel, only the category's tied games. */
  nominations: INominationEntry[];
  /** The main vote (the default) or the tie-breaker runoff. */
  ballot?: VoteBallot;
  /** When provided (the personal /vote panel), the panel lists these votes. */
  myVotes?: IVoteEntry[] | null;
  /**
   * Marks the panel as a rehearsal: /admin voting-open testmode:true (whose
   * casts are real votes) or the voting sandbox. The banner says which.
   */
  testNotice?: string | null;
  ids?: IVotePanelIds;
  /**
   * Cover URLs by GameDB id. Given, each game is listed with its cover as a
   * thumbnail while the panel fits Discord's component limit.
   */
  coverUrls?: ReadonlyMap<number, string> | null;
}

const GAME_BUTTONS_PER_ROW = 5;
const PANEL_REASON_MAX = 200;
/**
 * The listed games' text may total this much, so the panel stays inside
 * Discord's 4000 text characters. Past it a cover list drops its reasons and a
 * title list is truncated.
 */
const GAME_LIST_TEXT_BUDGET = 2400;
/** A section with a thumbnail is the section, its text and the thumbnail. */
const COVER_SECTION_COMPONENTS = 3;
/** The My Votes and Results row: the row and its two buttons. */
const FOOTER_ROW_COMPONENTS = 3;

/**
 * Components the container holds: itself, the heading (which carries the game
 * list when there are no covers), a separator and the details, plus a
 * separator and the votes list on the personal panel.
 */
function countContainerComponents(params: IVotePanelParams): number {
  return 4 + (params.myVotes ? 2 : 0);
}

/** Each game is a button, and every five share a row. */
function countGameButtonComponents(gameCount: number): number {
  return gameCount + Math.ceil(gameCount / GAME_BUTTONS_PER_ROW);
}

/**
 * True when one button per game fits under Discord's component limit. Larger
 * ballots fall back to select menus, which hold 25 games per row.
 */
function fitsGameButtons(params: IVotePanelParams, gameCount: number): boolean {
  return (
    countContainerComponents(params) +
      countGameButtonComponents(gameCount) +
      FOOTER_ROW_COMPONENTS <=
    DISCORD_V2_COMPONENTS_MAX
  );
}

/** The games, the vote buttons or select rows, and the footer row. */
function countControlComponents(useButtons: boolean, gameCount: number): number {
  const controls = useButtons
    ? countGameButtonComponents(gameCount)
    : 2 * Math.ceil(gameCount / DISCORD_SELECT_OPTIONS_MAX);
  return controls + FOOTER_ROW_COMPONENTS;
}

/** One section per game with a cover, one text line per game without. */
function countCoverListComponents(
  games: INominationEntry[],
  coverUrls: ReadonlyMap<number, string>,
): number {
  return games.reduce(
    (sum, game) => sum + (coverUrls.has(game.gamedbGameId) ? COVER_SECTION_COMPONENTS : 1),
    0,
  );
}

/**
 * True when at least one game's cover could fit, so fetching the covers is
 * worth it. A ballot past this lists its titles whatever covers exist.
 */
export function couldListCovers(params: IVotePanelParams): boolean {
  const games = dedupeNominationsByGame(params.nominations);
  if (!games.length) return false;
  const useButtons = fitsGameButtons(params, games.length);
  return (
    countContainerComponents(params) +
      COVER_SECTION_COMPONENTS +
      (games.length - 1) +
      countControlComponents(useButtons, games.length) <=
    DISCORD_V2_COMPONENTS_MAX
  );
}

/**
 * True when the games can be listed with their covers. A ballot too large for
 * that keeps its buttons and lists the titles in the heading instead.
 */
function fitsCoverList(
  params: IVotePanelParams,
  games: INominationEntry[],
  useButtons: boolean,
): boolean {
  const coverUrls = params.coverUrls;
  if (!coverUrls || !games.some((game) => coverUrls.has(game.gamedbGameId))) {
    return false;
  }
  return (
    countContainerComponents(params) +
      countCoverListComponents(games, coverUrls) +
      countControlComponents(useButtons, games.length) <=
    DISCORD_V2_COMPONENTS_MAX
  );
}

/**
 * A ballot laid out like the club's long-running survey polls: a container
 * with the question, the games and the rules, then one button per game, then
 * the My Votes and Results buttons.
 */
export function buildVotePanelComponents(params: IVotePanelParams): VotePanelComponent[] {
  const ids = params.ids ?? LIVE_VOTE_PANEL_IDS[params.ballot ?? "main"];
  const games = dedupeNominationsByGame(params.nominations);
  const useButtons = fitsGameButtons(params, games.length);
  const gameRows = useButtons
    ? buildGameButtonRows(params, games, ids)
    : buildVoteSelectRows(params, games, ids);
  const footerRow = buildButtonRow(
    buildActionButton({
      customId: validateCustomId(ids.mine(params.kind, params.roundNumber)),
      label: "My Votes",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: validateCustomId(ids.tally(params.kind, params.roundNumber)),
      label: "Results",
      style: ButtonStyle.Secondary,
    }),
  );
  const withCovers = fitsCoverList(params, games, useButtons);
  return [buildPanelContainer(params, games, useButtons, withCovers), ...gameRows, footerRow];
}

function addText(container: ContainerBuilder, content: string): void {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT)),
  );
}

function addSeparator(container: ContainerBuilder): void {
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );
}

function buildPanelContainer(
  params: IVotePanelParams,
  games: INominationEntry[],
  useButtons: boolean,
  withCovers: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(COLOR_PRIMARY);
  const heading = buildPanelHeadingText(params);
  if (withCovers) {
    addText(container, heading);
    const withReasons = fitsReasons(games);
    for (const game of games) {
      addGameEntry(container, game, withReasons, params.coverUrls?.get(game.gamedbGameId));
    }
  } else {
    // Capped so the heading, list and rules stay inside Discord's 4000 text characters;
    // a truncated list still has every game on its button or select option.
    const list = safeV2TextContent(
      games.map((game) => `- **${game.gameTitle}**`).join("\n"),
      GAME_LIST_TEXT_BUDGET,
    );
    addText(container, `${heading}\n${list}`);
  }
  addSeparator(container);
  addText(container, buildPanelDetailsText(params, useButtons));
  if (params.myVotes) {
    addSeparator(container);
    addText(
      container,
      buildMyVotesText({
        kindLabel: ballotKindLabel(nominationKindLabel(params.kind), params.ballot ?? "main"),
        roundNumber: params.roundNumber,
        votes: params.myVotes,
        cap: params.cap,
      }),
    );
  }
  return container;
}

function buildGameEntryText(game: INominationEntry, withReason: boolean): string {
  const reason = withReason ? game.reason?.replace(/\s+/g, " ").trim() : null;
  return reason
    ? `**${game.gameTitle}**\n> ${truncateWithEllipsis(reason, PANEL_REASON_MAX)}`
    : `**${game.gameTitle}**`;
}

function fitsReasons(games: INominationEntry[]): boolean {
  const total = games.reduce((sum, game) => sum + buildGameEntryText(game, true).length, 0);
  return total <= GAME_LIST_TEXT_BUDGET;
}

/** A game with its cover as a thumbnail, or a plain text line when it has none. */
function addGameEntry(
  container: ContainerBuilder,
  game: INominationEntry,
  withReason: boolean,
  coverUrl: string | undefined,
): void {
  const text = new TextDisplayBuilder().setContent(
    safeV2TextContent(buildGameEntryText(game, withReason), MAX_SECTION_TEXT),
  );
  if (!coverUrl) {
    container.addTextDisplayComponents(text);
    return;
  }
  const section = new SectionBuilder().addTextDisplayComponents(text);
  section.setThumbnailAccessory(new ThumbnailBuilder().setURL(coverUrl));
  container.addSectionComponents(section);
}

function buildPanelHeadingText(params: IVotePanelParams): string {
  const label = nominationKindLabel(params.kind);
  const gamesWord = params.cap === 1 ? "game" : "game(s)";
  const question = params.monthLabel
    ? `Which ${gamesWord} should be the ${label} for **${params.monthLabel}**?`
    : `Which ${gamesWord} should win ${label} Round ${params.roundNumber}?`;
  const title = params.ballot === "runoff" ? "Runoff" : "Vote";
  const lines = [`## 🗳️ ${label} ${title} - Round ${params.roundNumber}`, question];
  if (params.testNotice) {
    lines.unshift(params.testNotice);
  }
  return lines.join("\n");
}

function buildPanelDetailsText(params: IVotePanelParams, useButtons: boolean): string {
  const gamesNoun = params.cap === 1 ? "game" : "games";
  const control = useButtons ? "Press" : "Pick";
  const lines = [
    ...(params.ballot === "runoff"
      ? [
          `🤝 The ${nominationKindLabel(params.kind)} vote ended in a tie, so this runoff ` +
            "between the tied games decides the winner",
        ]
      : []),
    "🙈 Votes are anonymous, and results stay hidden until voting ends",
    `🔢 Vote for up to **${params.cap}** ${gamesNoun}`,
    `↩️ ${control} a game you already voted for to take that vote back`,
  ];
  if (params.voteDeadline) {
    const deadlineUnix = toUnixTimestamp(params.voteDeadline);
    lines.push(`⏳ Ends <t:${deadlineUnix}:R> (<t:${deadlineUnix}:F>)`);
  }
  lines.push("🔒 Members role required");
  return lines.join("\n");
}

function buildGameButtonRows(
  params: IVotePanelParams,
  games: INominationEntry[],
  ids: IVotePanelIds,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = games.map((nomination) =>
    buildActionButton({
      customId: validateCustomId(ids.pick(params.kind, params.roundNumber, nomination.id)),
      label: truncateWithEllipsis(nomination.gameTitle, DISCORD_BUTTON_LABEL_MAX),
      style: ButtonStyle.Secondary,
    }),
  );
  return chunk(buttons, GAME_BUTTONS_PER_ROW).map((row) => buildButtonRow(...row));
}

function buildVoteSelectRows(
  params: IVotePanelParams,
  games: INominationEntry[],
  ids: IVotePanelIds,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options: ISelectOptionInput[] = games.map((nomination) => ({
    label: nomination.gameTitle,
    value: String(nomination.id),
    description: nomination.reason ?? undefined,
  }));
  return chunk(options, DISCORD_SELECT_OPTIONS_MAX).map((page, index) => {
    const select = new StringSelectMenuBuilder()
      .setCustomId(validateCustomId(ids.cast(params.kind, params.roundNumber, index)))
      .setPlaceholder("Cast or take back a vote...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildSelectOptions(page));
    return buildSelectRow(select);
  });
}
