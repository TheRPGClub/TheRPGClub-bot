import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  WebhookClient,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  SlashGroup,
} from "discordx";
import { ModalBuilder } from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import {
  getModalField,
  safeDeferReply,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import { buildTextReply, safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import {
  notifyUnknownCompletionPlatform,
  validateCompletionPlaytimeInput,
} from "../../functions/CompletionHelpers.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "../profile.command.js";
import { padCommandName } from "../help.command.js";
import Game from "../../classes/Game.js";
import Member from "../../classes/Member.js";
import { NowPlayingCommand } from "../now-playing.command.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import {
  buildComponentsV2Flags,
  isUniqueConstraintError,
  MAX_COMPLETION_NOTE_LEN,
  MAX_NOW_PLAYING_NOTE_LEN,
} from "./gamedb-utils.js";
import { trimTextDisplayContent } from "./gamedb-profile.service.js";
import { updateGameProfileMessageById } from "./gamedb-profile.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

const COMPLETION_WIZARD_SESSIONS = new Map<string, CompletionWizardSession>();

type CompletionWizardSession = {
  id: string;
  userId: string;
  gameId: number;
  gameTitle: string;
  createdAt: Date;
  sourceMessageId: string;
  sourceChannelId: string;
  interactionToken: string;
  applicationId: string;
  completionType?: CompletionType;
  dateChoice?: "today" | "unknown" | "date";
  platformChoice?: string;
  removeChoice?: "yes" | "no";
  requiresRemoveChoice: boolean;
  ephemeralMessageId?: string;
};

function buildCompletionWizardContainer(
  session: CompletionWizardSession,
  platformOptions: Array<{ label: string; value: string }>,
  missingSelections: string[] = [],
): ContainerBuilder {
  const dateLabel = session.dateChoice
    ? ({
      today: "Today",
      unknown: "Unknown",
      date: "Enter Date",
    } as const)[session.dateChoice]
    : "Select";
  const platformLabel = session.platformChoice
    ? (
      session.platformChoice === "other"
        ? "Other"
        : platformOptions.find((opt) => opt.value === session.platformChoice)?.label
    ) ?? "Select"
    : "Select";
  const removeLabel = session.requiresRemoveChoice
    ? (session.removeChoice === "yes" ? "Yes" : session.removeChoice === "no" ? "No" : "Select")
    : "N/A";

  const labels = [
    "Game",
    "Completion type",
    "Completion date",
    "Platform",
    "Remove from Now Playing",
  ];
  const labelWidth = Math.max(...labels.map((label) => label.length));

  const lines = [
    "## Add Completion",
    `> **\`\` ${padCommandName("Game", labelWidth + 1)}\`\`**  ${session.gameTitle}`,
    `> **\`\` ${padCommandName("Completion type", labelWidth + 1)}\`\`**  ${session.completionType ?? "Select"}`,
    `> **\`\` ${padCommandName("Completion date", labelWidth + 1)}\`\`**  ${dateLabel}`,
    `> **\`\` ${padCommandName("Platform", labelWidth + 1)}\`\`**  ${platformLabel}`,
    `> **\`\` ${padCommandName("Remove from Now Playing", labelWidth + 1)}\`\`**  ${removeLabel}`,
    "",
    "Pick your options and select Next to enter any details.",
  ];
  if (missingSelections.length) {
    lines.push("", `**Missing:** ${missingSelections.join(", ")}`);
  }
  const content = trimTextDisplayContent(lines.join("\n"));
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
  );
}

function buildCompletionPlatformOptions(
  platforms: Array<{ id: number; name: string }>,
): Array<{ label: string; value: string }> {
  const sortedPlatforms = [...platforms].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
  const baseOptions = sortedPlatforms.map((platform) => ({
    label: platform.name.slice(0, 100),
    value: String(platform.id),
  }));
  return [
    ...baseOptions.slice(0, 24),
    { label: "Other", value: "other" },
  ];
}

