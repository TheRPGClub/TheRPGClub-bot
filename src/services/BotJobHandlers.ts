import { ChannelType, RESTJSONErrorCodes, userMention, type Client } from "discord.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";
import { getGameKeyById, type IGameKey } from "../classes/GameKey.js";
import { requestVotingEventPoll } from "./VotingEventService.js";
import { refreshGiveawayHubMessage, removePreviewGiveawayHub } from "./GiveawayHubService.js";
import {
  buildClaimedKeyDm,
  runGiveawayClaimSideEffects,
  type IClaimedGiveawayKey,
} from "./GiveawayClaimService.js";
import { getFeedbackById, type IFeedbackItem } from "../classes/Feedback.js";
import {
  ADMIN_CHANNEL_ID,
  ANNOUNCEMENT_CHANNEL_ID,
  BOT_DEV_CHANNEL_ID,
  GAMEDB_UPDATES_CHANNEL_ID,
  CHALLENGES_CHANNEL_ID,
  FUN_FACT_CHANNEL_ID,
  GIVEAWAY_LOG_CHANNEL_ID,
  LIVE_EVENT_FORUM_ID,
  WHATCHA_PLAYING_CHANNEL_ID,
} from "../config/channels.js";
import { BOT_DEV_PING_USER_ID, PSN_ALERT_DM_USER_ID } from "../config/users.js";
import {
  buildFeedbackApprovedNotice,
  buildFeedbackRejectedNotice,
  buildFeedbackSubmittedPing,
} from "./FeedbackNotices.js";
import type { NominationKind } from "../classes/Nomination.js";
import { reloadGotmRoundFromDb } from "../classes/Gotm.js";
import { reloadNrGotmRoundFromDb } from "../classes/NrGotm.js";
import {
  buildNominationDeletedNotice,
  buildRefreshedNominationList,
  postNominationChange,
} from "../functions/NominationAdminHelpers.js";
import { gotyAdminApi } from "./GotyVoteApi.js";
import {
  buildGotyNominationDeletedNotice,
  postGotyNominationChange,
} from "../functions/GotyAdminHelpers.js";
import Member, { type ICompletionRecord } from "../classes/Member.js";
import Game from "../classes/Game.js";
import type { IGame } from "../types/GameTypes.js";
import {
  postCompletionAnnouncement,
  type ICompletionAnnouncementInput,
} from "../functions/CompletionHelpers.js";
import {
  getLiveEventById,
  recordLiveEventStep,
  type ILiveEvent,
  type ILiveEventStep,
} from "../classes/LiveEvent.js";
import {
  buildLiveEventThreadUrl,
  buildLiveEventUrl,
  createLiveEventScheduledEvent,
  createLiveEventThread,
  fetchLiveEventImage,
  type ILiveEventScheduleInput,
  type ILiveEventThreadInput,
} from "./LiveEventService.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { BotJobStepError, isTemporaryJobError, stepFailed } from "./BotJobErrors.js";
import { logError } from "../utilities/LogUtils.js";
import { isIsoDate } from "../functions/ClubDate.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { updateBotPresence } from "../functions/SetPresence.js";
import { sharedStateCommandRefusal } from "../functions/SharedStateCommandGuard.js";
import {
  buildMemberScanSummary,
  runMemberScan,
  type IMemberScanCounts,
} from "../functions/MemberScan.js";
import {
  repostVotingPanels,
  type VotingPanelRepostOutcome,
} from "../functions/VotingPanelRepost.js";
import VotingRounds, {
  NO_VOTING_ROUND_SCHEDULED,
  type VotingRoundCategory,
} from "../classes/VotingRounds.js";
import {
  announceTieBreak,
  announceVotingResults,
  type IResultsRound,
  routedAnnounceOptions,
  type ITieBreakPick,
} from "./VotingResultsAnnouncement.js";
import { VOTING_CATEGORY_LABEL } from "../functions/VotingTiePrompt.js";
import {
  featurePostDestination,
  routeFeaturePost,
  routeVotingPost,
  type FeatureState,
  type IVotingPostTarget,
} from "../functions/FeatureGate.js";
import { NEWS_HUB_FEATURE_KEY, POST_FEATURE_KEYS } from "../config/featureGate.js";
import {
  createNewsHubJobDeps,
  newsCatchUpSummary,
  renewNewsItem,
  runNewsCatchUp,
  type INewsHubJobDeps,
} from "./NewsHubJobs.js";
import { featureOffNotice, getFeatureState } from "./FeaturePostRouting.js";
import { refreshFeatureFlagCache } from "./FeatureAccessService.js";
import { buildFeatureFlagChangedNotice, isFeatureState } from "./FeatureFlagService.js";
import {
  announceNewChallenge,
  createChallengeJobDeps,
  type IChallengeJobDeps,
} from "./ChallengeAnnouncements.js";
import { announceRunFinished } from "./ChallengeRunFinished.js";
import {
  isClubHostedProposal,
  poolGoalChangedDm,
  poolProposalAcceptedDm,
  poolProposalDevPost,
  poolProposalDm,
} from "./ChallengePoolDms.js";
import { announceRunCaughtUp } from "./ChallengeCaughtUp.js";
import {
  announceSeasonOpened,
  seasonEndingDm,
  type IChallengeDm,
} from "./ChallengeSeasons.js";
import {
  announceEditionCancelled,
  announceSignupClosed,
  announceSignupClosing,
  announceSignupOpened,
  leftOutOfDrawDm,
} from "./ChallengeSignupPosts.js";
import { announceEditionRevealed } from "./ChallengeReveal.js";
import { pickReminderDm } from "./ChallengeSantaPick.js";
import {
  createCodexJobDeps,
  postDailyFunFact,
  type ICodexJobDeps,
} from "./CodexFunFactPosts.js";
import {
  createBirthdayPostDeps,
  postBirthdays,
  type IBirthdayPostDeps,
} from "./BirthdayPost.js";
import {
  createConquestPostDeps,
  parseFranchiseConquest,
  postFranchiseConquest,
  type IConquestPostDeps,
} from "./FranchiseConquestPost.js";
import {
  buildPsnAuthExpiredMessage,
  buildPsnAuthRestoredMessage,
  deliverPsnAuthAlert,
  parsePsnAuthExpired,
  parsePsnAuthRestored,
  type IPsnAlertTargets,
} from "./PsnAuthAlerts.js";

/**
 * What the say handler asks the surface to post. allowedMentions is the payload's, passed
 * through as is; the handler only lets it parse "users" (never everyone, here or roles).
 */
export interface ISayMessage {
  channelId: string;
  content: string;
  replyTo: { channelId: string; messageId: string } | null;
  allowedMentions: { parse: "users"[] };
}

/**
 * The narrow slice of Discord (and of the bot's own services) that job handlers may use,
 * so a handler can be tested with a fake instead of a live client. Add a method here
 * (and to createBotJobSurface) when a new handler needs one; never hand out the Client.
 */
