import { RESTJSONErrorCodes, type Client } from "discord.js";
import { getGameKeyById, type IGameKey } from "../classes/GameKey.js";
import { requestVotingEventPoll } from "./VotingEventService.js";
import { refreshGiveawayHubMessage } from "./GiveawayHubService.js";
import {
  buildClaimedKeyDm,
  runGiveawayClaimSideEffects,
  type IClaimedGiveawayKey,
} from "./GiveawayClaimService.js";

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

/** Job kind (BotJob::KINDS in the API) to handler. One line per kind. */
export const BOT_JOB_HANDLERS: BotJobHandlers = {
  voting_poll_wakeup: handleVotingPollWakeup,
  giveaway_claim_notice: handleGiveawayClaimNotice,
  giveaway_hub_refresh: handleGiveawayHubRefresh,
};
