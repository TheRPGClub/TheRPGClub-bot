import { ChannelType, RESTJSONErrorCodes, userMention, type Client } from "discord.js";
import { describeRequestError } from "../utilities/ApiErrorUtils.js";
import { getGameKeyById, type IGameKey } from "../classes/GameKey.js";
import { requestVotingEventPoll } from "./VotingEventService.js";
import { refreshGiveawayHubMessage } from "./GiveawayHubService.js";
import {
  buildClaimedKeyDm,
  runGiveawayClaimSideEffects,
  type IClaimedGiveawayKey,
} from "./GiveawayClaimService.js";
import { getSuggestionById, type ISuggestionItem } from "../classes/Suggestion.js";
import { BOT_DEV_CHANNEL_ID, GAMEDB_UPDATES_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import {
  buildSuggestionApprovedNotice,
  buildSuggestionRejectedNotice,
  buildSuggestionSubmittedPing,
} from "./SuggestionNotices.js";
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
import { LIVE_EVENT_FORUM_ID } from "../config/channels.js";
import { HOME_GUILD_ID } from "../config/guilds.js";

/** What the completion_announce handler asks the surface to post. */
export type ICompletionAnnouncement = ICompletionAnnouncementInput;

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
  /** The /giveaway claim's log post and donor DM. Never throws; returns the donor's name. */
  runGiveawayClaimSideEffects(claimerId: string, key: IClaimedGiveawayKey): Promise<string>;
  /** DMs a user. Throws the discord.js error (closed DMs: code 50007). */
  sendDm(userId: string, content: string): Promise<void>;
  /** Re-renders the giveaway hub from the API's current keys. Throws when it could not. */
  refreshGiveawayHub(): Promise<void>;
  /** GET /suggestions/:id with the service token; null on 404. */
  fetchSuggestion(suggestionId: number): Promise<ISuggestionItem | null>;
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
  /** GET /completions/:id; null on 404 or when it belongs to someone other than userId. */
  fetchCompletionForUser(userId: string, completionId: number): Promise<ICompletionRecord | null>;
  /** GET /games/:id; null on 404. */
  fetchGame(gameId: number): Promise<IGame | null>;
  /** Posts the Whatcha Playing completion announcement. Throws when it could not. */
  announceCompletion(announcement: ICompletionAnnouncement): Promise<void>;
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
}

export function createBotJobSurface(client: Client): IBotJobSurface {
  return {
    requestVotingEventPoll,
    fetchGameKey: getGameKeyById,
    runGiveawayClaimSideEffects: (claimerId, key) =>
      runGiveawayClaimSideEffects(client, claimerId, key),
    sendDm: async (userId, content) => {
      const user = await client.users.fetch(userId);
      await user.send({ content });
    },
    refreshGiveawayHub: () => refreshGiveawayHubMessage(client, 0, { throwOnFailure: true }),
    fetchSuggestion: getSuggestionById,
    sendChannelMessage: async (channelId, content, pingUserIds) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send({ content, allowedMentions: { users: [...pingUserIds] } });
    },
    fetchCompletionForUser: (userId, completionId) =>
      Member.getCompletionForUser(userId, completionId),
    fetchGame: (gameId) => Game.getGameById(gameId),
    announceCompletion: (announcement) => postCompletionAnnouncement(client, announcement),
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
  };
}

/**
 * Performs one job. Resolving acks it done; throwing acks it failed with the error, so
 * let API (axios) and discord.js errors escape as they are: the dispatcher formats them
 * with the full request and response. Resolve with a short result text (counts, a link to
 * the thread or event) and the done ack carries it to the website's activity list; resolve
 * with nothing when there is nothing worth saying. Plain words: staff read it as is.
 */
export type BotJobHandler = (
  payload: Record<string, unknown>,
  surface: IBotJobSurface,
) => Promise<string | void>;

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
 * to the claimer by DM, and the claim is logged and the donor told, as /giveaway does.
 */
export const handleGiveawayClaimNotice: BotJobHandler = async (payload, surface) => {
  const keyId = payloadPositiveInt(payload, "key_id");
  const claimerId = requireString(payload, "claimed_by_user_id");
  const key = await surface.fetchGameKey(keyId);
  if (!key) {
    throw new Error(`Game key ${keyId} no longer exists (it was revoked), so no DM was sent.`);
  }
  const donorName = await surface.runGiveawayClaimSideEffects(claimerId, key);
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
};

function isClosedDmError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err
    && err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser;
}

/**
 * Payload: `{ reason: "donate" | "claim" | "revoke", key_id }`. A key changed on the
 * website, so the hub re-renders from the API's current list. The key may be gone
 * (revoke), so it is not fetched.
 */
