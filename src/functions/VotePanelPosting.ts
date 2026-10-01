import { channelMention, type AttachmentBuilder, type Client } from "discord.js";
import type { INominationEntry, NominationKind } from "../classes/Nomination.js";
import type { VoteBallot } from "../classes/Vote.js";
import { NOMINATION_KINDS, nominationKindLabel } from "../classes/Nomination.js";
import {
  apiVotingDataSource,
  type IVotingDataSource,
} from "../services/VotingDataSource.js";
import { fetchSendableChannel } from "./ChannelUtils.js";
import { buildComponentsV2Flags } from "./ComponentsV2Utils.js";
import {
  buildVotePanelComponents,
  planVotePanelArt,
  type IVotePanelArt,
  type IVotePanelIds,
  type IVotePanelParams,
  type VotePanelComponent,
} from "./VotePanelComponents.js";
import { buildTestPanelNoticeText, dedupeNominationsByGame } from "./VoteResultsUtils.js";
import { buildNominatorDisplayNames } from "./NominationListComponents.js";
import { logError } from "../utilities/LogUtils.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";

// Posting a round's voting panels, shared by /admin voting-open and the
// voting_opened voting event (VotingEventService), which has no interaction.

/** Null once sent; otherwise why it was not. */
async function sendPanelToChannel(
  client: Client,
  channelId: string,
  components: VotePanelComponent[],
  files: AttachmentBuilder[],
): Promise<string | null> {
  try {
    const sendable = await fetchSendableChannel(client, channelId);
    if (!sendable) {
      return "the channel was not found or is not a text channel";
    }
    await sendable.send({
      components,
      files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
    return null;
  } catch (error) {
    logError("VotePanelPosting.sendPanelToChannel", error);
    // The request body is the whole panel, so it is left to the log above.
    return describeRequestError(error);
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
  /** The month the round's winners are played, for the panel's question. */
  monthLabel?: string | null;
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
  /**
   * The main vote (the default) or the tie-breaker runoff, whose
   * `nominationsByKind` holds only each tied category's tied games.
   */
  ballot?: VoteBallot;
}

export interface IPostVotePanelsResult {
  /** What happened, one line per category. */
  lines: string[];
  posted: number;
  failed: number;
}

/**
 * The nominations list's presentation for a posted panel: the composed vote
 * image and the nominators' names, each fetched only when the panel has room.
 */
async function loadPanelArt(
  source: IVotingDataSource,
  panelParams: IVotePanelParams,
  ballot: VoteBallot,
): Promise<{ files: AttachmentBuilder[]; art: IVotePanelArt }> {
  const plan = planVotePanelArt(panelParams);
  const games = dedupeNominationsByGame(panelParams.nominations);
  const [image, nominatorNames] = await Promise.all([
    plan.voteImage
      ? source
        .buildVoteImage(panelParams.kind, panelParams.roundNumber, ballot, games)
        .catch((error: unknown) => {
          // The panel matters more than its art: post it without the image.
          logError("VotePanelPosting.loadPanelArt", error);
          return { files: [], voteImageUrl: null };
        })
      : { files: [], voteImageUrl: null },
    plan.nominationSections ? buildNominatorDisplayNames(games) : null,
  ]);
  return { files: image.files, art: { voteImageUrl: image.voteImageUrl, nominatorNames } };
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
    const ballot = params.ballot ?? "main";
    const panelNoun = ballot === "runoff" ? "runoff panel" : "voting panel";
    const nominations = params.nominationsByKind.get(kind) ?? [];
    if (!dedupeNominationsByGame(nominations).length) {
      resultLines.push(
        ballot === "runoff"
          ? `${kindLabel}: no runoff; panel skipped.`
          : `${kindLabel}: no votable nominations; panel skipped.`,
      );
      continue;
    }
    const source = params.source ?? apiVotingDataSource;
    const tally = await source.getTally(kind, params.roundNumber, ballot);
    const panelParams: IVotePanelParams = {
      ballot,
      kind,
      roundNumber: params.roundNumber,
      monthLabel: params.monthLabel,
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
    };
    const { files, art } = await loadPanelArt(source, panelParams, ballot);
    const components = buildVotePanelComponents({ ...panelParams, art });
    const failure = await sendPanelToChannel(params.client, params.channelId, components, files);
    const sent = failure === null;
    if (sent) {
      posted += 1;
    } else {
      failed += 1;
    }
    resultLines.push(
      sent
        ? `${kindLabel}: ${panelNoun} posted in ${channelMention(params.channelId)}.`
        : `${kindLabel}: failed to post the ${panelNoun} in ` +
          `${channelMention(params.channelId)}: ${failure}`,
    );
  }
  return { lines: resultLines, posted, failed };
}
