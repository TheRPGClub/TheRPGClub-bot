import {
  ActionRowBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import type { ButtonBuilder } from "@discordjs/builders";
import { ContainerBuilder } from "@discordjs/builders";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import { nominationKindLabel } from "../classes/Nomination.js";
import type { IVoteEntry, VoteBallot } from "../classes/Vote.js";
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
  cast(kind: NominationKind, roundNumber: number, chunk: number): string;
  mine(kind: NominationKind, roundNumber: number): string;
  tally(kind: NominationKind, roundNumber: number): string;
}

/** Custom id prefixes of the live panels, per ballot. */
export const LIVE_VOTE_PANEL_PREFIX: Record<VoteBallot, Record<keyof IVotePanelIds, string>> = {
  main: { cast: "vote-cast", mine: "vote-mine", tally: "vote-tally" },
  runoff: { cast: "vote-runoff-cast", mine: "vote-runoff-mine", tally: "vote-runoff-tally" },
};

function buildLivePanelIds(ballot: VoteBallot): IVotePanelIds {
  const prefix = LIVE_VOTE_PANEL_PREFIX[ballot];
  return {
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
  voteDeadline: Date | null;
  cap: number;
  /** For a runoff panel, only the category's tied games. */
  nominations: INominationEntry[];
  /** The main vote (the default) or the tie-breaker runoff. */
  ballot?: VoteBallot;
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
  const ids = params.ids ?? LIVE_VOTE_PANEL_IDS[params.ballot ?? "main"];
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
  const runoff = params.ballot === "runoff";
  const gamesNoun = params.cap === 1 ? "game" : "games";
  const lines = runoff
    ? [
        `## 🗳️ ${label} Runoff - Round ${params.roundNumber}`,
        `The ${label} vote ended in a tie, so this runoff between the tied games decides ` +
          `the winner. Vote for **${params.cap}** ${gamesNoun} using the menu below. ` +
          "Picking the game you voted for takes that vote back.",
      ]
    : [
        `## 🗳️ ${label} Voting - Round ${params.roundNumber}`,
        `Vote for up to **${params.cap}** ${gamesNoun} using the menu below. ` +
          "Picking a game you already voted for takes that vote back.",
      ];
  if (params.testNotice) {
    lines.splice(1, 0, params.testNotice);
  }
  const what = runoff ? "The runoff" : "Voting";
  if (params.voteDeadline) {
    const deadlineUnix = toUnixTimestamp(params.voteDeadline);
    lines.push(`${what} closes <t:${deadlineUnix}:F> (<t:${deadlineUnix}:R>).`);
  }
  lines.push(
    `-# Votes are anonymous while ${what.toLowerCase()} is open. ` +
      `Results are revealed when it ends.`,
  );
  if (params.myVotes) {
    lines.push(
      buildMyVotesText({
        kindLabel: ballotKindLabel(label, params.ballot ?? "main"),
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
