import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type {
  CommandInteraction,
  GuildBasedChannel,
  Message,
  ModalSubmitInteraction,
} from "discord.js";
import type { ContainerBuilder } from "@discordjs/builders";
import {
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  handleLiveStreamCreateModal,
  openLiveStreamCreateModal,
} from "./admin/live-stream-admin.service.js";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import { isModerator } from "./admin/admin-auth.utils.js";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  buildErrorReply,
  buildTextReply,
  buildTitledContainer,
  buildFieldsText,
  buildComponentsV2EditFlags,
  type EmbedField,
} from "../functions/ComponentsV2Utils.js";
import {
  renderLinkPreviewForMessage,
  type IPreviewRenderResult,
} from "../services/LinkPreviewRecoveryService.js";
import { buildDiscordErrorMessage } from "../utilities/ApiErrorUtils.js";
import { isSnowflake } from "../utilities/ValidationUtils.js";
import { truncateDescription } from "../config/textLimits.js";
import { buildSelectRow } from "../functions/uiComponents.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";

type ModHelpTopicId = "presence" | "presence-history" | "rerender-embed";

type ModHelpTopic = {
  id: ModHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
};

export const MOD_HELP_TOPICS: ModHelpTopic[] = [
  {
    id: "presence",
    label: "/mod presence",
    summary: 'Set the bot\'s "Now Playing" text.',
    syntax: "Syntax: /mod presence text:<string>",
    parameters: "text (required string) - new presence text.",
  },
  {
    id: "presence-history",
    label: "/mod presence-history",
    summary: "Show the most recent presence changes.",
    syntax: "Syntax: /mod presence-history [count:<integer>]",
    parameters: "count (optional integer, default 5, max 50) - number of entries.",
  },
  {
    id: "rerender-embed",
    label: "/mod rerender-embed",
    summary: "Delete a failed link preview and rebuild it.",
    syntax: "Syntax: /mod rerender-embed message_id:<string> [channel:<channel>]",
    parameters: [
      "message_id (required string) - the stuck preview or the post it replied to.",
      "channel (optional channel) - where the message lives, defaults to this channel.",
    ].join("\n"),
  },
];

async function resolveSourceMessage(message: Message): Promise<Message> {
  const referencedId = message.reference?.messageId;
  if (message.author.id !== message.client.user.id || !referencedId) return message;
  return message.fetchReference();
}

export function describeRerenderResult(
  result: IPreviewRenderResult,
  sourceUrl: string,
): string {
  const cleared = result.deletedStuckReply
    ? "Deleted the stuck preview."
    : "No stuck preview found.";

  switch (result.status) {
    case "rendered":
      return `${cleared} Re-rendered the preview for ${sourceUrl}`;
    case "still-interstitial":
      return `${cleared} ${result.url} is still behind a browser check, so nothing was posted.`;
    case "no-preview-data":
      return `${cleared} No preview data could be read from ${result.url}`;
    case "no-url":
      return `${cleared} ${sourceUrl} has no link to preview.`;
    case "skipped-existing-embed":
      return `${cleared} Discord already rendered an embed for ${sourceUrl}`;
  }
}