export interface IBotJobSurface {
  /** Wakes the voting event poller so it claims now instead of at its next due time. */
  requestVotingEventPoll(): void;
  /** GET /game_keys/:id with the service token (key value included); null on 404. */
  fetchGameKey(keyId: number): Promise<IGameKey | null>;
  /**
   * The /giveaway claim's log post (to logChannelId; none when null) and donor DM. Never
   * throws; returns the donor's name.
   */
  runGiveawayClaimSideEffects(
    claimerId: string,
    key: IClaimedGiveawayKey,
    logChannelId: string | null,
  ): Promise<string>;
  /** DMs a user. Throws the discord.js error (closed DMs: code 50007). */
  sendDm(userId: string, content: string): Promise<void>;
  /**
   * Re-renders the giveaway hub from the API's current keys, where the Giveaways Feature's
   * `state` routes it. Throws when it could not.
   */
  refreshGiveawayHub(state: FeatureState | null): Promise<void>;
  /** GET /feedback/:id with the service token; null on 404. */
  fetchFeedback(feedbackId: number): Promise<IFeedbackItem | null>;
  /**
   * Posts to a text channel; only the listed users' mentions ping (never @everyone or a
   * role, which website text could hold). Throws the discord.js error, or when the channel
   * can't hold messages.
   */
  sendChannelMessage(
    channelId: string,
    content: string,
    pingUserIds: readonly string[],
  ): Promise<void>;
  /** Re-reads one GOTM or NR-GOTM round from the API into the bot's round data. */
  reloadGotmRound(category: VotingRoundCategory, roundNumber: number): Promise<void>;
  /**
   * Posts a nomination change notice with the round's refreshed list to that kind's
   * nomination channel, or where the Voting & GOTM Feature's `state` routes it. Throws when
   * it could not (missing channel, discord.js error).
   */
  announceNominationChange(
    kind: NominationKind,
    round: number,
    content: string,
    state: FeatureState | null,
  ): Promise<void>;
  /** GET /completions/:id; null on 404 or when it belongs to someone other than userId. */
  fetchCompletionForUser(userId: string, completionId: number): Promise<ICompletionRecord | null>;
  /** GET /games/:id; null on 404. */
  fetchGame(gameId: number): Promise<IGame | null>;
  /**
   * Posts the Whatcha Playing completion announcement, where the Game Completions
   * Feature's `state` routes it. Throws when it could not.
   */
  announceCompletion(
    announcement: ICompletionAnnouncementInput,
    state: FeatureState | null,
  ): Promise<void>;
  /** GET /live_events/:id; null on 404. */
  fetchLiveEvent(liveEventId: number): Promise<ILiveEvent | null>;
  /** PATCH /live_events/:id with a step's Discord id and status. Throws when it could not. */
  recordLiveEventStep(liveEventId: number, step: ILiveEventStep): Promise<void>;
  /** Downloads a live event's image. Throws when it is not an image. */
  fetchLiveEventImage(imageUrl: string): Promise<Buffer>;
  /** Opens the thread in the Live Events forum; returns its id. */
  createLiveEventThread(input: ILiveEventThreadInput): Promise<string>;
  /** Creates the home guild's Discord scheduled event; returns its id. */
  createLiveEventScheduledEvent(input: ILiveEventScheduleInput): Promise<string>;
  /**
   * Posts a round's results and winner posts to announcements, creating or renaming each
   * sole winner's thread (an existing linked thread is reused). Throws when nothing posted.
   * Calls onPosted after each message goes out.
   */
  publishVotingResults(
    round: IResultsRound,
    onPosted: () => void,
    target: IVotingPostTarget,
  ): Promise<void>;
  /**
   * Posts the current round's voting panels to announcements when it is roundNumber and
   * its voting is open; otherwise posts nothing and says why. A panel that fails to send
   * is reported in the result, not thrown. Calls onPosted after each panel goes out.
   */
  repostVotingPanels(
    roundNumber: number,
    onPosted: () => void,
    target: IVotingPostTarget,
  ): Promise<VotingPanelRepostOutcome>;
  /**
   * Announces a tie-break pick in announcements with the winner thread for a sole winner.
   * Returns links to the posts. Throws when the round is gone or nothing could be posted.
   */
  announceTieBreak(
    roundNumber: number,
    pick: ITieBreakPick,
    target: IVotingPostTarget,
  ): Promise<string[]>;
  /** Re-applies the latest saved presence. Throws when it could not (none saved too). */
  applyLatestPresence(): Promise<void>;
  /** Posts, or replies to replyTo's message, as given. Throws the discord.js error. */
  sendSayMessage(message: ISayMessage): Promise<void>;
  /** Why an action writing state shared with production may not run here; null if it may. */
  sharedStateRefusal(actionName: string): string | null;
  /** Scans the home guild's members into the member list. Throws when the fetch fails. */
  runMemberScan(): Promise<IMemberScanCounts>;
  /**
   * A Feature's club-wide flag state, for routing its public posts (bot#1521). Null when it
   * could not be read, which posts as Live. Never rejects.
   */
  featureState(featureKey: string): Promise<FeatureState | null>;
  /** A Feature Flag changed: re-read the club-wide flags now. */
  featureFlagsChanged(): void;
  /**
   * The Giveaways Feature left Preview for `state`: removes the Preview hub from bot-dev
   * and re-renders the hub where `state` routes it. Never throws (failures are logged).
   */
  giveawayHubLeftPreview(state: FeatureState): Promise<void>;
  /**
   * What the News Hub jobs read and write: the News Channel, the category threads' copies
   * and the News Item endpoints. Optional so fakes for other jobs need not build it.
   */
  newsHub?: INewsHubJobDeps;
  /**
   * What the Challenge jobs post and read (spec api#376). Optional so fakes for other jobs
   * need not build it.
   */
  challenges?: IChallengeJobDeps;
  /**
   * What the Club Codex jobs read and post (spec api#397). Optional so fakes for other jobs
   * need not build it.
   */
  codex?: ICodexJobDeps;
  /**
   * What the Birthday Post reads and posts (spec api#396). Optional so fakes for other jobs
   * need not build it.
   */
  birthdays?: IBirthdayPostDeps;
  /**
   * What the Conquest post sends with (spec api#457). Optional so fakes for other jobs
   * need not build it.
   */
  conquests?: IConquestPostDeps;
  /**
   * Posts a GOTY Vote nomination removal notice with the year's refreshed Game of the Year
   * nominations in the GOTM nomination channel, or where the GOTY Vote Feature's `state`
   * routes it. Throws when it could not. Optional so older test surfaces need not stub it.
   */
  announceGotyNominationChange?(
    year: number,
    content: string,
    state: FeatureState | null,
  ): Promise<void>;
}

