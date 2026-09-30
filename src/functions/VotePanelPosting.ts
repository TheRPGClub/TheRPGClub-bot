import { channelMention, type Client } from "discord.js";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import { NOMINATION_KINDS, nominationKindLabel } from "../classes/Nomination.js";
import {
  apiVotingDataSource,
  type IVotingDataSource,
} from "../services/VotingDataSource.js";
import { fetchSendableChannel } from "./ChannelUtils.js";
import { buildComponentsV2Flags } from "./ComponentsV2Utils.js";
import {
  buildVotePanelComponents,
  type IVotePanelIds,
  type VotePanelComponent,
} from "./VotePanelComponents.js";
import { buildTestPanelNoticeText, dedupeNominationsByGame } from "./VoteResultsUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { describeDiscordRestError } from "../utilities/ApiErrorUtils.js";

// Posting a round's voting panels, shared by /admin voting-open and the
// voting_opened voting event (VotingEventService), which has no interaction.

/** Null once sent; otherwise why it was not. */
async function sendPanelToChannel(
  client: Client,
  channelId: string,
  components: VotePanelComponent[],
): Promise<string | null> {
  try {
    const sendable = await fetchSendableChannel(client, channelId);
    if (!sendable) {
      return "the channel was not found or is not a text channel";
    }
    await sendable.send({
      components,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
    return null;
  } catch (error) {
    logError("VotePanelPosting.sendPanelToChannel", error);
    // The request body is the whole panel, so it is left to the log above.
    return describeDiscordRestError(error);
  }
}

export async function loadNominationsByKind(
  roundNumber: number,
  source: IVotingDataSource = apiVotingDataSource,
): Promise<Map<NominationKind, INominationEntry[]>> {
  const byKind = new Map<NominationKind, INominationEntry[]>();
  for (const kind of NOMINATION_KINDS) {
    byKind.set(kind, await source.listNominations(kind, roundNumber));
  }
  return byKind;
}

export function hasVotableNominations(
  nominationsByKind: Map<NominationKind, INominationEntry[]>,
): boolean {
  return [...nominationsByKind.values()].some(
    (nominations) => dedupeNominationsByGame(nominations).length > 0,
  );
}

export interface IPostVotePanelsParams {
  client: Client;
  channelId: string;
  roundNumber: number;
  voteDeadline: Date | null;
  nominationsByKind: Map<NominationKind, INominationEntry[]>;
  /** Adds the rehearsal banner; the controls themselves are unchanged. */
  testMode?: boolean;
  castsAccepted?: boolean;
  castsRefusedReason?: string | null;
  /** A banner of the caller's own, used in place of the testMode one. */
  notice?: string;
  /** Where the tally (for the cap) is read; the API unless the sandbox runs. */
  source?: IVotingDataSource;
  ids?: IVotePanelIds;
}

export interface IPostVotePanelsResult {
  /** What happened, one line per category. */
  lines: string[];
  posted: number;
  failed: number;
}

/** Posts one panel per category and reports what happened. */
export async function postVotePanels(
  params: IPostVotePanelsParams,
): Promise<IPostVotePanelsResult> {
  const resultLines: string[] = [];
  let posted = 0;
  let failed = 0;
  for (const kind of NOMINATION_KINDS) {
    const kindLabel = nominationKindLabel(kind);
    const nominations = params.nominationsByKind.get(kind) ?? [];
    if (!dedupeNominationsByGame(nominations).length) {
      resultLines.push(`${kindLabel}: no votable nominations; panel skipped.`);
      continue;
    }
    const tally = await (params.source ?? apiVotingDataSource).getTally(
      kind,
      params.roundNumber,
    );
    const components = buildVotePanelComponents({
      kind,
      roundNumber: params.roundNumber,
      voteDeadline: params.voteDeadline,
      cap: tally.cap,
      nominations,
      ids: params.ids,
      testNotice: params.notice ?? (params.testMode
        ? buildTestPanelNoticeText({
            kindLabel,
            roundNumber: params.roundNumber,
            castsAccepted: Boolean(params.castsAccepted),
            reason: params.castsRefusedReason ?? null,
          })
        : null),
    });
    const failure = await sendPanelToChannel(params.client, params.channelId, components);
    const sent = failure === null;
    if (sent) {
      posted += 1;
    } else {
      failed += 1;
    }
    resultLines.push(
      sent
        ? `${kindLabel}: voting panel posted in ${channelMention(params.channelId)}.`
        : `${kindLabel}: failed to post the voting panel in ` +
          `${channelMention(params.channelId)}: ${failure}`,
    );
  }
  return { lines: resultLines, posted, failed };
}
