import type { Client } from "discord.js";

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
