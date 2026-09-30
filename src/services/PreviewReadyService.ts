import { AttachmentBuilder, type Client } from "discord.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import {
  PREVIEW_COMMANDS_ATTACHMENT_NAME,
  buildCommandCatalog,
} from "../config/previewCommandCatalog.js";
import { PREVIEW_READY_ANNOUNCEMENT } from "../config/previewMode.js";
import { TEST_GUILD_ID } from "../config/testMode.js";
import { logError } from "../utilities/LogUtils.js";

/**
 * This bot's slash commands as the conductor's catalog file, or none when they cannot
 * be read. The conductor then shows each step's command without a mention.
 */
async function buildCatalogFiles(client: Client): Promise<AttachmentBuilder[]> {
  if (!client.application) return [];
  try {
    const global = await client.application.commands.fetch();
    const guild = TEST_GUILD_ID
      ? await client.application.commands.fetch({ guildId: TEST_GUILD_ID })
      : new Map();
    const catalog = buildCommandCatalog([...global.values(), ...guild.values()]);
    const body = Buffer.from(JSON.stringify(catalog), "utf8");
    return [new AttachmentBuilder(body, { name: PREVIEW_COMMANDS_ATTACHMENT_NAME })];
  } catch (error) {
    logError("PreviewReady.commandCatalog", error);
    return [];
  }
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
      files: await buildCatalogFiles(client),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logError("PreviewReady.announce", error);
  }
}