export const handleGiveawayHubRefresh: BotJobHandler = async (_payload, surface) => {
  await surface.refreshGiveawayHub();
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
 * Payload: `{ suggestion_id, created_by }`. A member submitted a Suggestion on the website
 * (the bot's own /suggestion pings inline instead), so the bot dev is pinged as /suggestion
 * does. The name comes from the Suggestion itself.
 */
export const handleSuggestionSubmitted: BotJobHandler = async (payload, surface) => {
  const suggestionId = payloadPositiveInt(payload, "suggestion_id");
  const createdBy = optionalString(payload, "created_by");
  const suggestion = await surface.fetchSuggestion(suggestionId);
  if (!suggestion) {
    throw new Error(`Suggestion ${suggestionId} no longer exists, so no ping was sent.`);
  }
  const author = suggestion.createdBy ?? createdBy;
  const authorLabel = suggestion.createdByName ?? (author ? userMention(author) : "Someone");
  await surface.sendChannelMessage(
    BOT_DEV_CHANNEL_ID,
    buildSuggestionSubmittedPing(authorLabel),
    author ? [BOT_DEV_PING_USER_ID, author] : [BOT_DEV_PING_USER_ID],
  );
};

/**
 * Payload: `{ suggestion_id, outcome, created_by, title, github_issue_number,
 * github_issue_url, rejection_reason }`. Queued by the API for every review, the bot's own
 * Discord reviews included, so this is the only place the outcome is announced.
 */
export const handleSuggestionOutcome: BotJobHandler = async (payload, surface) => {
  payloadPositiveInt(payload, "suggestion_id");
  const createdBy = optionalString(payload, "created_by");
  const outcome = payload.outcome;
  let content: string;
  if (outcome === "approved") {
    content = buildSuggestionApprovedNotice(
      createdBy,
      payloadPositiveInt(payload, "github_issue_number"),
      requireString(payload, "github_issue_url"),
    );
  } else if (outcome === "rejected") {
    content = buildSuggestionRejectedNotice(
      createdBy,
      requireString(payload, "title"),
      requireString(payload, "rejection_reason"),
    );
  } else {
    throw new Error(`Invalid payload: outcome must be "approved" or "rejected", got ${
      JSON.stringify(outcome)
    }.`);
  }
  await surface.sendChannelMessage(
    GAMEDB_UPDATES_CHANNEL_ID,
    content,
    createdBy ? [createdBy] : [],
  );
};

/**
 * Payload: `{ completion_id, user_id, game_id, actor_user_id }`. A Game Completion was
 * logged with announce on (a Superadmin's for another member on the website, or the
 * member's own), so it is announced in Whatcha Playing as /game-completion add does,
 * naming the actor when it is not the member. actor_user_id is null for a service create.
 */
export const handleCompletionAnnounce: BotJobHandler = async (payload, surface) => {
  const completionId = payloadPositiveInt(payload, "completion_id");
  const userId = requireString(payload, "user_id");
  const gameId = payloadPositiveInt(payload, "game_id");
  const actorUserId = optionalString(payload, "actor_user_id") ?? userId;
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
  });
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
  const image = event.imageUrl ? await surface.fetchLiveEventImage(event.imageUrl) : null;
  const threadId = await surface.createLiveEventThread({
    topic: event.topic,
    imageUrl: event.imageUrl,
  });
  await surface.recordLiveEventStep(liveEventId, {
    discordThreadId: threadId,
    status: "thread_created",
  });
  const threadUrl = buildLiveEventThreadUrl(HOME_GUILD_ID, threadId);
  const eventId = await surface.createLiveEventScheduledEvent({
    topic: event.topic,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: threadUrl,
    image,
  });
  await surface.recordLiveEventStep(liveEventId, { discordEventId: eventId, status: "created" });
  return `Thread: ${threadUrl}\nEvent: ${buildLiveEventUrl(HOME_GUILD_ID, eventId)}`;
};

/** Job kind (BotJob::KINDS in the API) to handler. One line per kind. */
export const BOT_JOB_HANDLERS: BotJobHandlers = {
  voting_poll_wakeup: handleVotingPollWakeup,
  giveaway_claim_notice: handleGiveawayClaimNotice,
  giveaway_hub_refresh: handleGiveawayHubRefresh,
  suggestion_submitted: handleSuggestionSubmitted,
  suggestion_outcome: handleSuggestionOutcome,
  completion_announce: handleCompletionAnnounce,
  live_event_create: handleLiveEventCreate,
};
