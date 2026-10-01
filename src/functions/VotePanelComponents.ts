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
import type { IVoteEntry } from "../classes/Vote.js";
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
} from "../config/textLimits.js";
import { buildMyVotesText, dedupeNominationsByGame } from "./VoteResultsUtils.js";

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

export const LIVE_VOTE_PANEL_IDS: IVotePanelIds = {
  pick: (kind, roundNumber, nominationId) =>
    `vote-pick:${kind}:${roundNumber}:${nominationId}`,
  cast: (kind, roundNumber, chunk) => `vote-cast:${kind}:${roundNumber}:${chunk}`,
  mine: (kind, roundNumber) => `vote-mine:${kind}:${roundNumber}`,
  tally: (kind, roundNumber) => `vote-tally:${kind}:${roundNumber}`,
};

export interface IVotePanelParams {
  kind: NominationKind;
  roundNumber: number;
  /** The month the round's winners are played, e.g. "November 2026". */
  monthLabel?: string | null;
  voteDeadline: Date | null;
  cap: number;
  nominations: INominationEntry[];
  /** When provided (the personal /vote panel), the panel lists these votes. */
  myVotes?: IVoteEntry[] | null;
  /**
   * Marks the panel as a rehearsal: /admin voting-open testmode:true (whose
   * casts are real votes) or the voting sandbox. The banner says which.
   */
  testNotice?: string | null;
  ids?: IVotePanelIds;
}

const GAME_BUTTONS_PER_ROW = 5;
/** The My Votes and Results row: the row and its two buttons. */
const FOOTER_ROW_COMPONENTS = 3;

/**
 * Components the container holds: itself, the heading, a separator and the
 * details, plus a separator and the votes list on the personal panel.
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

/**
 * A ballot laid out like the club's long-running survey polls: a container
 * with the question and the rules, then one button per game, then the My
 * Votes and Results buttons.
 */
export function buildVotePanelComponents(params: IVotePanelParams): VotePanelComponent[] {
  const ids = params.ids ?? LIVE_VOTE_PANEL_IDS;
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
  return [buildPanelContainer(params, useButtons), ...gameRows, footerRow];
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

function buildPanelContainer(params: IVotePanelParams, useButtons: boolean): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(COLOR_PRIMARY);
  addText(container, buildPanelHeadingText(params));
  addSeparator(container);
  addText(container, buildPanelDetailsText(params, useButtons));
  if (params.myVotes) {
    addSeparator(container);
    addText(
      container,
      buildMyVotesText({
        kindLabel: nominationKindLabel(params.kind),
        roundNumber: params.roundNumber,
        votes: params.myVotes,
        cap: params.cap,
      }),
    );
  }
  return container;
}

function buildPanelHeadingText(params: IVotePanelParams): string {
  const label = nominationKindLabel(params.kind);
  const gamesWord = params.cap === 1 ? "game" : "game(s)";
  const question = params.monthLabel
    ? `Which ${gamesWord} should be the ${label} for **${params.monthLabel}**?`
    : `Which ${gamesWord} should win ${label} Round ${params.roundNumber}?`;
  const lines = [`## 🗳️ ${label} Vote - Round ${params.roundNumber}`, question];
  if (params.testNotice) {
    lines.unshift(params.testNotice);
  }
  return lines.join("\n");
}

function buildPanelDetailsText(params: IVotePanelParams, useButtons: boolean): string {
  const gamesNoun = params.cap === 1 ? "game" : "games";
  const control = useButtons ? "Press" : "Pick";
  const lines = [
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
