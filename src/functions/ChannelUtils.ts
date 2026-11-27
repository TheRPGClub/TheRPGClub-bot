import { PermissionFlagsBits, type Client } from "discord.js";

/** A channel the bot can post to. */
export type SendableChannel = { send: (payload: any) => Promise<any> };

/**
 * Fetches a channel and returns it only if it is text-based and can be sent
 * to. A missing channel or a failed fetch returns null.
 */
export async function fetchSendableChannel(
  client: Client,
  channelId: string,
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || typeof (channel as any).send !== "function") {
    return null;
  }
  return channel as unknown as SendableChannel;
}

/** A permission flag and the name Discord shows for it. */
export type NamedPermission = readonly [flag: bigint, name: string];

export const VIEW_CHANNEL_PERMISSION: NamedPermission =
  [PermissionFlagsBits.ViewChannel, "View Channel"];
export const READ_HISTORY_PERMISSION: NamedPermission =
  [PermissionFlagsBits.ReadMessageHistory, "Read Message History"];
export const SEND_MESSAGES_PERMISSION: NamedPermission =
  [PermissionFlagsBits.SendMessages, "Send Messages"];
export const ATTACH_FILES_PERMISSION: NamedPermission =
  [PermissionFlagsBits.AttachFiles, "Attach Files"];
const SEND_IN_THREADS_PERMISSION: NamedPermission =
  [PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"];

/** The permission a post to `channel` needs: a thread has its own. */
export function sendPermissionFor(channel: unknown): NamedPermission {
  const maybeThread = channel as { isThread?: () => boolean } | null;
  return maybeThread?.isThread?.() ? SEND_IN_THREADS_PERMISSION : SEND_MESSAGES_PERMISSION;
}

type PermissionsReader = { has: (flag: bigint) => boolean };

/**
 * The names of the `required` permissions the bot lacks in `channel`, so a refused post can
 * say which one to grant rather than Discord's bare "Missing Permissions". Null when that
 * cannot be told (a DM, no logged-in user, or the bot's member is not cached).
 */
export function listMissingBotPermissions(
  client: Client,
  channel: unknown,
  required: readonly NamedPermission[],
): string[] | null {
  const guildChannel = channel as {
    permissionsFor?: (user: unknown) => PermissionsReader | null;
  } | null;
  if (!client.user || typeof guildChannel?.permissionsFor !== "function") return null;
  const permissions = guildChannel.permissionsFor(client.user);
  if (!permissions) return null;
  return required.filter(([flag]) => !permissions.has(flag)).map(([, name]) => name);
}
