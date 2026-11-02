import { RESTJSONErrorCodes, userMention, type Client } from "discord.js";
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
import {
  buildSuggestionApprovedNotice,
  buildSuggestionRejectedNotice,
  buildSuggestionSubmittedPing,
} from "./SuggestionNotices.js";

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
  /** Re-renders the giveaway hub message from the API's current keys. */
  refreshGiveawayHub(): Promise<void>;
  /** GET /suggestions/:id with the service token; null on 404. */
  fetchSuggestion(suggestionId: number): Promise<ISuggestionItem | null>;
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold messages. */
  sendChannelMessage(channelId: string, content: string): Promise<void>;
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
    refreshGiveawayHub: () => refreshGiveawayHubMessage(client),
    fetchSuggestion: getSuggestionById,
    sendChannelMessage: async (channelId, content) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send({ content });
    },
  };
}

/**
 * Performs one job. Resolving acks it done; throwing acks it failed with the error, so
 * let API (axios) and discord.js errors escape as they are: the dispatcher formats them
 * with the full request and response.
 */
export type BotJobHandler = (
  payload: Record<string, unknown>,
  surface: IBotJobSurface,
) => Promise<void>;

export type BotJobHandlers = Readonly<Record<string, BotJobHandler>>;

/**
 * Payload: `{}` (nothing). Queued after a website change to a voting round so panels and
 * results go out now rather than when the voting poller next wakes (up to an hour).
 */
export const handleVotingPollWakeup: BotJobHandler = async (_payload, surface) => {
  surface.requestVotingEventPoll();
};

function requirePositiveInt(payload: Record<string, unknown>, field: string): number {
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
  const keyId = requirePositiveInt(payload, "key_id");
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
    throw err;
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
  const suggestionId = requirePositiveInt(payload, "suggestion_id");
  const createdBy = optionalString(payload, "created_by");
  const suggestion = await surface.fetchSuggestion(suggestionId);
  if (!suggestion) {
    throw new Error(`Suggestion ${suggestionId} no longer exists, so no ping was sent.`);
  }
  const author = suggestion.createdBy ?? createdBy;
  const authorLabel = suggestion.createdByName ?? (author ? userMention(author) : "Someone");
  await surface.sendChannelMessage(BOT_DEV_CHANNEL_ID, buildSuggestionSubmittedPing(authorLabel));
};

/**
 * Payload: `{ suggestion_id, outcome, created_by, title, github_issue_number,
 * github_issue_url, rejection_reason }`. Queued by the API for every review, the bot's own
 * Discord reviews included, so this is the only place the outcome is announced.
 */
export const handleSuggestionOutcome: BotJobHandler = async (payload, surface) => {
  requirePositiveInt(payload, "suggestion_id");
  const createdBy = optionalString(payload, "created_by");
  const outcome = payload.outcome;
  let content: string;
  if (outcome === "approved") {
    content = buildSuggestionApprovedNotice(
      createdBy,
      requirePositiveInt(payload, "github_issue_number"),
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
  await surface.sendChannelMessage(GAMEDB_UPDATES_CHANNEL_ID, content);
};

/** Job kind (BotJob::KINDS in the API) to handler. One line per kind. */
export const BOT_JOB_HANDLERS: BotJobHandlers = {
  voting_poll_wakeup: handleVotingPollWakeup,
  giveaway_claim_notice: handleGiveawayClaimNotice,
  giveaway_hub_refresh: handleGiveawayHubRefresh,
  suggestion_submitted: handleSuggestionSubmitted,
  suggestion_outcome: handleSuggestionOutcome,
};