export function createBotJobSurface(client: Client): IBotJobSurface {
  return {
    requestVotingEventPoll,
    fetchGameKey: getGameKeyById,
    runGiveawayClaimSideEffects: (claimerId, key, logChannelId) =>
      runGiveawayClaimSideEffects(client, claimerId, key, logChannelId),
    sendDm: async (userId, content) => {
      const user = await client.users.fetch(userId);
      await user.send({ content });
    },
    refreshGiveawayHub: (state) =>
      refreshGiveawayHubMessage(client, 0, { throwOnFailure: true, featureState: state }),
    fetchFeedback: getFeedbackById,
    sendChannelMessage: async (channelId, content, pingUserIds) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send({ content, allowedMentions: { users: [...pingUserIds] } });
    },
    reloadGotmRound: (category, roundNumber) =>
      category === "gotm"
        ? reloadGotmRoundFromDb(roundNumber)
        : reloadNrGotmRoundFromDb(roundNumber),
    announceNominationChange: async (kind, round, content, state) => {
      const list = await buildRefreshedNominationList(kind, round);
      await postNominationChange(kind, client, content, list, state);
    },
    fetchCompletionForUser: (userId, completionId) =>
      Member.getCompletionForUser(userId, completionId),
    fetchGame: (gameId) => Game.getGameById(gameId),
    announceCompletion: (announcement, state) =>
      postCompletionAnnouncement(client, announcement, state),
    fetchLiveEvent: getLiveEventById,
    recordLiveEventStep,
    fetchLiveEventImage,
    createLiveEventThread: async (input) => {
      const forum = await client.channels.fetch(LIVE_EVENT_FORUM_ID);
      if (!forum || forum.type !== ChannelType.GuildForum) {
        throw new Error(`Live Events forum ${LIVE_EVENT_FORUM_ID} is missing or not a forum.`);
      }
      return (await createLiveEventThread(forum, input)).id;
    },
    createLiveEventScheduledEvent: async (input) =>
      createLiveEventScheduledEvent(await client.guilds.fetch(HOME_GUILD_ID), input),
    publishVotingResults: (round, onPosted, target) =>
      announceVotingResults(client, round, { onPosted, ...routedAnnounceOptions(target) }),
    repostVotingPanels: (roundNumber, onPosted, target) => repostVotingPanels({
      client,
      channelId: target.channelId,
      expectedRoundNumber: roundNumber,
      onPosted,
    }),
    announceTieBreak: async (roundNumber, pick, target) => {
      const round = await VotingRounds.getByRound(roundNumber);
      if (!round) {
        throw new Error(`The API has no voting round ${roundNumber}, so no tie break was posted.`);
      }
      return announceTieBreak(client, round, pick, routedAnnounceOptions(target));
    },
    applyLatestPresence: () => updateBotPresence(client, { throwOnFailure: true }),
    sendSayMessage: (message) => sendSayMessage(client, message),
    sharedStateRefusal: (actionName) => sharedStateCommandRefusal(actionName),
    runMemberScan: () => runMemberScan(client),
    featureState: (featureKey) => getFeatureState(featureKey),
    featureFlagsChanged: refreshFeatureFlagCache,
    giveawayHubLeftPreview: async (state) => {
      await removePreviewGiveawayHub(client);
      await refreshGiveawayHubMessage(client, 0, { featureState: state });
    },
    newsHub: createNewsHubJobDeps(client),
    challenges: createChallengeJobDeps(client),
    codex: createCodexJobDeps(client),
    birthdays: createBirthdayPostDeps(client),
    conquests: createConquestPostDeps(client),
    announceGotyNominationChange: async (year, content, state) => {
      const nominations = await gotyAdminApi.listNominations(year);
      await postGotyNominationChange(client, year, content, nominations, state);
    },
  };
}

async function sendSayMessage(client: Client, message: ISayMessage): Promise<void> {
  const { channelId, content, replyTo, allowedMentions } = message;
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isSendable()) {
    throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
  }
  if (!replyTo) {
    await channel.send({ content, allowedMentions });
    return;
  }
  // As /superadmin say: a plain post, but a reply in a Components V2 container.
  const target = await channel.messages.fetch(replyTo.messageId);
  await target.reply({ ...buildTextReply(content, false), allowedMentions });
}

/**
 * Performs one job. Resolving acks it done; throwing acks it failed with the error, so
 * let API (axios) and discord.js errors escape as they are: the dispatcher formats them
 * with the full request and response. Resolve with a short result text (counts, a link to
 * the thread or event) and the done ack carries it to the website's activity list; resolve
 * with nothing when there is nothing worth saying. Plain words: staff read it as is.
 */
export type BotJobHandler = ((
  payload: Record<string, unknown>,
  surface: IBotJobSurface,
  context?: IBotJobContext,
) => Promise<string | void>) & {
  /**
   * The handler only DMs a member, though its Feature routes public posts: its result
   * carries no Preview note and its Off log speaks of no held posts (it decides what Off
   * means itself). Set by dmOnly().
   */
  readonly dmOnly?: true;
};

/** Marks a handler that only DMs (see BotJobHandler.dmOnly). */
function dmOnly(handler: BotJobHandler): BotJobHandler {
  return Object.assign(handler, { dmOnly: true as const });
}

/** What the dispatcher read before running a job, so the handler need not read it again. */
export interface IBotJobContext {
  /** The job's Feature (its payload's `feature_key`) and that Feature's state, or null. */
  feature: { key: string; state: FeatureState | null } | null;
}

/**
 * The state of the Feature a job posts for: as the dispatcher read it when the job is
 * tagged with that Feature, otherwise read now (once).
 */
async function jobFeatureState(
  featureKey: string,
  surface: IBotJobSurface,
  context: IBotJobContext | undefined,
): Promise<FeatureState | null> {
  const feature = context?.feature;
  return feature?.key === featureKey ? feature.state : surface.featureState(featureKey);
}

/** True when a Feature in `state` posts nothing (Off). */
function isSuppressed(state: FeatureState | null): boolean {
  return featurePostDestination(state) === "suppressed";
}

/**
 * Where a voting job posts (announcements, or the bot-dev channel as a rehearsal in
 * Preview), resolved once and passed down; null when the Feature is Off.
 */
async function votingJobTarget(
  surface: IBotJobSurface,
  context: IBotJobContext | undefined,
): Promise<IVotingPostTarget | null> {
  const state = await jobFeatureState(POST_FEATURE_KEYS.voting, surface, context);
  return routeVotingPost(state, { channelId: ANNOUNCEMENT_CHANNEL_ID, rehearsal: false });
}

/** Names where a voting job posted, for its result text. */
function votingPostPlace(target: IVotingPostTarget): string {
  return target.channelId === BOT_DEV_CHANNEL_ID ? "the bot-dev channel" : "announcements";
}

export type BotJobHandlers = Readonly<Record<string, BotJobHandler>>;

/**
 * Payload: `{}` (nothing). Queued after a website change to a voting round so panels and
 * results go out now rather than when the voting poller next wakes (up to an hour).
 */
export const handleVotingPollWakeup: BotJobHandler = async (_payload, surface) => {
  surface.requestVotingEventPoll();
};