function buildCompletionWizardComponents(
  session: CompletionWizardSession,
  platformOptions: Array<{ label: string; value: string }>,
): Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> {
  const typeSelect = new StringSelectMenuBuilder()
     
    .setCustomId(`gamedb-completion-select:${session.id}:type`)
    .setPlaceholder("Completion type")
    .addOptions(
      COMPLETION_TYPES.map((value) => ({
        label: value.slice(0, 100),
        value,
        default: session.completionType === value,
      })),
    );

  const dateSelect = new StringSelectMenuBuilder()
     
    .setCustomId(`gamedb-completion-select:${session.id}:date`)
    .setPlaceholder("Completion date")
    .addOptions(
      {
        label: "Today",
        value: "today",
        default: session.dateChoice === "today",
      },
      {
        label: "Unknown",
        value: "unknown",
        default: session.dateChoice === "unknown",
      },
      {
        label: "Enter Date",
        value: "date",
        default: session.dateChoice === "date",
      },
    );

  const platformSelect = new StringSelectMenuBuilder()
     
    .setCustomId(`gamedb-completion-select:${session.id}:platform`)
    .setPlaceholder("Platform")
    .addOptions(
      platformOptions.map((option) => ({
        ...option,
        default: session.platformChoice === option.value,
      })),
    );

  const rows: Array<
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  > = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(platformSelect),
  ];

  if (session.requiresRemoveChoice) {
    const removeSelect = new StringSelectMenuBuilder()
       
      .setCustomId(`gamedb-completion-select:${session.id}:remove`)
      .setPlaceholder("Remove from Now Playing?")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.removeChoice === "yes",
        },
        {
          label: "No",
          value: "no",
          default: session.removeChoice === "no",
        },
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect));
  }

  const nextButton = new ButtonBuilder()
     
    .setCustomId(`gamedb-completion-next:${session.id}`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Primary);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(nextButton));

  return rows;
}

function getCompletionWizardMissingSelections(session: CompletionWizardSession): string[] {
  const missing: string[] = [];
  if (!session.completionType) missing.push("Completion type");
  if (!session.dateChoice) missing.push("Completion date");
  if (!session.platformChoice) missing.push("Platform");
  if (session.requiresRemoveChoice && !session.removeChoice) {
    missing.push("Remove from Now Playing");
  }
  return missing;
}

async function deleteCompletionWizardMessage(session: CompletionWizardSession): Promise<void> {
  if (!session.ephemeralMessageId) return;
  const webhook = new WebhookClient({
    id: session.applicationId,
    token: session.interactionToken,
  });
  await webhook.deleteMessage(session.ephemeralMessageId).catch(() => {});
}

export async function startCompletionWizard(
  interaction: ButtonInteraction,
  gameId: number,
  gameTitle: string,
): Promise<void> {
  const platforms = await Game.getPlatformsForGameWithStandard(
    gameId,
    STANDARD_PLATFORM_IDS,
  );
  if (!platforms.length) {
    await safeReply(interaction, { ...buildTextReply("No platform release data is available for this game.", true), __forceFollowUp: true });
    return;
  }

  const message = interaction.message;
  if (!message) {
    await safeReply(interaction, { ...buildTextReply("Unable to locate the original GameDB view message.", true), __forceFollowUp: true });
    return;
  }

  const nowPlayingMeta = await Member.getNowPlayingEntryMeta(interaction.user.id, gameId);
  const sessionId = interaction.id;
  const session: CompletionWizardSession = {
    id: sessionId,
    userId: interaction.user.id,
    gameId,
    gameTitle,
    createdAt: new Date(),
    sourceMessageId: message.id,
    sourceChannelId: message.channelId,
    interactionToken: interaction.token,
    applicationId: interaction.applicationId,
    requiresRemoveChoice: Boolean(nowPlayingMeta),
  };
  COMPLETION_WIZARD_SESSIONS.set(sessionId, session);

  const platformOptions = buildCompletionPlatformOptions(platforms);
  const container = buildCompletionWizardContainer(session, platformOptions);
  const components = [container, ...buildCompletionWizardComponents(session, platformOptions)];
  const response = await safeReply(interaction, {
    components,
    flags: buildComponentsV2Flags(true),
    withResponse: true,
  });
  const replyMessage = response?.resource?.message ?? response;
  if (replyMessage && typeof replyMessage === "object" && "id" in replyMessage) {
    session.ephemeralMessageId = replyMessage.id as string;
  }
}

