import type { Client } from "discord.js";

import {
  featurePostDestination,
  resolveFeatureState,
  routeFeaturePost,
  type FeaturePostDestination,
  type FeatureState,
  type IFeatureAccessSource,
} from "../functions/FeatureGate.js";
import { logInfo } from "../utilities/LogUtils.js";
import { featureAccessCache } from "./FeatureAccessService.js";

// Automated public posts follow Feature Flags (spec api#347, bot#1521). Every post site of a
// Feature routes through here: bot jobs the API enqueues and posts the bot makes on its own.

/**
 * A Feature's club-wide state, read from the cached access lookup for the bot's own user
 * (a flag's state is the same for everyone). Null when the bot is not logged in or the
 * lookup failed, so the post goes to its normal channel. Never rejects.
 */
export function getFeatureState(
  client: Client,
  featureKey: string,
  source: IFeatureAccessSource = featureAccessCache,
): Promise<FeatureState | null> {
  return resolveFeatureState(featureKey, client.user?.id ?? null, source);
}

/** Where a Feature's post goes now: normal channel, bot-dev, or suppressed. */
export async function getFeaturePostDestination(
  client: Client,
  featureKey: string,
  source: IFeatureAccessSource = featureAccessCache,
): Promise<FeaturePostDestination> {
  return featurePostDestination(await getFeatureState(client, featureKey, source));
}

/**
 * The channel a Feature's post goes to instead of `normalChannelId`: the same channel when
 * Live, the bot-dev channel in Preview, null when Off (the post is suppressed and logged).
 */
export async function routeFeaturePostFor(
  client: Client,
  featureKey: string,
  normalChannelId: string,
  source: IFeatureAccessSource = featureAccessCache,
): Promise<string | null> {
  const channelId = routeFeaturePost(
    await getFeatureState(client, featureKey, source),
    normalChannelId,
  );
  if (!channelId) logSuppressedPost(featureKey, `a post to channel ${normalChannelId}`);
  return channelId;
}

/** Logs a post left out because its Feature is Off; `what` names it. */
export function logSuppressedPost(featureKey: string, what: string): void {
  logInfo("FeaturePostRouting", `Suppressed ${what}: the ${featureKey} Feature is Off.`);
}

/** Thrown by an explicit "post this" action (results, panels) when its Feature is Off. */
export class FeaturePostSuppressedError extends Error {
  constructor(featureKey: string) {
    super(`Nothing was posted: the ${featureKey} Feature is Off.`);
    this.name = "FeaturePostSuppressedError";
  }
}
