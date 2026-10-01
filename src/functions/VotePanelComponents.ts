import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { ButtonBuilder } from "@discordjs/builders";
import {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import { nominationKindLabel } from "../classes/Nomination.js";
import type { IVoteEntry, VoteBallot } from "../classes/Vote.js";
import { buildTextContainer, safeV2TextContent } from "./ComponentsV2Utils.js";
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
import {
  DISCORD_BUTTON_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
  DISCORD_V2_COMPONENTS_MAX,
  MAX_CONTAINER_TEXT,
} from "../config/textLimits.js";
import {
  addNominationSection,
  addVoteImageToContainer,
} from "./NominationListComponents.js";
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
   * casts are real votes) or the voting sandbox. A small footer line says which.
   */
  testNotice?: string | null;
  ids?: IVotePanelIds;
  /**
   * The nominations list's presentation, for the posted panels: its composed
   * vote image and each nominator's name. Without it the games are a title list.
   */
  art?: IVotePanelArt | null;
}

export interface IVotePanelArt {
  voteImageUrl: string | null;
  /** Display names by user id for the nominator buttons; null lists the titles instead. */
  nominatorNames: ReadonlyMap<string, string> | null;
}

const GAME_BUTTONS_PER_ROW = 5;
/** Each reason's most, when the text budget has room for it. */
const PANEL_REASON_MAX = 300;
/** A reason shorter than this says too little, so the reasons are left out. */
const PANEL_REASON_MIN = 40;
/**
 * The listed games' text may total this much, so the panel stays inside
 * Discord's 4000 text characters. Past it the reasons are shortened or left
 * out, and a title list is truncated.
 */
const GAME_LIST_TEXT_BUDGET = 2400;
/** A nomination section: the section, its text and the nominator button. */
const NOMINATION_SECTION_COMPONENTS = 3;
/** The vote image: its media gallery and the separator under it. */
const VOTE_IMAGE_COMPONENTS = 2;
/** The My Votes and Results row: the row and its two buttons. */
const FOOTER_ROW_COMPONENTS = 3;

/**
 * Components every panel has: the header container and its text, then the
 * panel container, a separator and the rules, plus a separator and the votes
 * list on the personal panel. The games come between, counted separately.
 */
function countFixedComponents(params: IVotePanelParams): number {
  return 5 + (params.myVotes ? 2 : 0);
}

/** The game list as one text display, the layout every ballot has room for. */
const TITLE_LIST_COMPONENTS = 1;

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
    countFixedComponents(params) +
      TITLE_LIST_COMPONENTS +
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

/** True when the composed vote image fits above the games. */
function fitsVoteImage(params: IVotePanelParams, gameCount: number, useButtons: boolean): boolean {
  return (
    countFixedComponents(params) +
      VOTE_IMAGE_COMPONENTS +
      TITLE_LIST_COMPONENTS +
      countControlComponents(useButtons, gameCount) <=
    DISCORD_V2_COMPONENTS_MAX
  );
}

/**
 * True when every game fits as a nomination section, under the vote image when
 * it is shown. A ballot too large for that lists the titles instead.
 */
function fitsNominationSections(
  params: IVotePanelParams,
  gameCount: number,
  useButtons: boolean,
  withImage: boolean,
): boolean {
  return (
    countFixedComponents(params) +
      (withImage ? VOTE_IMAGE_COMPONENTS : 0) +
      gameCount * NOMINATION_SECTION_COMPONENTS +
      countControlComponents(useButtons, gameCount) <=
    DISCORD_V2_COMPONENTS_MAX
  );
}

/** What a panel has room for, so a poster fetches only what will be shown. */
export function planVotePanelArt(params: IVotePanelParams): {
  voteImage: boolean;
  nominationSections: boolean;
} {
  const games = dedupeNominationsByGame(params.nominations);
  if (!games.length) return { voteImage: false, nominationSections: false };
  const useButtons = fitsGameButtons(params, games.length);
  const voteImage = fitsVoteImage(params, games.length, useButtons);
  return {
    voteImage,
    nominationSections: fitsNominationSections(params, games.length, useButtons, voteImage),
  };
}

/**
 * A ballot laid out like the nominations list: a header with the question,
 * then a container with the vote image, the games and the rules, then one
 * button per game and the My Votes and Results buttons.
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
  const art = params.art ?? null;
  const voteImageUrl = art?.voteImageUrl && fitsVoteImage(params, games.length, useButtons)
    ? art.voteImageUrl
    : null;
  const nominatorNames = art?.nominatorNames &&
    fitsNominationSections(params, games.length, useButtons, Boolean(voteImageUrl))
    ? art.nominatorNames
    : null;
  return [
    buildTextContainer(buildPanelHeadingText(params)),
    buildPanelContainer(params, games, useButtons, voteImageUrl, nominatorNames),
    ...gameRows,
    footerRow,
  ];
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
  voteImageUrl: string | null,
  nominatorNames: ReadonlyMap<string, string> | null,
): ContainerBuilder {
  // No accent, like the nominations list the panel mirrors.
  const container = new ContainerBuilder();
  addVoteImageToContainer(container, voteImageUrl);
  if (nominatorNames) {
    const reasonMax = panelReasonMax(games);
    for (const game of games) {
      const displayName = nominatorNames.get(game.userId) ?? game.userId;
      addNominationSection(container, game, displayName, reasonMax);
    }
  } else {
    addText(container, buildTitleListText(games));
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

/**
 * Each reason's share of the text budget once the titles are in, capped at
 * PANEL_REASON_MAX; 0, leaving the reasons out, when the share is too small.
 */
function panelReasonMax(games: INominationEntry[]): number {
  const titles = games.reduce((sum, game) => sum + game.gameTitle.length + 8, 0);
  const share = Math.floor((GAME_LIST_TEXT_BUDGET - titles) / games.length);
  return share < PANEL_REASON_MIN ? 0 : Math.min(share, PANEL_REASON_MAX);
}

/**
 * One line per game, cut at whole lines once the list passes the text budget.
 * Every game left off still has its button or select option.
 */
function buildTitleListText(games: INominationEntry[]): string {
  const lines: string[] = [];
  let length = 0;
  for (const [index, game] of games.entries()) {
    const line = `- **${truncateWithEllipsis(game.gameTitle, DISCORD_BUTTON_LABEL_MAX)}**`;
    if (length + line.length > GAME_LIST_TEXT_BUDGET) {
      lines.push(`-# ...and ${games.length - index} more`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

function buildPanelHeadingText(params: IVotePanelParams): string {
  const label = nominationKindLabel(params.kind);
  const gamesWord = params.cap === 1 ? "game" : "game(s)";
  const question = params.monthLabel
    ? `Which ${gamesWord} should be the ${label} for **${params.monthLabel}**?`
    : `Which ${gamesWord} should win ${label} Round ${params.roundNumber}?`;
  const title = params.ballot === "runoff" ? "Runoff" : "Vote";
  return `## ${label} ${title} - Round ${params.roundNumber}\n${question}`;
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
  if (params.testNotice) {
    lines.push(params.testNotice);
  }
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