function payloadPositiveInt(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid payload: ${field} must be a positive integer, got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid payload: ${field} must be a non-empty string, got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload: `{ key_id, claimed_by_user_id, donor_user_id, game_title, platform }`. A member
 * claimed a key on the website: the key (fetched from the API, never in the payload) goes
 * to the claimer by DM, and the claim is logged and the donor told, as /giveaway does. The
 * claim log follows the Giveaways Feature's flag (bot-dev in Preview), and while it is Off
 * neither the log nor the donor notice goes out. The claimer's key DM always goes out: a
 * claim made just before Giveaways went Off must not lose its key.
 */
export const handleGiveawayClaimNotice: BotJobHandler = async (payload, surface, context) => {
  const keyId = payloadPositiveInt(payload, "key_id");
  const claimerId = requireString(payload, "claimed_by_user_id");
  const key = await surface.fetchGameKey(keyId);
  if (!key) {
    throw new Error(`Game key ${keyId} no longer exists (it was revoked), so no DM was sent.`);
  }
  const featureKey = POST_FEATURE_KEYS.giveawayClaimLog;
  const state = await jobFeatureState(featureKey, surface, context);
  const logChannelId = routeFeaturePost(state, GIVEAWAY_LOG_CHANNEL_ID);
  const donorName = await surface.runGiveawayClaimSideEffects(claimerId, key, logChannelId);
  try {
    await surface.sendDm(
      claimerId,
      buildClaimedKeyDm(key.gameTitle, key.platform, key.keyValue, donorName),
    );
  } catch (err: unknown) {
    if (isClosedDmError(err)) {
      throw new Error(
        "The bot could not DM you your key because your Discord DMs are closed. " +
          "The key is still yours: it is shown on the website.",
        { cause: err },
      );
    }
    // Never rethrow the discord.js error: its request body is the DM, key included. The
    // cause is kept for the local log only; a job's error message never formats it.
    throw new Error(`Could not DM the claimer their key: ${describeRequestError(err)}`, {
      cause: err,
    });
  }
  if (!logChannelId) {
    return `Sent the key by DM. No claim log or donor notice: the ${featureKey} Feature is Off.`;
  }
};

function isClosedDmError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err
    && err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser;
}

/**
 * Payload: `{ reason: "donate" | "claim" | "revoke", key_id }`. A key changed on the
 * website, so the hub re-renders from the API's current list where the Giveaways Feature's
 * flag routes it (nothing when Off). The key may be gone (revoke), so it is not fetched.
 */
export const handleGiveawayHubRefresh: BotJobHandler = async (_payload, surface, context) => {
  const featureKey = POST_FEATURE_KEYS.giveawayHub;
  const state = await jobFeatureState(featureKey, surface, context);
  if (isSuppressed(state)) return featureOffNotice(featureKey);
  await surface.refreshGiveawayHub(state);
};

