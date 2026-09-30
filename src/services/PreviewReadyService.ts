import type { Client } from "discord.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { PREVIEW_READY_ANNOUNCEMENT } from "../config/previewMode.js";
import { logError } from "../utilities/LogUtils.js";

/**
 * Tells the conductor a PR preview is up, so it starts that PR's Testing steps. Plain
 * content, not Components V2: the conductor reads `message.content`. A failure is
 * logged and never blocks startup; `/conduct` still starts the run by hand.
 */
export async function announcePreviewReady(client: Client): Promise<void> {
  if (!PREVIEW_READY_ANNOUNCEMENT) return;
  try {
    const channel = await client.channels.fetch(BOT_DEV_CHANNEL_ID);
    if (!channel?.isSendable()) {
      throw new Error(`Channel ${BOT_DEV_CHANNEL_ID} is not sendable.`);
    }
    await channel.send({ content: PREVIEW_READY_ANNOUNCEMENT, allowedMentions: { parse: [] } });
  } catch (error) {
    logError("PreviewReady.announce", error);
  }
}
