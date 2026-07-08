import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
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
import { ContainerBuilder } from "@discordjs/builders";
import {
  getModalField,
  replyIfNotOwner,
  safeDeferReply,
  safeReply,
  safeUpdate,
} from "../../functions/InteractionUtils.js";
import {
  buildTextContainer,
  buildTextReply,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
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
} from "./gamedb-utils.js";
import { trimTextDisplayContent } from "./gamedb-profile.service.js";
import { updateGameProfileMessageById } from "./gamedb-profile.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { truncateLabel } from "../../config/textLimits.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputRow,
  buildSelectRow,
} from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";

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
  return buildTextContainer(safeV2TextContent(content, 3500));
}

function buildCompletionPlatformOptions(
  platforms: Array<{ id: number; name: string }>,
): Array<{ label: string; value: string }> {
  const sortedPlatforms = [...platforms].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
  const baseOptions = sortedPlatforms.map((platform) => ({
    label: truncateLabel(platform.name),
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
        label: truncateLabel(value),
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
    buildSelectRow(typeSelect),
    buildSelectRow(dateSelect),
    buildSelectRow(platformSelect),
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
    rows.push(buildSelectRow(removeSelect));
  }

  const nextButton = buildActionButton({ customId: `gamedb-completion-next:${session.id}`, label: "Next", style: ButtonStyle.Primary });
  rows.push(buildButtonRow(nextButton));

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
  safeIgnore(webhook.deleteMessage(session.ephemeralMessageId));
}

export async function startCompletionWizard(
  interaction: ButtonInteraction,
  gameId: number,
  gameTitle: string,
): Promise<void> {
  const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
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
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, field] = segs;
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      safeIgnore(safeReply(interaction, buildTextReply("This completion request has expired.", true)));
      return;
    }
    if (await replyIfNotOwner(interaction, session.userId, "This menu isn't for you.")) return;

    const value = interaction.values?.[0];
    if (!value) {
      safeIgnore(safeReply(interaction, buildTextReply("No selection made.", true)));
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

    const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
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
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      safeIgnore(safeReply(interaction, buildTextReply("This completion request has expired.", true)));
      return;
    }
    if (await replyIfNotOwner(interaction, session.userId, "This action isn't for you.")) return;

    const missing = getCompletionWizardMissingSelections(session);
    const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
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
      modal.addComponents(buildTextInputRow({ customId: "completion-date", label: "Completion date (YYYY-MM-DD)" }));
    }

    modal.addComponents(buildTextInputRow({ customId: "completion-playtime", label: "Playtime hours (optional)", required: false }));

    modal.addComponents(buildTextInputRow({
      customId: "completion-note",
      label: `Note (optional, ${MAX_COMPLETION_NOTE_LEN} chars max)`,
      style: TextInputStyle.Paragraph,
      required: false,
      maxLength: MAX_COMPLETION_NOTE_LEN,
    }));

    safeIgnore(interaction.showModal(modal));
  }
   
  @ModalComponent({ id: /^gamedb-completion-modal:\d+$/ })
  async handleCompletionWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    safeIgnore(safeDeferReply(interaction, { flags: MessageFlags.Ephemeral }));
    if (!session) {
      safeIgnore(safeReply(interaction, buildTextReply("This completion request has expired.", false)));
      return;
    }
    if (await replyIfNotOwner(interaction, session.userId, "This action isn't for you.")) return;

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
        safeIgnore(safeReply(interaction, buildTextReply(err?.message ?? "Invalid completion date.", false)));
        return;
      }
    }

    const playtimeInput = getModalField(interaction, "completion-playtime");
    const playtimeCheck = validateCompletionPlaytimeInput(playtimeInput);
    if (playtimeCheck.error) {
      safeIgnore(safeReply(interaction, buildTextReply(playtimeCheck.error, false)));
      return;
    }
    const playtime = playtimeCheck.value;

    const noteInput = getModalField(interaction, "completion-note");
    const note = noteInput ? noteInput : null;
    if (note && note.length > MAX_COMPLETION_NOTE_LEN) {
      safeIgnore(safeReply(interaction, buildTextReply(`Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`, false)));
      return;
    }

    if (!session.platformChoice) {
      safeIgnore(safeReply(interaction, buildTextReply("Platform selection missing.", false)));
      return;
    }
    const isOtherPlatform = session.platformChoice === "other";
    let platformId: number | null = null;
    if (!isOtherPlatform) {
      const parsedId = Number(session.platformChoice);
      if (!isPositiveInt(parsedId)) {
        safeIgnore(safeReply(interaction, buildTextReply("Invalid platform selection.", false)));
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
        safeIgnore(Member.removeNowPlaying(interaction.user.id, session.gameId));
      }

      await updateGameProfileMessageById(
        interaction,
        session.sourceChannelId,
        session.sourceMessageId,
        session.gameId,
      );

      await deleteCompletionWizardMessage(session);
      COMPLETION_WIZARD_SESSIONS.delete(sessionId);
      safeIgnore(interaction.deleteReply());
    } catch (err: any) {
      safeIgnore(safeReply(interaction, buildTextReply(`Failed to add completion: ${err?.message ?? String(err)}`, false)));
    }
  }
   
  @SelectMenuComponent({ id: /^gamedb-nowplaying-platform-select:\d+$/ })
  async handleGameDbNowPlayingPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [gameIdRaw] = segs;
    const gameId = Number(gameIdRaw);
    if (!isPositiveInt(gameId)) {
      safeIgnore(safeReply(interaction, buildTextReply("Invalid GameDB id.", true)));
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      safeIgnore(safeReply(interaction, buildTextReply("That game was not found in GameDB.", true)));
      return;
    }

    const platformId = Number(interaction.values?.[0]);
    if (!isPositiveInt(platformId)) {
      safeIgnore(safeReply(interaction, buildTextReply("Invalid platform selection.", true)));
      return;
    }

    try {
      await Member.addNowPlaying(interaction.user.id, gameId, platformId, null);
      const nowPlaying = new NowPlayingCommand();
      await nowPlaying.showSingle(interaction, interaction.user, true);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        safeIgnore(safeReply(interaction, buildTextReply(`**${game.title}** is already in your Now Playing list.`, true)));
        return;
      }
      const msg = err?.message ?? "Failed to add to Now Playing.";
      safeIgnore(safeReply(interaction, buildTextReply(`Failed to add: ${msg}`, true)));
    }
  }
}