function optionalString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid payload: ${field} must be a string or null, got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload: `{ feedback_id, kind, created_by }`. A member filed Feedback on the website
 * (the bot's own /feedback pings inline instead), so the bot dev is pinged as /feedback
 * does, in the bot-dev channel whether the Feedback Feature is Live or in Preview, and
 * not at all when it is Off. The name comes from the Feedback itself.
 */
export const handleFeedbackSubmitted: BotJobHandler = async (payload, surface, context) => {
  const feedbackId = payloadPositiveInt(payload, "feedback_id");
  const createdBy = optionalString(payload, "created_by");
  const featureKey = POST_FEATURE_KEYS.feedback;
  const channelId = routeFeaturePost(
    await jobFeatureState(featureKey, surface, context),
    BOT_DEV_CHANNEL_ID,
  );
  if (!channelId) return featureOffNotice(featureKey);
  const feedback = await surface.fetchFeedback(feedbackId);
  if (!feedback) {
    throw new Error(`Feedback ${feedbackId} no longer exists, so no ping was sent.`);
  }
  const author = feedback.createdBy ?? createdBy;
  const authorLabel = feedback.createdByName ?? (author ? userMention(author) : "Someone");
  await surface.sendChannelMessage(
    channelId,
    buildFeedbackSubmittedPing(authorLabel),
    author ? [BOT_DEV_PING_USER_ID, author] : [BOT_DEV_PING_USER_ID],
  );
};

/**
 * Payload: `{ feedback_id, kind, outcome, created_by, title, github_issue_number,
 * github_issue_url, rejection_reason }`. Queued by the API for every review, so this is the
 * only place the outcome is announced. Posted where the Feedback Feature's flag routes it
 * (the bot-dev channel in Preview).
 */
export const handleFeedbackOutcome: BotJobHandler = async (payload, surface, context) => {
  payloadPositiveInt(payload, "feedback_id");
  const createdBy = optionalString(payload, "created_by");
  const outcome = payload.outcome;
  let content: string;
  if (outcome === "approved") {
    content = buildFeedbackApprovedNotice(
      createdBy,
      payloadPositiveInt(payload, "github_issue_number"),
      requireString(payload, "github_issue_url"),
    );
  } else if (outcome === "rejected") {
    content = buildFeedbackRejectedNotice(
      createdBy,
      requireString(payload, "title"),
      requireString(payload, "rejection_reason"),
    );
  } else {
    throw new Error(`Invalid payload: outcome must be "approved" or "rejected", got ${
      JSON.stringify(outcome)
    }.`);
  }
  const featureKey = POST_FEATURE_KEYS.feedback;
  const channelId = routeFeaturePost(
    await jobFeatureState(featureKey, surface, context),
    GAMEDB_UPDATES_CHANNEL_ID,
  );
  if (!channelId) return featureOffNotice(featureKey);
  await surface.sendChannelMessage(channelId, content, createdBy ? [createdBy] : []);
};

function payloadCategory(payload: Record<string, unknown>): VotingRoundCategory {
  const value = payload.category;
  if (value !== "gotm" && value !== "nr_gotm") {
    throw new Error(`Invalid payload: category must be "gotm" or "nr_gotm", got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload: `{ category, round_number }`. A round was added or a game in it edited on the
 * website, so the bot re-reads that round instead of waiting for a restart.
 */
export const handleGotmCacheReload: BotJobHandler = async (payload, surface) => {
  const category = payloadCategory(payload);
  await surface.reloadGotmRound(category, payloadPositiveInt(payload, "round_number"));
};

/**
 * Payload: `{ category, round_number, user_id, game_title, deleted_by_user_id, reason }`.
 * An Admin removed someone's nomination on the website (already deleted), so the change
 * and the refreshed list go to the nomination channel, as /admin's delete does. No DM.
 */
export const handleNominationDeleted: BotJobHandler = async (payload, surface, context) => {
  const kind: NominationKind = payloadCategory(payload) === "gotm" ? "gotm" : "nr-gotm";
  const round = payloadPositiveInt(payload, "round_number");
  const featureKey = POST_FEATURE_KEYS.voting;
  const state = await jobFeatureState(featureKey, surface, context);
  if (isSuppressed(state)) return featureOffNotice(featureKey);
  const content = buildNominationDeletedNotice(
    kind,
    round,
    requireString(payload, "deleted_by_user_id"),
    requireString(payload, "user_id"),
    optionalString(payload, "game_title"),
    requireString(payload, "reason"),
  );
  await surface.announceNominationChange(kind, round, content, state);
};

/**
 * Payload: `{ year, user_id, game_title, deleted_by_user_id, reason, feature_key:
 * "goty_vote" }` (api#473). An Admin removed someone's Game of the Year nomination on the
 * website (already deleted), so the change and the refreshed list go to the GOTM
 * nomination channel, as /admin goty-delete-nom does. No DM.
 */
export const handleGotyNominationDeleted: BotJobHandler = async (payload, surface, context) => {
  const year = payloadPositiveInt(payload, "year");
  const featureKey = POST_FEATURE_KEYS.gotyVote;
  const state = await jobFeatureState(featureKey, surface, context);
  if (isSuppressed(state)) return featureOffNotice(featureKey);
  const content = buildGotyNominationDeletedNotice(
    year,
    requireString(payload, "deleted_by_user_id"),
    requireString(payload, "user_id"),
    optionalString(payload, "game_title"),
    requireString(payload, "reason"),
  );
  if (!surface.announceGotyNominationChange) {
    throw new Error("This bot job surface cannot post GOTY Vote nomination changes.");
  }
  await surface.announceGotyNominationChange(year, content, state);
};

/**
 * Payload: `{ completion_id, user_id, game_id, actor_user_id }`. A Game Completion was
 * logged with announce on (a Superadmin's for another member on the website, or the
 * member's own), so it is announced in Whatcha Playing as /game-completion add does,
 * naming the actor when it is not the member. actor_user_id is null for a service create.
 */
export const handleCompletionAnnounce: BotJobHandler = async (payload, surface, context) => {
  const completionId = payloadPositiveInt(payload, "completion_id");
  const userId = requireString(payload, "user_id");
  const gameId = payloadPositiveInt(payload, "game_id");
  const actorUserId = optionalString(payload, "actor_user_id") ?? userId;
  const featureKey = POST_FEATURE_KEYS.completions;
  const state = await jobFeatureState(featureKey, surface, context);
  if (isSuppressed(state)) return featureOffNotice(featureKey);
  const completion = await surface.fetchCompletionForUser(userId, completionId);
  if (!completion) {
    throw new Error(
      `Game Completion ${completionId} of ${userId} no longer exists, so it was not announced.`,
    );
  }
  const game = await surface.fetchGame(gameId);
  if (!game) {
    throw new Error(`GameDB game ${gameId} no longer exists, so it was not announced.`);
  }
  await surface.announceCompletion({
    userId,
    actorUserId,
    game,
    completionType: completion.completionType,
    completedAt: completion.completedAt,
    finalPlaytimeHours: completion.finalPlaytimeHours,
  }, state);
};

/**
 * Payload: `{ live_event_id }`. A Moderator created a live event on the website, so the bot
 * makes its forum thread and then its Discord scheduled event, as /mod create-live-event
 * does, recording each id with the API as it goes.
 */
export const handleLiveEventCreate: BotJobHandler = async (payload, surface) => {
  const liveEventId = payloadPositiveInt(payload, "live_event_id");
  const event = await surface.fetchLiveEvent(liveEventId);
  if (!event) {
    throw new Error(`Live event ${liveEventId} no longer exists, so nothing was created.`);
  }
  try {
    return await createLiveEventSteps(event, surface);
  } catch (err) {
    // A temporary failure goes back to the lease, so the live event is not failed yet.
    if (!isTemporaryJobError(err)) await markLiveEventFailed(event.id, surface);
    throw err;
  }
};

async function runStep<T>(step: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    throw stepFailed(step, err);
  }
}

/**
 * Records a Discord id just made. Its failure is never temporary: a retry would not see
 * the id and would make the thread or event a second time.
 */
async function recordCreated(
  surface: IBotJobSurface,
  liveEventId: number,
  step: ILiveEventStep,
  what: string,
  url: string,
): Promise<void> {
  try {
    await surface.recordLiveEventStep(liveEventId, step);
  } catch (err) {
    throw new BotJobStepError(
      `Recording the ${what} failed (it was made: ${url}). The job stopped rather than ` +
        `make a second one`,
      err,
      false,
    );
  }
}

async function createLiveEventSteps(event: ILiveEvent, surface: IBotJobSurface):
  Promise<string> {
  let threadId = event.discordThreadId;
  let eventId = event.discordEventId;
  // The image is only the scheduled event's cover; the thread shows it by URL. Downloading
  // it first still stops a bad image before anything is made, as the slash command does.
  const imageUrl = event.imageUrl;
  const image = !eventId && imageUrl
    ? await runStep("Downloading the image", () => surface.fetchLiveEventImage(imageUrl))
    : null;
  if (!threadId) {
    threadId = await runStep("Creating the forum thread", () =>
      surface.createLiveEventThread({ topic: event.topic, imageUrl }));
    await recordCreated(
      surface,
      event.id,
      { discordThreadId: threadId, status: "thread_created" },
      "forum thread",
      buildLiveEventThreadUrl(HOME_GUILD_ID, threadId),
    );
  }
  const threadUrl = buildLiveEventThreadUrl(HOME_GUILD_ID, threadId);
  if (!eventId) {
    eventId = await runStep("Creating the Discord scheduled event", () =>
      surface.createLiveEventScheduledEvent({
        topic: event.topic,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        location: threadUrl,
        image,
      }));
    await recordCreated(
      surface,
      event.id,
      { discordEventId: eventId, status: "created" },
      "Discord scheduled event",
      buildLiveEventUrl(HOME_GUILD_ID, eventId),
    );
  }
  return `Thread: ${threadUrl}\nEvent: ${buildLiveEventUrl(HOME_GUILD_ID, eventId)}`;
}

/** Best effort: the job's own failed ack carries the error either way. */
async function markLiveEventFailed(liveEventId: number, surface: IBotJobSurface):
  Promise<void> {
  try {
    await surface.recordLiveEventStep(liveEventId, { status: "failed" });
  } catch (err) {
    logError("BotJobHandlers.live_event_create", err);
  }
}

/**
 * Runs a step that posts several Discord messages. A failure before the first post keeps
 * its own class (a temporary one is left for the lease); once any post has gone out it is
 * never temporary, since a retry would post that message again.
 */
async function postOnce<T>(step: string, run: (onPosted: () => void) => Promise<T>):
  Promise<T> {
  let posted = false;
  try {
    return await run(() => {
      posted = true;
    });
  } catch (err) {
    if (!posted) throw err;
    throw new BotJobStepError(`${step} failed after a post went out`, err, false);
  }
}

/**
 * Payload: `{ round_number, month_label }`. An Admin published a round's results on the
 * website (voting has ended), so they go to announcements as /admin voting-results
 * publish does. A failure once a post has gone out acks failed rather than retrying, which
 * would post the results twice; before that, a temporary one is left for the lease.
 */
export const handleVotingResultsPublish: BotJobHandler = async (payload, surface, context) => {
  const roundNumber = payloadPositiveInt(payload, "round_number");
  const monthLabel = requireString(payload, "month_label");
  const target = await votingJobTarget(surface, context);
  if (!target) return featureOffNotice(POST_FEATURE_KEYS.voting);
  await postOnce(
    `Posting the round ${roundNumber} results`,
    (onPosted) => surface.publishVotingResults({ roundNumber, monthLabel }, onPosted, target),
  );
  return `Posted the round ${roundNumber} results to ${votingPostPlace(target)}.`;
};

/** Why a voting_panels_repost job posted nothing, for its failed ack. */
function describePanelRepostRefusal(
  roundNumber: number,
  outcome: Exclude<VotingPanelRepostOutcome, { status: "posted" }>,
): string {
  switch (outcome.status) {
    case "no_round":
      return `${NO_VOTING_ROUND_SCHEDULED} No panels were posted.`;
    case "other_round":
      return `Round ${roundNumber} is no longer the current voting round ` +
        `(round ${outcome.round.roundNumber} is), so no panels were posted.`;
    case "not_open_yet":
      return `Voting for round ${roundNumber} has not opened yet, so no panels were posted.`;
    case "ended":
      return `Voting for round ${roundNumber} has ended, so no panels were posted.`;
    case "no_votable_nominations":
      return `There are no votable nominations for round ${roundNumber}, ` +
        "so no panels were posted.";
  }
}

/**
 * Payload: `{ round_number }`. An Admin asked the website to repost the voting panels
 * (voting was open when queued), so they go to announcements as /admin voting-open does.
 * A refusal, or a panel that would not send, acks failed with the reason. Nothing is retried
 * once a panel has gone out (a failed send, or an error after one), since that would post
 * the sent ones twice.
 */
export const handleVotingPanelsRepost: BotJobHandler = async (payload, surface, context) => {
  const roundNumber = payloadPositiveInt(payload, "round_number");
  const target = await votingJobTarget(surface, context);
  if (!target) return featureOffNotice(POST_FEATURE_KEYS.voting);
  const outcome = await postOnce(
    `Reposting the voting panels for round ${roundNumber}`,
    (onPosted) => surface.repostVotingPanels(roundNumber, onPosted, target),
  );
  if (outcome.status !== "posted") {
    throw new Error(describePanelRepostRefusal(roundNumber, outcome));
  }
  const { posted, failed, lines } = outcome.result;
  if (failed > 0) {
    throw new Error(
      `Posted ${posted} of ${posted + failed} voting panels for round ${roundNumber}. ` +
        lines.join(" "),
    );
  }
  const noun = posted === 1 ? "panel" : "panels";
  return `Reposted ${posted} voting ${noun} for round ${roundNumber} in ` +
    `${votingPostPlace(target)}.`;
};

function payloadTieBreakGames(payload: Record<string, unknown>): ITieBreakPick["games"] {
  const value = payload.games;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid payload: games must be a non-empty list, got ${
      JSON.stringify(value)
    }.`);
  }
  return value.map((entry: unknown, index) => {
    const game = (typeof entry === "object" && entry !== null ? entry : {}) as
      Record<string, unknown>;
    // Keyed by the full path so a bad field is named as games[i].field.
    const idField = `games[${index}].game_id`;
    const titleField = `games[${index}].title`;
    return {
      gameId: payloadPositiveInt({ [idField]: game.game_id }, idField),
      title: requireString({ [titleField]: game.title }, titleField),
    };
  });
}

/**
 * Payload: `{ round_number, category, games: [{ game_id, title }] }`. An Admin broke a tie
 * on the website (already saved), so the pick is announced as the tie-break select does,
 * then the voting poller is woken for the round_decided a last tie leaves. The wake comes
 * after the announcement, even a failed one, so round_decided's winner threads never race
 * this one's.
 */
export const handleVotingTieBroken: BotJobHandler = async (payload, surface, context) => {
  const roundNumber = payloadPositiveInt(payload, "round_number");
  const category = payloadCategory(payload);
  const games = payloadTieBreakGames(payload);
  let links: string[];
  try {
    const target = await votingJobTarget(surface, context);
    if (!target) return featureOffNotice(POST_FEATURE_KEYS.voting);
    links = await surface.announceTieBreak(roundNumber, { category, games }, target);
  } finally {
    surface.requestVotingEventPoll();
  }
  const titles = games.map((game) => game.title).join(", ");
  return [
    `Announced the ${VOTING_CATEGORY_LABEL[category]} round ${roundNumber} tie break: ` +
      `${titles}.`,
    ...links,
  ].join(" ");
};

/**
 * Payload: `{ activity_name }`. A Moderator set the presence on the website, so it applies
 * now instead of at the hourly refresh. The latest saved row is re-read rather than the
 * payload name, so a stale job never overrides a newer presence.
 */
export const handlePresenceSet: BotJobHandler = async (_payload, surface) => {
  await surface.applyLatestPresence();
};

function sayAllowedMentions(payload: Record<string, unknown>): ISayMessage["allowedMentions"] {
  const value = payload.allowed_mentions;
  const invalid = (): Error => new Error(
    "Invalid payload: allowed_mentions may only parse \"users\" (never everyone, here or " +
      `roles), got ${JSON.stringify(value)}.`,
  );
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "parse") throw invalid();
  const parse: unknown = (value as { parse: unknown }).parse;
  if (!Array.isArray(parse) || !parse.every((entry) => entry === "users")) throw invalid();
  return { parse: parse as "users"[] };
}