@Discord()
@SlashGroup("gamedb")
export class GameDbCompletionCommand {
   
  @SelectMenuComponent({ id: /^gamedb-completion-select:\d+:(type|date|platform|remove)$/ })
  async handleCompletionWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const field = parts[2];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      await safeReply(interaction, buildTextReply("This completion request has expired.", true)).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await safeReply(interaction, buildTextReply("This menu isn't for you.", true)).catch(() => {});
      return;
    }

    const value = interaction.values?.[0];
    if (!value) {
      await safeReply(interaction, buildTextReply("No selection made.", true)).catch(() => {});
      return;
    }

    if (field === "type") {
      session.completionType = value as CompletionType;
    } else if (field === "date") {
      session.dateChoice = value as CompletionWizardSession["dateChoice"];
    } else if (field === "platform") {
      session.platformChoice = value;
    } else if (field === "remove") {
      session.removeChoice = value as CompletionWizardSession["removeChoice"];
    }

    const platforms = await Game.getPlatformsForGameWithStandard(
      session.gameId,
      STANDARD_PLATFORM_IDS,
    );
    const platformOptions = buildCompletionPlatformOptions(platforms);
    const container = buildCompletionWizardContainer(session, platformOptions);
    const components = [
      container,
      ...buildCompletionWizardComponents(session, platformOptions),
    ];
    await safeUpdate(interaction, { components });
  }
   
  @ButtonComponent({ id: /^gamedb-completion-next:\d+$/ })
  async handleCompletionWizardNext(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      await safeReply(interaction, buildTextReply("This completion request has expired.", true)).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await safeReply(interaction, buildTextReply("This action isn't for you.", true)).catch(() => {});
      return;
    }

    const missing = getCompletionWizardMissingSelections(session);
    const platforms = await Game.getPlatformsForGameWithStandard(
      session.gameId,
      STANDARD_PLATFORM_IDS,
    );
    const platformOptions = buildCompletionPlatformOptions(platforms);
    if (missing.length) {
      const container = buildCompletionWizardContainer(session, platformOptions, missing);
      const components = [
        container,
        ...buildCompletionWizardComponents(session, platformOptions),
      ];
      await safeUpdate(interaction, { components });
      return;
    }

    const modal = new ModalBuilder()
       
      .setCustomId(`gamedb-completion-modal:${session.id}`)
      .setTitle("Add Completion Details");

    if (session.dateChoice === "date") {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
             
            .setCustomId("completion-date")
            .setLabel("Completion date (YYYY-MM-DD)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
           
          .setCustomId("completion-playtime")
          .setLabel("Playtime hours (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
           
          .setCustomId("completion-note")
          .setLabel(`Note (optional, ${MAX_COMPLETION_NOTE_LEN} chars max)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(MAX_COMPLETION_NOTE_LEN),
      ),
    );

    await interaction.showModal(modal).catch(() => {});
  }
   
  @ModalComponent({ id: /^gamedb-completion-modal:\d+$/ })
  async handleCompletionWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!session) {
      await safeReply(interaction, buildTextReply("This completion request has expired.", false)).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await safeReply(interaction, buildTextReply("This action isn't for you.", false)).catch(() => {});
      return;
    }

    let completedAt: Date | null = null;
    if (session.dateChoice === "today") {
      completedAt = new Date();
    } else if (session.dateChoice === "unknown") {
      completedAt = null;
    } else if (session.dateChoice === "date") {
      const dateInput = getModalField(interaction, "completion-date");
      try {
        completedAt = parseCompletionDateInput(dateInput);
      } catch (err: any) {
        await safeReply(interaction, buildTextReply(err?.message ?? "Invalid completion date.", false)).catch(() => {});
        return;
      }
    }

    const playtimeInput = getModalField(interaction, "completion-playtime");
    const playtimeCheck = validateCompletionPlaytimeInput(playtimeInput);
    if (playtimeCheck.error) {
      await safeReply(interaction, buildTextReply(playtimeCheck.error, false)).catch(() => {});
      return;
    }
    const playtime = playtimeCheck.value;

    const noteInput = getModalField(interaction, "completion-note");
    const note = noteInput ? noteInput : null;
    if (note && note.length > MAX_COMPLETION_NOTE_LEN) {
      await safeReply(interaction, buildTextReply(`Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`, false)).catch(() => {});
      return;
    }

    if (!session.platformChoice) {
      await safeReply(interaction, buildTextReply("Platform selection missing.", false)).catch(() => {});
      return;
    }
    const isOtherPlatform = session.platformChoice === "other";
    let platformId: number | null = null;
    if (!isOtherPlatform) {
      const parsedId = Number(session.platformChoice);
      if (!isPositiveInt(parsedId)) {
        await safeReply(interaction, buildTextReply("Invalid platform selection.", false)).catch(() => {});
        return;
      }
      platformId = parsedId;
    } else {
      await notifyUnknownCompletionPlatform(interaction, session.gameTitle, session.gameId);
    }

    const removeFromNowPlaying = session.removeChoice === "yes";

    try {
      await Member.addCompletion({
        userId: interaction.user.id,
        gameId: session.gameId,
        completionType: session.completionType ?? "Main Story",
        platformId,
        completedAt,
        finalPlaytimeHours: playtime,
        note,
      });
      if (removeFromNowPlaying) {
        await Member.removeNowPlaying(interaction.user.id, session.gameId).catch(() => {});
      }

      await updateGameProfileMessageById(
        interaction,
        session.sourceChannelId,
        session.sourceMessageId,
        session.gameId,
      );

      await deleteCompletionWizardMessage(session);
      COMPLETION_WIZARD_SESSIONS.delete(sessionId);
      await interaction.deleteReply().catch(() => {});
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(`Failed to add completion: ${err?.message ?? String(err)}`, false)).catch(() => {});
    }
  }
   
  @ModalComponent({ id: /^gamedb-nowplaying-modal:\d+$/ })
  async handleGameDbNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!isPositiveInt(gameId)) {
      await safeReply(interaction, buildTextReply("Invalid GameDB id.", false)).catch(() => {});
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await safeReply(interaction, buildTextReply("That game was not found in GameDB.", false)).catch(() => {});
      return;
    }

    const noteRaw = getModalField(interaction, "gamedb-nowplaying-note");
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await safeReply(interaction, buildTextReply(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`, false)).catch(() => {});
      return;
    }

    const note = noteRaw.length ? noteRaw : null;
    try {
      const platforms = await Game.getPlatformsForGame(gameId);
      if (!platforms.length) {
        await safeReply(interaction, buildTextReply("This game has no platform data yet. Add to Now Playing from `/now-playing list` " +
            "after platform data is available.", false)).catch(() => {});
        return;
      }
      const defaultPlatform = platforms[0];
      await Member.addNowPlaying(interaction.user.id, gameId, defaultPlatform.id, note);
      const nowPlaying = new NowPlayingCommand();
      await nowPlaying.showSingle(interaction, interaction.user, true);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        await safeReply(interaction, buildTextReply(`**${game.title}** is already in your Now Playing list.`, false)).catch(() => {});
        return;
      }
      const msg = err?.message ?? "Failed to add to Now Playing.";
      await safeReply(interaction, buildTextReply(`Failed to add: ${msg}`, false)).catch(() => {});
    }
  }
}
