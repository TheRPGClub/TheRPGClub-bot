import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { ButtonBuilder } from "@discordjs/builders";
import { ContainerBuilder } from "@discordjs/builders";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import { nominationKindLabel } from "../classes/Nomination.js";
import type { IVoteEntry } from "../classes/Vote.js";
import { buildTextContainer } from "./ComponentsV2Utils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildSelectOptions,
  buildSelectRow,
  type ISelectOptionInput,
} from "./uiComponents.js";
import { validateCustomId } from "../utilities/CustomIdUtils.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";
import { DISCORD_SELECT_OPTIONS_MAX } from "../config/textLimits.js";
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
  cast(kind: NominationKind, roundNumber: number, chunk: number): string;
  mine(kind: NominationKind, roundNumber: number): string;
  tally(kind: NominationKind, roundNumber: number): string;
}

export const LIVE_VOTE_PANEL_IDS: IVotePanelIds = {
  cast: (kind, roundNumber, chunk) => `vote-cast:${kind}:${roundNumber}:${chunk}`,
  mine: (kind, roundNumber) => `vote-mine:${kind}:${roundNumber}`,
  tally: (kind, roundNumber) => `vote-tally:${kind}:${roundNumber}`,
};

export interface IVotePanelParams {
  kind: NominationKind;
  roundNumber: number;
  voteDeadline: Date | null;
  cap: number;
  nominations: INominationEntry[];
  /** When provided (the personal /vote panel), the header lists these votes. */
  myVotes?: IVoteEntry[] | null;
  /**
   * Marks the panel as a rehearsal: /admin voting-open testmode:true (whose
   * casts are real votes) or the voting sandbox. The banner says which.
   */
  testNotice?: string | null;
  ids?: IVotePanelIds;
}

export function buildVotePanelComponents(params: IVotePanelParams): VotePanelComponent[] {
  const ids = params.ids ?? LIVE_VOTE_PANEL_IDS;
  const header = buildTextContainer(buildPanelHeaderText(params));
  const selectRows = buildVoteSelectRows(params, ids);
  const buttonRow = buildButtonRow(
    buildActionButton({
      customId: validateCustomId(ids.mine(params.kind, params.roundNumber)),
      label: "My Votes",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: validateCustomId(ids.tally(params.kind, params.roundNumber)),
      label: "Results",
      style: ButtonStyle.Primary,
    }),
  );
  return [header, ...selectRows, buttonRow];
}

function buildPanelHeaderText(params: IVotePanelParams): string {
  const label = nominationKindLabel(params.kind);
  const gamesNoun = params.cap === 1 ? "game" : "games";
  const lines = [
    `## 🗳️ ${label} Voting - Round ${params.roundNumber}`,
    `Vote for up to **${params.cap}** ${gamesNoun} using the menu below. ` +
      "Picking a game you already voted for takes that vote back.",
  ];
  if (params.testNotice) {
    lines.splice(1, 0, params.testNotice);
  }
  if (params.voteDeadline) {
    const deadlineUnix = toUnixTimestamp(params.voteDeadline);
    lines.push(`Voting closes <t:${deadlineUnix}:F> (<t:${deadlineUnix}:R>).`);
  }
  lines.push(
    "-# Votes are anonymous while voting is open. Results are revealed when voting ends.",
  );
  if (params.myVotes) {
    lines.push(
      buildMyVotesText({
        kindLabel: label,
        roundNumber: params.roundNumber,
        votes: params.myVotes,
        cap: params.cap,
      }),
    );
  }
  return lines.join("\n");
}

function buildVoteSelectRows(
  params: IVotePanelParams,
  ids: IVotePanelIds,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options: ISelectOptionInput[] = dedupeNominationsByGame(params.nominations).map(
    (nomination) => ({
      label: nomination.gameTitle,
      value: String(nomination.id),
      description: nomination.reason ?? undefined,
    }),
  );
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  for (let i = 0; i < options.length; i += DISCORD_SELECT_OPTIONS_MAX) {
    const chunk = options.slice(i, i + DISCORD_SELECT_OPTIONS_MAX);
    const select = new StringSelectMenuBuilder()
      .setCustomId(validateCustomId(ids.cast(params.kind, params.roundNumber, rows.length)))
      .setPlaceholder("Cast or take back a vote...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildSelectOptions(chunk));
    rows.push(buildSelectRow(select));
  }
  return rows;
}