function buildModHelpButtons(
  activeId?: ModHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("mod-help-select")
    .setPlaceholder("/mod help")
    .addOptions(
      MOD_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: truncateDescription(topic.summary),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [buildSelectRow(select)];
}

export function buildModHelpContainer(topic: ModHelpTopic): ContainerBuilder {
  const fields: EmbedField[] = [{ name: "Syntax", value: topic.syntax }];
  if (topic.parameters) fields.push({ name: "Parameters", value: topic.parameters });
  return buildTitledContainer(`${topic.label} help`, buildFieldsText(fields));
}

@Discord()
@SlashGroup({ description: "Moderator Commands", name: "mod" })
@SlashGroup("mod")
export class Mod {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be?",
      name: "text",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);

    if (okToUseCommand) {
      text = sanitizeUserInput(text, { preserveNewlines: false });
      await setPresence(
        interaction,
        text,
      );
      await safeReply(interaction, buildTextReply(`I'm now playing: ${text}!`, false));
    }
  }

  @Slash({ description: "Show presence history", name: "presence-history" })
  async presenceHistory(
    @SlashOption({
      description: "How many entries to show (default 5, max 50)",
      name: "count",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    count: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const limit =
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(1, Math.min(50, Math.trunc(count)))
        : 5;

    const entries = await getPresenceHistory(limit);

    if (!entries.length) {
      await safeReply(interaction, buildTextReply("No presence history found.", false));
      return;
    }

    const lines = entries.map((entry) => {
      const timestamp =
        entry.setAt instanceof Date
          ? `<t:${toUnixTimestamp(entry.setAt)}:F>`
          : String(entry.setAt);
      const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
      return `• ${timestamp} ${entry.activityName} (set by ${userDisplay})`;
    });

    const header = `Last ${entries.length} presence entr${
      entries.length === 1 ? "y" : "ies"
    }:\n`;

    await safeReply(interaction, buildTextReply(header + lines.join("\n"), false));
  }

  @Slash({ description: "Show help for moderator commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildModHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: response.flags | MessageFlags.Ephemeral,
    });
  }

  @Slash({
    description: "Delete a failed link preview and rebuild it",
    name: "rerender-embed",
  })
  async rerenderEmbed(
    @SlashOption({
      description: "Message ID of the stuck preview or the post it replied to",
      name: "message_id",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    messageId: string,
    @SlashOption({
      description: "Channel holding the message (defaults to this channel)",
      name: "channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: GuildBasedChannel | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const targetId = sanitizeUserInput(messageId, { preserveNewlines: false }).trim();
    if (!isSnowflake(targetId)) {
      await safeReply(interaction, buildTextReply(`\`${targetId}\` is not a message ID.`, true));
      return;
    }

    const targetChannel = channel ?? interaction.channel;
    if (!targetChannel || !("messages" in targetChannel)) {
      await safeReply(interaction, buildTextReply("That channel cannot hold messages.", true));
      return;
    }

    try {
      const fetched = await targetChannel.messages.fetch(targetId);
      const sourceMessage = await resolveSourceMessage(fetched);
      const result = await renderLinkPreviewForMessage(sourceMessage, {
        skipWhenEmbedded: false,
        sweepStuckReplies: true,
      });
      await safeReply(
        interaction,
        buildTextReply(describeRerenderResult(result, sourceMessage.url), true),
      );
    } catch (error) {
      const message = buildDiscordErrorMessage(
        `Failed to re-render the preview for \`${targetId}\``,
        error,
      );
      await safeReply(interaction, buildErrorReply(message, true));
    }
  }

  @Slash({
    description: "Create a Live Events thread and linked scheduled event from one modal",
    name: "create-live-event",
  })
  async createLiveEvent(interaction: CommandInteraction): Promise<void> {
    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    await openLiveStreamCreateModal(interaction);
  }

  @ModalComponent({ id: /^admin-live-stream-create:\d+$/ })
  async handleCreateLiveEventModal(interaction: ModalSubmitInteraction): Promise<void> {
    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleLiveStreamCreateModal(interaction);
  }

  @SelectMenuComponent({ id: "mod-help-select" })
  async handleModHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as ModHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = topicId ? MOD_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildModHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const container = buildModHelpContainer(topic);
    const response = buildModHelpResponse(topic.id);

    await safeUpdate(interaction, {
      components: [container, ...response.components],
      flags: response.flags,
    });
  }
}

export function buildModHelpResponse(
  activeTopicId?: ModHelpTopicId,
): {
  components: (ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>)[];
  flags: number;
} {
  const container = buildTitledContainer(
    "Moderator Commands Help",
    "Pick a `/mod` command to see what it does and how to run it.",
  );
  const buttons = buildModHelpButtons(activeTopicId);

  return {
     
    components: [container, ...buttons],
    flags: buildComponentsV2EditFlags(),
  };
}