function sayReplyTo(
  payload: Record<string, unknown>,
  channelId: string,
): ISayMessage["replyTo"] {
  const value = payload.reply_to;
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid payload: reply_to must be an object or null, got ${
      JSON.stringify(value)
    }.`);
  }
  const replyTo = value as Record<string, unknown>;
  const replyChannelId = requireString(replyTo, "channel_id");
  if (replyChannelId !== channelId) {
    throw new Error(`Invalid payload: reply_to.channel_id must equal channel_id, got ${
      JSON.stringify(replyChannelId)
    } and ${JSON.stringify(channelId)}.`);
  }
  return { channelId, messageId: requireString(replyTo, "message_id") };
}

/**
 * Payload: `{ channel_id, content, reply_to: { channel_id, message_id } | null,
 * allowed_mentions: { parse: ["users"] } }`. A Superadmin had the bot speak from the
 * website, as /superadmin say does: a post in the channel, or a reply to the linked message.
 * Only plain user mentions may ping, so a payload asking for more is refused, not trimmed.
 */
export const handleSay: BotJobHandler = async (payload, surface) => {
  const channelId = requireString(payload, "channel_id");
  const content = requireString(payload, "content");
  const allowedMentions = sayAllowedMentions(payload);
  const replyTo = sayReplyTo(payload, channelId);
  await surface.sendSayMessage({ channelId, content, replyTo, allowedMentions });
};

/**
 * Payload: `{}`. A Superadmin started a member scan on the website, as /superadmin
 * memberscan does; the counts are the result text. Refused (failed) where the shared-state
 * guard says the bot must not write production data, as the slash command is.
 */
export const handleMemberscan: BotJobHandler = async (_payload, surface) => {
  const refusal = surface.sharedStateRefusal("memberscan");
  if (refusal) throw new Error(refusal);
  return buildMemberScanSummary(await surface.runMemberScan());
};

function payloadFeatureState(payload: Record<string, unknown>, field: string): FeatureState {
  const value = payload[field];
  if (!isFeatureState(value)) {
    throw new Error(`Invalid payload: ${field} must be "off", "preview" or "live", got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload: `{ key, name, from_state, to_state, changed_by, changed_by_name, reason }`.
 * Staff changed a Feature Flag (website or /flag set), so the admin channel hears who
 * changed what, from and to which state, and why. It carries no `feature_key`: the
 * announcement goes out whatever the Feature's own state. Nobody is pinged. Giveaways
 * leaving Preview also takes its Preview hub out of the bot-dev channel.
 */
export const handleFeatureFlagChanged: BotJobHandler = async (payload, surface) => {
  // Re-read the flags first, so the bot follows the change at once, not a TTL later.
  surface.featureFlagsChanged();
  const key = requireString(payload, "key");
  const fromState = payloadFeatureState(payload, "from_state");
  const toState = payloadFeatureState(payload, "to_state");
  const content = buildFeatureFlagChangedNotice({
    key,
    name: requireString(payload, "name"),
    fromState,
    toState,
    changedBy: requireString(payload, "changed_by"),
    changedByName: optionalString(payload, "changed_by_name"),
    reason: optionalString(payload, "reason"),
  });
  await surface.sendChannelMessage(ADMIN_CHANNEL_ID, content, []);
  // The Preview hub in bot-dev goes once Giveaways leaves Preview. The new state is passed
  // on, since the flag cache may not hold it yet.
  const leftPreview = fromState === "preview" && toState !== "preview";
  if (key === POST_FEATURE_KEYS.giveawayHub && leftPreview) {
    await surface.giveawayHubLeftPreview(toState);
  }
};

function newsHubDeps(surface: IBotJobSurface): INewsHubJobDeps {
  if (!surface.newsHub) throw new Error("This bot job surface cannot reach the News Hub.");
  return surface.newsHub;
}

/**
 * Payload: `{ message_id, channel_id, feature_key: "news_hub" }`. The website served a News
 * Item whose Discord image address had expired: the message is fetched again and recorded
 * whole (fresh addresses), or its News Item removed when the message is gone or no longer
 * qualifies. Works for a category thread and the Game News Archive. Nothing while Off.
 */
export const handleNewsImagesRenew: BotJobHandler = async (payload, surface, context) => {
  const messageId = requireString(payload, "message_id");
  const channelId = requireString(payload, "channel_id");
  const state = await jobFeatureState(NEWS_HUB_FEATURE_KEY, surface, context);
  if (state === "off") return "Nothing renewed: the News Hub is Off.";
  return renewNewsItem(messageId, channelId, newsHubDeps(surface));
};

/**
 * Payload: `{ from_state: "off", to_state, feature_key: "news_hub" }`. The News Hub left
 * Off, so the News Channel posts made while it was Off are filed and the missing News Copies
 * posted (see `runNewsCatchUp`). The state is read from the API again, not taken from the
 * dispatcher: the flag cache can still say Off. Fails, after the other step, when a step
 * could not run.
 */
export const handleNewsCatchUp: BotJobHandler = async (_payload, surface) => {
  const outcome = await runNewsCatchUp(newsHubDeps(surface));
  const summary = newsCatchUpSummary(outcome);
  if (outcome.status === "done" && outcome.failures.length > 0) {
    throw new Error([summary, ...outcome.failures].join("\n\n"));
  }
  return summary;
};

function challengeDeps(surface: IBotJobSurface): IChallengeJobDeps {
  if (!surface.challenges) throw new Error("This bot job surface cannot reach Challenges.");
  return surface.challenges;
}

/** The #challenges posts, by the payload's `event`; later tickets add their events here. */
const CHALLENGE_ANNOUNCERS: Readonly<Record<
  string,
  (payload: Record<string, unknown>, channelId: string, deps: IChallengeJobDeps) =>
    Promise<string>
>> = {
  challenge_created: announceNewChallenge,
  run_finished: announceRunFinished,
  run_caught_up: announceRunCaughtUp,
  season_opened: announceSeasonOpened,
  signup_opened: announceSignupOpened,
  signup_closing: announceSignupClosing,
  signup_closed: announceSignupClosed,
  edition_cancelled: announceEditionCancelled,
  edition_revealed: announceEditionRevealed,
};

/**
 * Payload `{ event, challenge, ..., feature_key }` (ChallengeAnnounceJobPayload): posts in
 * #challenges, in the bot-dev channel while Challenges is in Preview, and nowhere while it
 * is Off. An event this bot has no post for fails the job, naming it.
 */
export const handleChallengeAnnounce: BotJobHandler = async (payload, surface, context) => {
  const event = requireString(payload, "event");
  const announce = Object.hasOwn(CHALLENGE_ANNOUNCERS, event)
    ? CHALLENGE_ANNOUNCERS[event]
    : undefined;
  if (!announce) {
    throw new Error(`This bot has no post for the Challenge event "${event}".`);
  }
  const featureKey = POST_FEATURE_KEYS.challenges;
  const channelId = routeFeaturePost(
    await jobFeatureState(featureKey, surface, context),
    CHALLENGES_CHANNEL_ID,
  );
  if (!channelId) return featureOffNotice(featureKey);
  return announce(payload, channelId, challengeDeps(surface));
};

/** The Challenge DMs, by the payload's `event`; later tickets add their events here. */
const CHALLENGE_DMS: Readonly<Record<
  string,
  (payload: Record<string, unknown>, deps: IChallengeJobDeps) => Promise<IChallengeDm>
>> = {
  season_ending: seasonEndingDm,
  left_out_of_draw: leftOutOfDrawDm,
  pick_reminder: pickReminderDm,
  pool_goal_changed: poolGoalChangedDm,
  pool_proposal: poolProposalDm,
  pool_proposal_accepted: poolProposalAcceptedDm,
};

/**
 * Payload `{ event, user_id, challenge, ..., feature_key }` (ChallengeDmJobPayload): DMs
 * the member, in Preview too (only staff can have Runs then), but not while Challenges is
 * Off. A member with DMs closed can never get it, so that is acked done with the reason
 * rather than failed and retried. An event this bot has no DM for fails the job. A
 * club-hosted `pool_proposal` (`club_hosted: true`, no `user_id`) is posted in #dev
 * instead, as Feedback is (spec api#442).
 */
export const handleChallengeDm: BotJobHandler = dmOnly(async (payload, surface, context) => {
  const event = requireString(payload, "event");
  const build = Object.hasOwn(CHALLENGE_DMS, event) ? CHALLENGE_DMS[event] : undefined;
  if (!build) throw new Error(`This bot has no DM for the Challenge event "${event}".`);
  const featureKey = POST_FEATURE_KEYS.challenges;
  if (isSuppressed(await jobFeatureState(featureKey, surface, context))) {
    return `Not sent: the ${featureKey} Feature is Off.`;
  }
  const deps = challengeDeps(surface);
  if (isClubHostedProposal(payload)) {
    const devPost = poolProposalDevPost(payload);
    await deps.postMessage(BOT_DEV_CHANNEL_ID, devPost.post);
    return `Posted ${devPost.about} in the bot-dev channel.`;
  }
  const dm = await build(payload, deps);
  try {
    await deps.sendDm(dm.userId, dm.post);
  } catch (err: unknown) {
    if (isClosedDmError(err)) {
      logError("BotJobHandlers.challenge_dm", err);
      return `Not delivered: member ${dm.userId}'s DMs are closed, so ${dm.about} was not sent.`;
    }
    // Temporary (Discord 5xx, rate limited) stays temporary, so the lease retries the DM.
    throw stepFailed(`DM to member ${dm.userId}`, err);
  }
  return `DMed member ${dm.userId} ${dm.about}.`;
});

/** A club date as the API sends it: `YYYY-MM-DD`. */
function requireClubDate(payload: Record<string, unknown>, field: string): string {
  const value = requireString(payload, field);
  if (!isIsoDate(value)) {
    throw new Error(`Invalid payload: ${field} must be a YYYY-MM-DD date, got ${
      JSON.stringify(value)
    }.`);
  }
  return value;
}

/**
 * Payload `{ club_date, entry_id, feature_key: "club_codex" }` (DailyFunFactJobPayload):
 * posts the day's Fun Fact in general chat, in the bot-dev channel while the Club Codex is
 * in Preview, and nowhere while it is Off. A job for a club day that has passed, or for a
 * Fun Fact deleted since, is acked done without a post.
 */
export const handleDailyFunFact: BotJobHandler = async (payload, surface, context) => {
  const job = {
    clubDate: requireClubDate(payload, "club_date"),
    entryId: payloadPositiveInt(payload, "entry_id"),
  };
  const featureKey = POST_FEATURE_KEYS.clubCodex;
  const channelId = routeFeaturePost(
    await jobFeatureState(featureKey, surface, context),
    FUN_FACT_CHANNEL_ID,
  );
  if (!channelId) return featureOffNotice(featureKey);
  if (!surface.codex) throw new Error("This bot job surface cannot reach the Club Codex.");
  return postDailyFunFact(job, channelId, surface.codex);
};

function birthdaysDeps(surface: IBotJobSurface): IBirthdayPostDeps {
  if (!surface.birthdays) throw new Error("This bot job surface cannot reach Birthdays.");
  return surface.birthdays;
}

/**
 * Payload `{ club_date, user_ids, channel_id }` (BirthdayPostJobPayload): the Birthday Post
 * in the payload's channel (general chat), pinging every member still sharing. Birthdays are
 * not a Feature, so no flag routes it. A job whose club day has passed in New York is acked
 * done unposted.
 */
export const handleBirthdayPost: BotJobHandler = async (payload, surface) =>
  postBirthdays(payload, birthdaysDeps(surface));

/**
 * Payload FranchiseConquestJobPayload (`user_id`, `franchise_id`, `franchise_name`,
 * `conquered_at`, the Playtime, `covers`, `also_conquered`, `feature_key:
 * "franchise_progress"`): the 4B Conquest card in the completions channel, in the bot-dev
 * channel while Franchise Progress is in Preview, and nowhere while it is Off (the payload
 * isn't read then). No pings.
 */
export const handleFranchiseConquest: BotJobHandler = async (payload, surface, context) => {
  const featureKey = POST_FEATURE_KEYS.franchiseConquest;
  const channelId = routeFeaturePost(
    await jobFeatureState(featureKey, surface, context),
    WHATCHA_PLAYING_CHANNEL_ID,
  );
  // Off skips the job before its payload is read, so even a malformed one acks.
  if (!channelId) return featureOffNotice(featureKey);
  const conquest = parseFranchiseConquest(payload);
  if (!surface.conquests) throw new Error("This bot job surface cannot post Conquests.");
  return postFranchiseConquest(conquest, channelId, surface.conquests);
};

/** Where PSN login alerts go: the dev logs channel and the owner's DMs (bot#1578). */
function psnAlertTargets(): IPsnAlertTargets {
  return { channelId: BOT_DEV_CHANNEL_ID, ownerUserId: PSN_ALERT_DM_USER_ID };
}

/**
 * Payload `{ expired_at, reminder }` (api#468): the PSN login (NPSSO) expired, so PSN sync
 * is paused. Posted in the bot-dev channel (no pings) and DMed to the owner with the
 * runbook's fix steps; a reminder says how long it has been paused. Not a Feature.
 */
export const handlePsnAuthExpired: BotJobHandler = async (payload, surface) => {
  const content = buildPsnAuthExpiredMessage(parsePsnAuthExpired(payload), new Date());
  return deliverPsnAuthAlert(content, surface, psnAlertTargets());
};

/** Payload `{ expired_at, restored_at }` (api#468): the PSN login works again. */
export const handlePsnAuthRestored: BotJobHandler = async (payload, surface) => {
  const content = buildPsnAuthRestoredMessage(parsePsnAuthRestored(payload));
  return deliverPsnAuthAlert(content, surface, psnAlertTargets());
};

/** Job kind (BotJob::KINDS in the API) to handler. One line per kind. */
export const BOT_JOB_HANDLERS: BotJobHandlers = {
  voting_poll_wakeup: handleVotingPollWakeup,
  giveaway_claim_notice: handleGiveawayClaimNotice,
  giveaway_hub_refresh: handleGiveawayHubRefresh,
  feedback_submitted: handleFeedbackSubmitted,
  feedback_outcome: handleFeedbackOutcome,
  gotm_cache_reload: handleGotmCacheReload,
  nomination_deleted: handleNominationDeleted,
  goty_nomination_deleted: handleGotyNominationDeleted,
  completion_announce: handleCompletionAnnounce,
  live_event_create: handleLiveEventCreate,
  voting_results_publish: handleVotingResultsPublish,
  voting_panels_repost: handleVotingPanelsRepost,
  voting_tie_broken: handleVotingTieBroken,
  presence_set: handlePresenceSet,
  say: handleSay,
  memberscan: handleMemberscan,
  feature_flag_changed: handleFeatureFlagChanged,
  news_images_renew: handleNewsImagesRenew,
  news_catch_up: handleNewsCatchUp,
  challenge_announce: handleChallengeAnnounce,
  challenge_dm: handleChallengeDm,
  daily_fun_fact: handleDailyFunFact,
  birthday_post: handleBirthdayPost,
  franchise_conquest: handleFranchiseConquest,
  psn_auth_expired: handlePsnAuthExpired,
  psn_auth_restored: handlePsnAuthRestored,
};
