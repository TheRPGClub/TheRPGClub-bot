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

export interface IVotePanelParams {
  kind: NominationKind;
  roundNumber: number;
  voteDeadline: Date | null;
  cap: number;
  nominations: INominationEntry[];
  /** When provided (the personal /vote panel), the header lists these votes. */
  myVotes?: IVoteEntry[] | null;
}

export function buildVotePanelComponents(params: IVotePanelParams): VotePanelComponent[] {
  const header = buildTextContainer(buildPanelHeaderText(params));
  const selectRows = buildVoteSelectRows(params.kind, params.roundNumber, params.nominations);
  const buttonRow = buildButtonRow(
    buildActionButton({
      customId: validateCustomId(`vote-mine:${params.kind}:${params.roundNumber}`),
      label: "My Votes",
      style: ButtonStyle.Secondary,
    }),
    buildActionButton({
      customId: validateCustomId(`vote-tally:${params.kind}:${params.roundNumber}`),
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
  kind: NominationKind,
  roundNumber: number,
  nominations: INominationEntry[],
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options: ISelectOptionInput[] = dedupeNominationsByGame(nominations).map(
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
      .setCustomId(validateCustomId(`vote-cast:${kind}:${roundNumber}:${rows.length}`))
      .setPlaceholder("Cast or take back a vote...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(buildSelectOptions(chunk));
    rows.push(buildSelectRow(select));
  }
  return rows;
}
