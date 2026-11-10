import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import {
  featurePostDestination,
  resolveFeatureState,
  routeFeaturePost,
  routeVotingPost,
  type FeaturePostDestination,
  type FeatureState,
  type IFeatureFlagSource,
  type IVotingPostTarget,
} from "../functions/FeatureGate.js";
import { UserFacingError } from "../utilities/ApiErrorUtils.js";
import { logInfo } from "../utilities/LogUtils.js";
import { featureFlagCache } from "./FeatureAccessService.js";

// Automated public posts follow Feature Flags (spec api#347, bot#1521). Every post site of a
// Feature routes through here: bot jobs the API enqueues and posts the bot makes on its own.

/**
 * A Feature's club-wide state from the shared flag cache. Null when it could not be read,
 * so the post goes to its normal channel. Never rejects.
 */
export function getFeatureState(
  featureKey: string,
  source: IFeatureFlagSource = featureFlagCache,
): Promise<FeatureState | null> {
  return resolveFeatureState(featureKey, source);
}

/** Where a Feature's post goes now: normal channel, bot-dev, or suppressed. */
export async function getFeaturePostDestination(
  featureKey: string,
  source: IFeatureFlagSource = featureFlagCache,
): Promise<FeaturePostDestination> {
  return featurePostDestination(await getFeatureState(featureKey, source));
}

/** How a post site learns its Feature's state: given (a bot job's read), or read now. */
export interface IFeaturePostRouteOptions {
  /** The state already read, e.g. by the bot job dispatcher; omitted, it is read now. */
  state?: FeatureState | null;
  /** Where to read it when no state is given; the shared flag cache by default. */
  source?: IFeatureFlagSource;
}

/**
 * The channel a Feature's post goes to instead of `normalChannelId`: the same channel when
 * Live, the bot-dev channel in Preview, null when Off (the post is suppressed and logged).
 */
export async function routeFeaturePostFor(
  featureKey: string,
  normalChannelId: string,
  options: IFeaturePostRouteOptions = {},
): Promise<string | null> {
  const state = options.state !== undefined
    ? options.state
    : await getFeatureState(featureKey, options.source);
  const channelId = routeFeaturePost(state, normalChannelId);
  if (!channelId) logSuppressedPost(featureKey, `a post to channel ${normalChannelId}`);
  return channelId;
}

/**
 * Where a voting post asked for `requested` goes by the Voting & GOTM flag (routeVotingPost):
 * announcements when Live, the bot-dev channel as a rehearsal in Preview, null when Off.
 * Resolve it once per action and pass the target down to the posting functions.
 */
export async function resolveVotingPostTarget(
  requested: IVotingPostTarget = { channelId: ANNOUNCEMENT_CHANNEL_ID, rehearsal: false },
  source: IFeatureFlagSource = featureFlagCache,
): Promise<IVotingPostTarget | null> {
  if (requested.rehearsal || requested.channelId !== ANNOUNCEMENT_CHANNEL_ID) return requested;
  const featureKey = POST_FEATURE_KEYS.voting;
  const target = routeVotingPost(await getFeatureState(featureKey, source), requested);
  if (!target) logSuppressedPost(featureKey, "a voting post to announcements");
  return target;
}

/** Logs a post left out because its Feature is Off; `what` names it. */
export function logSuppressedPost(featureKey: string, what: string): void {
  logInfo("FeaturePostRouting", `Suppressed ${what}: the ${featureKey} Feature is Off.`);
}

/** Why nothing was posted when a Feature is Off, for a reply or a bot job's result. */
export function featureOffNotice(featureKey: string): string {
  return `Not posted: the ${featureKey} Feature is Off.`;
}

/**
 * Thrown by an explicit "post this" action (results, tie break) when its Feature is Off. A
 * UserFacingError, so an error reply shows its message with no dev ping: nothing broke.
 */
export class FeaturePostSuppressedError extends UserFacingError {
  constructor(featureKey: string) {
    super(featureOffNotice(featureKey));
    this.name = "FeaturePostSuppressedError";
  }
}
