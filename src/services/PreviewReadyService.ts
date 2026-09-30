import { AttachmentBuilder, type Client } from "discord.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { PREVIEW_COMMANDS_ATTACHMENT_NAME } from "../config/previewCommandCatalog.js";
import { PREVIEW_READY_ANNOUNCEMENT } from "../config/previewMode.js";
import { logError } from "../utilities/LogUtils.js";
import { getCommandMentionCatalog } from "./CommandMentionService.js";

/**
 * This bot's slash commands as the conductor's catalog file, from the IDs startup just
 * loaded for mentions, or none when they could not be read. The conductor then shows
 * each step's command without a mention.
 */
function buildCatalogFiles(): AttachmentBuilder[] {
  const catalog = getCommandMentionCatalog();
  if (!catalog.commands.length) return [];
  const body = Buffer.from(JSON.stringify(catalog), "utf8");
  return [new AttachmentBuilder(body, { name: PREVIEW_COMMANDS_ATTACHMENT_NAME })];
}

/**
 * Tells the conductor a PR preview is up, so it starts that PR's Testing steps. Plain
 * content, not Components V2: the conductor reads `message.content`. The command catalog
 * rides along as an attachment. A failure is logged and never blocks startup;
 * `/conduct` still starts the run by hand.
 */
export async function announcePreviewReady(client: Client): Promise<void> {
  if (!PREVIEW_READY_ANNOUNCEMENT) return;
  try {
    const channel = await client.channels.fetch(BOT_DEV_CHANNEL_ID);
    if (!channel?.isSendable()) {
      throw new Error(`Channel ${BOT_DEV_CHANNEL_ID} is not sendable.`);
    }
    await channel.send({
      content: PREVIEW_READY_ANNOUNCEMENT,
      files: buildCatalogFiles(),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logError("PreviewReady.announce", error);
  }
}
