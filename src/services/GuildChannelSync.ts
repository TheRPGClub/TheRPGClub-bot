import type { Channel, DMChannel, NonThreadGuildBasedChannel } from "discord.js";
import type { Client } from "discordx";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { apiDelete, apiPostOrThrow, apiPutOrThrow } from "./RpgClubApiClient.js";

const LOG_CONTEXT = "GuildChannelSync";
const CHANNELS_PATH = "/api/v1/guild_channels";

/** One channel as the API's guild channel endpoints take it. */
export interface IGuildChannelPayload {
  channel_id: string;
  name: string;
  /** Discord's numeric ChannelType, sent as is (0 text, 4 category, 5 announcement). */
  channel_type: number;
  parent_id: string | null;
  position: number;
}

/** The PUT body: the path carries the id, so the body leaves it out. */
export type GuildChannelUpsertBody = { data: Omit<IGuildChannelPayload, "channel_id"> };

/** The guild channel endpoints, one method per request, taking the full request body. */
export interface IGuildChannelApi {
  sync: (body: { data: IGuildChannelPayload[] }) => Promise<unknown>;
  upsert: (channelId: string, body: GuildChannelUpsertBody) => Promise<unknown>;
  remove: (channelId: string) => Promise<unknown>;
}

export interface IGuildChannelSyncDeps {
  /** A PR preview shares the production API, so test mode sends nothing. */
  testMode: boolean;
  homeGuildId: string;
  api: IGuildChannelApi;
}

const channelPath = (channelId: string): string =>
  `${CHANNELS_PATH}/${encodeURIComponent(channelId)}`;

export const GUILD_CHANNEL_API: IGuildChannelApi = {
  sync: (body) => apiPostOrThrow(`${CHANNELS_PATH}/sync`, body),
  upsert: (channelId, body) => apiPutOrThrow(channelPath(channelId), body),
  remove: (channelId) => apiDelete(channelPath(channelId)),
};

export const DEFAULT_GUILD_CHANNEL_SYNC_DEPS: IGuildChannelSyncDeps = {
  testMode: IS_TEST_MODE,
  homeGuildId: HOME_GUILD_ID,
  api: GUILD_CHANNEL_API,
};

/** Maps a Discord channel to the API's channel shape. */
export function toGuildChannelPayload(channel: NonThreadGuildBasedChannel): IGuildChannelPayload {
  return {
    channel_id: channel.id,
    name: channel.name,
    channel_type: channel.type,
    parent_id: channel.parentId ?? null,
    position: channel.rawPosition,
  };
}

function toUpsertBody(channel: NonThreadGuildBasedChannel): GuildChannelUpsertBody {
  const { channel_id: _id, ...data } = toGuildChannelPayload(channel);
  return { data };
}

/** A home guild channel the API stores: any guild channel except a thread. */
function isSyncedChannel(
  channel: Channel | DMChannel,
  homeGuildId: string,
): channel is NonThreadGuildBasedChannel {
  if (channel.isDMBased() || channel.isThread()) return false;
  return channel.guildId === homeGuildId;
}

async function send(label: string, request: () => Promise<unknown>): Promise<void> {
  try {
    await request();
  } catch (error: unknown) {
    logError(LOG_CONTEXT, buildApiErrorMessage(label, error));
  }
}

/**
 * channelCreate: stores the new channel. Event handlers have no caller to report to, so
 * a failure is logged with the full request and response instead of thrown.
 */
export async function onGuildChannelCreate(
  channel: Channel | DMChannel,
  deps: IGuildChannelSyncDeps = DEFAULT_GUILD_CHANNEL_SYNC_DEPS,
): Promise<void> {
  if (deps.testMode || !isSyncedChannel(channel, deps.homeGuildId)) return;
  await send(
    `Could not store created channel ${channel.id}`,
    () => deps.api.upsert(channel.id, toUpsertBody(channel)),
  );
}

function sameStoredFields(a: IGuildChannelPayload, b: IGuildChannelPayload): boolean {
  return a.name === b.name &&
    a.channel_type === b.channel_type &&
    a.parent_id === b.parent_id &&
    a.position === b.position;
}

/**
 * channelUpdate: stores a rename, a move or a reorder. Changes the API does not keep
 * (topic, permissions, slowmode) send nothing.
 */
export async function onGuildChannelUpdate(
  oldChannel: Channel | DMChannel,
  newChannel: Channel | DMChannel,
  deps: IGuildChannelSyncDeps = DEFAULT_GUILD_CHANNEL_SYNC_DEPS,
): Promise<void> {
  if (deps.testMode || !isSyncedChannel(newChannel, deps.homeGuildId)) return;
  if (
    isSyncedChannel(oldChannel, deps.homeGuildId) &&
    sameStoredFields(toGuildChannelPayload(oldChannel), toGuildChannelPayload(newChannel))
  ) {
    return;
  }
  await send(
    `Could not store updated channel ${newChannel.id}`,
    () => deps.api.upsert(newChannel.id, toUpsertBody(newChannel)),
  );
}

/** channelDelete: removes the channel. The API answers 204 even if it never stored it. */
export async function onGuildChannelDelete(
  channel: Channel | DMChannel,
  deps: IGuildChannelSyncDeps = DEFAULT_GUILD_CHANNEL_SYNC_DEPS,
): Promise<void> {
  if (deps.testMode || !isSyncedChannel(channel, deps.homeGuildId)) return;
  await send(
    `Could not remove deleted channel ${channel.id}`,
    () => deps.api.remove(channel.id),
  );
}

interface ISyncResult {
  data?: { synced?: number; removed?: number };
}

/**
 * Startup: sends every home guild channel (threads are never listed) as one snapshot,
 * which replaces the API's list. Throws with the full request and response so the
 * startup sequence names the failed step.
 */
export async function syncAllGuildChannels(
  client: Pick<Client, "guilds">,
  deps: IGuildChannelSyncDeps = DEFAULT_GUILD_CHANNEL_SYNC_DEPS,
): Promise<void> {
  if (deps.testMode) {
    logInfo(LOG_CONTEXT, "Test mode: skipped the guild channel sync");
    return;
  }
  const guild = await client.guilds.fetch(deps.homeGuildId);
  const channels = await guild.channels.fetch();
  const data = [...channels.values()]
    .filter((channel): channel is NonThreadGuildBasedChannel => channel !== null)
    .map(toGuildChannelPayload);
  try {
    const result = (await deps.api.sync({ data })) as ISyncResult | null;
    const synced = result?.data?.synced ?? data.length;
    const removed = result?.data?.removed ?? 0;
    logInfo(LOG_CONTEXT, `Synced ${synced} channels, removed ${removed}`);
  } catch (error: unknown) {
    const label = "Could not sync the guild channel list";
    throw new Error(buildApiErrorMessage(label, error), { cause: error });
  }
}
