import {
  ApplicationCommandOptionType,
  type Attachment,
  AttachmentBuilder,
  type CommandInteraction,
  MessageFlags,
  type SendableChannels,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import axios from "axios";

import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { NEWS_HUB_FEATURE_KEY } from "../config/featureGate.js";
import { DEV_ROLE_ID } from "../config/roles.js";
import { MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildErrorReply,
  buildFileComponent,
  buildTextContainer,
  buildTextReply,
  buildTextSend,
} from "../functions/ComponentsV2Utils.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { NEWS_CATEGORY_THREADS, NEWS_IMPORT_COMMAND } from "../config/newsHub.js";
import { getFeatureState } from "../services/FeaturePostRouting.js";
import { NEWS_COPY_LANE } from "../services/NewsCopyLane.js";
import { discordNewsCopier } from "../services/NewsCopying.js";
import { discordNewsOriginals } from "../services/NewsHistoryCopy.js";
import { createNewsCategoryDeps, moveNewsCopies } from "../services/NewsCategoryChange.js";
import {
  DEFAULT_NEWS_IMPORT_DEPS,
  newsImportStatusReply,
  startNewsHistoryCopyReply,
  type IProgressMessage,
} from "../services/NewsImport.js";
import { NEWS_ITEM_API, NEWS_UNCOPIED_API } from "../services/NewsItemApi.js";
import {
  newsImportDownloadReply,
  newsImportUploadReply,
  type INewsImportMessage,
} from "../services/NewsImportTransfer.js";
import { buildAnyErrorMessage, buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";

const COPY_ERROR_FILE = "news-history-copy-error.txt";
const UPLOAD_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Posts a progress message that names the staff member without pinging them. */
async function postProgress(
  channel: SendableChannels,
  text: string,
): Promise<IProgressMessage> {
  const message = await channel.send({ ...buildTextSend(text), allowedMentions: { parse: [] } });
  return {
    url: message.url,
    edit: async (next) => {
      await message.edit({ ...buildTextSend(next), allowedMentions: { parse: [] } });
    },
  };
}

/**
 * Posts the error that stopped a history copy. A long error (a whole page of the listing
 * in the response) goes in a text file in full.
 */
async function postRunError(channel: SendableChannels, text: string): Promise<void> {
  const allowedMentions = { roles: [DEV_ROLE_ID] };
  if (text.length <= MAX_CONTAINER_TEXT) {
    await channel.send({ ...buildTextSend(text), allowedMentions });
    return;
  }
  const firstLine = text.split("\n", 1)[0];
  const container = buildTextContainer(
    `${firstLine}\nThe full request and response are in the attached file.`,
  ).addFileComponents(buildFileComponent(COPY_ERROR_FILE));
  await channel.send({
    components: [container],
    flags: buildComponentsV2EditFlags(),
    files: [new AttachmentBuilder(Buffer.from(text, "utf-8"), { name: COPY_ERROR_FILE })],
    allowedMentions,
  });
}

/**
 * A private reply with its files. Components V2 shows an attachment only through a file
 * component, so each file is listed in the container under the text.
 */
function messagePayload(message: INewsImportMessage): object {
  const container = buildTextContainer(message.text);
  if (message.files.length) {
    container.addFileComponents(message.files.map((file) => buildFileComponent(file.name)));
  }
  return {
    components: [container],
    flags: buildComponentsV2Flags(true),
    files: message.files.map((file) =>
      new AttachmentBuilder(Buffer.from(file.text, "utf-8"), { name: file.name })),
  };
}

/** Reads an uploaded attachment as UTF-8 text, at most `maxBytes`. */
async function attachmentText(attachment: Attachment, maxBytes: number): Promise<string> {
  const response = await axios.get<ArrayBuffer>(attachment.url, {
    responseType: "arraybuffer",
    timeout: UPLOAD_DOWNLOAD_TIMEOUT_MS,
    maxContentLength: maxBytes,
  });
  return Buffer.from(response.data).toString("utf-8");
}

/**
 * `/news-import` (spec api#355, api#367): staff sort the imported news and copy the news
 * history into the category threads. The API decides who may (Admins and Superadmins,
 * from the acting member's stored roles), so the command has no Discord permission check.
 * It belongs to the News Hub Feature.
 */
@Discord()
@SlashGroup({
  description: "Sort imported news and copy news history into threads (Admins and Superadmins)",
  name: NEWS_IMPORT_COMMAND,
})
@SlashGroup(NEWS_IMPORT_COMMAND)
export class NewsImportCommand {
  @Slash({
    description: "Copy every News Item without a News Copy into its category thread",
    name: "copy",
  })
  async copy(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (!channel?.isSendable()) {
      const text = "Run the history copy in a channel where the bot can post its progress.";
      await safeReply(interaction, buildTextReply(text, true));
      return;
    }

    let reply: string;
    try {
      const started = await startNewsHistoryCopyReply({
        ...DEFAULT_NEWS_IMPORT_DEPS,
        actingUserId: interaction.user.id,
        testMode: IS_TEST_MODE,
        copy: {
          threads: NEWS_CATEGORY_THREADS,
          api: NEWS_ITEM_API,
          discord: discordNewsCopier(interaction.client),
          listing: NEWS_UNCOPIED_API,
          originals: discordNewsOriginals(interaction.client, GAME_NEWS_CHANNEL_ID),
          featureState: () => getFeatureState(NEWS_HUB_FEATURE_KEY),
        },
        post: (text) => postProgress(channel, text),
        postDetails: (text) => postRunError(channel, text),
      });
      // The run outlives the interaction; it reports in the progress message.
      void started.finished;
      reply = started.reply;
    } catch (error: unknown) {
      const message = buildAnyErrorMessage("Could not start the history copy", error);
      await safeReply(interaction, buildErrorReply(message, true));
      return;
    }
    await safeReply(interaction, buildTextReply(reply, true));
  }

  @Slash({
    description: "Show the News Import's counts and how many News Items have a News Copy",
    name: "status",
  })
  async status(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    let text: string;
    try {
      text = await newsImportStatusReply(interaction.user.id);
    } catch (error: unknown) {
      const message = buildApiErrorMessage("Could not read the News Import status", error);
      await safeReply(interaction, buildErrorReply(message, true));
      return;
    }
    await safeReply(interaction, buildTextReply(text, true));
  }

  @Slash({
    description: "Download the unsorted imported News Items as a file to sort",
    name: "download",
  })
  async download(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    let messages: INewsImportMessage[];
    try {
      messages = await newsImportDownloadReply(interaction.user.id, {
        api: DEFAULT_NEWS_IMPORT_DEPS.api,
        maxBytes: interaction.attachmentSizeLimit,
      });
    } catch (error: unknown) {
      const message = buildApiErrorMessage("Could not list the unsorted News Items", error);
      await safeReply(interaction, buildErrorReply(message, true));
      return;
    }
    // After the deferred reply is filled, each further reply is a follow-up message.
    for (const message of messages) {
      await safeReply(interaction, messagePayload(message));
    }
  }

  @Slash({
    description: "Upload a sorted News Import file to assign News Categories",
    name: "upload",
  })
  async upload(
    @SlashOption({
      description: "The file from /news-import download, with its category column filled in",
      name: "file",
      required: true,
      type: ApplicationCommandOptionType.Attachment,
    })
    file: Attachment,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const maxBytes = interaction.attachmentSizeLimit;
    let message: INewsImportMessage;
    try {
      message = await newsImportUploadReply({
        actingUserId: interaction.user.id,
        testMode: IS_TEST_MODE,
        api: DEFAULT_NEWS_IMPORT_DEPS.api,
        maxBytes,
        file: { name: file.name, size: file.size, contentType: file.contentType },
        fetchText: () => attachmentText(file, maxBytes),
        // Runs on after the reply; every failed move is logged (NewsCategoryChange).
        moveCopies: (moves) =>
          void moveNewsCopies(moves, createNewsCategoryDeps(interaction.client)),
        historyCopyRunning: () => NEWS_COPY_LANE.historyRunning(),
      });
    } catch (error: unknown) {
      const text = buildAnyErrorMessage("Could not apply the News Import file", error);
      await safeReply(interaction, buildErrorReply(text, true));
      return;
    }
    if (message.failed) {
      await safeReply(interaction, buildErrorReply(message.text, true));
      return;
    }
    await safeReply(interaction, messagePayload(message));
  }
}
