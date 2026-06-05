import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type GuildMember,
  type User,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  resolveMemberLabel,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
} from "../../functions/ComponentsV2Utils.js";
import { flattenErrorMessages } from "../imports/import-scaffold.service.js";
import {
  buildAllCollectionsOverviewMessages,
  buildCollectionOverviewResponse,
  extractOverviewTitleFromMessage,
  parseCollectionOverviewSelectId,
  parseCollectionOverviewSelectValue,
  resolveMemberLabelFromOverviewTitle,
} from "./collection-overview.service.js";
import {
  applyFiltersToSourceMessage,
  buildCollectionFilterModalId,
  buildCollectionFilterPanelComponents,
  buildCollectionFilterPanelContent,
  buildCollectionListNavId,
  buildCollectionListResponseForTests,
  buildOwnershipFilterCode,
  closeFilterPanel,
  COLLECTION_FILTER_PLATFORM_INPUT_ID,
  COLLECTION_FILTER_TITLE_INPUT_ID,
  nextOwnershipType,
  parseCollectionFilterActionId,
  parseCollectionFilterModalId,
  parseCollectionFilterPanelActionId,
  parseCollectionFilterStateFromContent,
  parseCollectionFiltersFromListMessage,
  parseCollectionListNavId,
} from "./collection-list.service.js";

function buildCollectionListResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  title: string | undefined;
  platform: string | undefined;
  platformId: number | undefined;
  platformLabel: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
  page: number;
  isEphemeral: boolean;
  debugSource?: "nav";
}) {
  return buildCollectionListResponseForTests(params);
}

@Discord()
@SlashGroup("collection")
export class CollectionViewCommand {
  @Slash({ name: "list", description: "List your collection or another member collection" })
  async list(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | GuildMember | undefined,
    @SlashOption({
      name: "title",
      description: "Filter by title",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    title: string | undefined,
    @SlashOption({
      name: "platform",
      description: "Filter by platform text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    platform: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Filter by ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, show results in channel instead of private response.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    const targetUserId = member?.id ?? interaction.user.id;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;
    const platformFilter = platform
      ? sanitizeUserInput(platform, { preserveNewlines: false })
      : undefined;

    const memberLabel = resolveMemberLabel(member, interaction.user);
    const response = await buildCollectionListResponse({
      viewerUserId: interaction.user.id,
      targetUserId,
      memberLabel,
      title: titleFilter,
      platform: platformFilter,
      platformId: undefined,
      platformLabel: platformFilter,
      ownershipType,
      page: 0,
      isEphemeral,
    });

    if (response.content) {
      await safeReply(interaction, response.content);
      return;
    }
    await safeReply(interaction, {
      components: response.components,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @Slash({ name: "overview", description: "Show a summary of your collection by platform" })
  async overview(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | GuildMember | undefined,
    @SlashOption({
      name: "all",
      description: "Show combined collection stats for all users.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showAll: boolean | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, show results in channel instead of private response.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    if (showAll) {
      const messages = await buildAllCollectionsOverviewMessages();
      const [first, ...rest] = messages;
      if (!first) {
        await safeReply(interaction, "No collection entries yet.");
        return;
      }

      await safeReply(interaction, {
        components: first.components,
        flags: buildComponentsV2Flags(isEphemeral),
      });

      for (const message of rest) {
        await safeReply(interaction, {
          components: message.components,
          flags: buildComponentsV2Flags(isEphemeral),
          __forceFollowUp: true,
        });
      }
      return;
    }

    const targetUserId = member?.id ?? interaction.user.id;
    const memberLabel = resolveMemberLabel(member, interaction.user);
    const components = await buildCollectionOverviewResponse({
      viewerUserId: interaction.user.id,
      targetUserId,
      memberLabel,
      isEphemeral,
      titleOverride: member ? `${memberLabel}'s Game Collection` : undefined,
    });

    await safeReply(interaction, {
      components,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @SelectMenuComponent({
    id: /^collection-overview-select-v1:[^:]+:[^:]+:[ep]$/,
  })
  async onCollectionOverviewSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parsed = parseCollectionOverviewSelectId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This collection overview control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await safeReply(interaction, {
        content: "This collection overview is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const selection = parseCollectionOverviewSelectValue(interaction.values?.[0] ?? "");
    if (!selection) {
      await safeReply(interaction, {
        content: "That collection selection is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const overviewTitle = extractOverviewTitleFromMessage(interaction.message);
    const memberLabel = resolveMemberLabelFromOverviewTitle(
      overviewTitle ?? "",
      interaction.user.username,
    );

    await safeDeferUpdate(interaction);

    if (selection === "overview") {
      const components = await buildCollectionOverviewResponse({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        memberLabel,
        isEphemeral: parsed.isEphemeral,
        titleOverride: overviewTitle ?? undefined,
      });

      await safeReply(interaction, {
        components,
        flags: buildComponentsV2EditFlags(),
      }).catch(() => {});
      return;
    }

    if (selection === "all-games") {
      const response = await buildCollectionListResponse({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        memberLabel,
        title: undefined,
        platform: undefined,
        platformId: undefined,
        platformLabel: undefined,
        ownershipType: undefined,
        page: 0,
        isEphemeral: parsed.isEphemeral,
      });

      if (response.content) {
        await safeReply(interaction, {
          content: response.content,
          components: [],
        }).catch(() => {});
        return;
      }

      await safeReply(interaction, {
        components: response.components,
        flags: buildComponentsV2EditFlags(),
      }).catch(() => {});
      return;
    }

    const overview = await UserGameCollection.getOverviewForUser(parsed.targetUserId);
    const platformEntry = overview.platformCounts
      .find((entry) => entry.platformId === selection.platformId) ?? null;
    const platformLabel = platformEntry
      ? buildPlatformLabel(platformEntry)
      : `Platform #${selection.platformId}`;

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel,
      title: undefined,
      platform: undefined,
      platformId: selection.platformId,
      platformLabel,
      ownershipType: undefined,
      page: 0,
      isEphemeral: parsed.isEphemeral,
    });

    if (response.content) {
      await safeReply(interaction, {
        content: response.content,
        components: [],
      }).catch(() => {});
      return;
    }

    await safeReply(interaction, {
      components: response.components,
      flags: buildComponentsV2EditFlags(),
    }).catch(() => {});
  }

  @ButtonComponent({
    id: /^collection-list-nav-v2:[^:]+:[^:]+:\d+:[ep]:(prev|next)$/,
  })
  async onCollectionListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionListNavId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This collection view control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await safeReply(interaction, {
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const nextPage = parsed.direction === "next"
      ? parsed.page + 1
      : Math.max(parsed.page - 1, 0);
    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);
    const debugContext = {
      interactionId: interaction.id,
      customId: interaction.customId,
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      currentPage: parsed.page,
      nextPage,
      direction: parsed.direction,
      isEphemeral: parsed.isEphemeral,
      currentFilters,
      messageId: interaction.message.id,
    };
    logNavDebug("nav_click", debugContext);

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel: "Member",
      title: currentFilters.title,
      platform: currentFilters.platform,
      platformId: currentFilters.platformId,
      platformLabel: currentFilters.platform,
      ownershipType: currentFilters.ownershipType,
      page: nextPage,
      isEphemeral: parsed.isEphemeral,
      debugSource: "nav",
    });

    if (response.content) {
      logNavDebug("nav_response_content_only", {
        ...debugContext,
        contentLength: response.content.length,
      });
      await safeUpdate(interaction, {
        content: response.content,
        components: [],
      });
      return;
    }

    try {
      await safeUpdate(interaction, {
        components: response.components,
        flags: buildComponentsV2Flags(parsed.isEphemeral),
      });
      logNavDebug("nav_update_success", debugContext);
    } catch (error) {
      console.error(
        "[CollectionListNavDebug] nav_update_failed",
        JSON.stringify({
          ...debugContext,
          messages: flattenErrorMessages(error),
        }),
      );
      throw error;
    }
  }

  @ButtonComponent({
    id: /^collection-list-filter-v1:[^:]+:[^:]+:[ep]:open$/,
  })
  async onCollectionFilterOpen(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterActionId(interaction.customId);
    if (!parsed || parsed.action !== "open") {
      await safeReply(interaction, {
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await safeReply(interaction, {
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    await safeReply(interaction, {
      content: buildCollectionFilterPanelContent({
        title: currentFilters.title,
        platform: currentFilters.platform,
        ownershipType: currentFilters.ownershipType,
      }),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: interaction.message.id,
        isEphemeral: parsed.isEphemeral,
        ownershipType: currentFilters.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  @ButtonComponent({
    id: /^clf1:[^:]+:[^:]+:[^:]+:[ep]:[toacx]$/,
  })
  async onCollectionFilterAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterPanelActionId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await safeReply(interaction, {
        content: "This filter control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (parsed.action === "cancel") {
      await closeFilterPanel(interaction);
      return;
    }

    const currentState = parseCollectionFilterStateFromContent(interaction.message.content ?? "");

    if (parsed.action === "text") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionFilterModalId({
            viewerUserId: parsed.viewerUserId,
            targetUserId: parsed.targetUserId,
            sourceMessageId: parsed.sourceMessageId,
            isEphemeral: parsed.isEphemeral,
            ownershipCode: buildOwnershipFilterCode(currentState.ownershipType),
          }),
        )
        .setTitle("Collection filters");

      const titleInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_TITLE_INPUT_ID)
        .setLabel("Title contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.title ?? "");
      const platformInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_PLATFORM_INPUT_ID)
        .setLabel("Platform contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.platform ?? "");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(platformInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    const nextState = parsed.action === "clear"
      ? {
        title: undefined,
        platform: undefined,
        ownershipType: undefined,
      }
      : parsed.action === "ownership"
        ? {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: nextOwnershipType(currentState.ownershipType),
        }
        : {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: currentState.ownershipType,
        };

    if (parsed.action === "apply") {
      await safeDeferUpdate(interaction);
      const applied = await applyFiltersToSourceMessage({
        interaction,
        sourceMessageId: parsed.sourceMessageId,
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        isEphemeral: parsed.isEphemeral,
        title: nextState.title,
        platform: nextState.platform,
        ownershipType: nextState.ownershipType,
      });
      await (interaction.message as any)?.delete?.().catch(() => {});
      if (!applied) {
        await safeReply(interaction, {
          content: "Could not update that collection message.",
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
        return;
      }
      return;
    }

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({
    id: /^clfm1:[^:]+:[^:]+:[^:]+:[ep]:[^:]+$/,
  })
  async onCollectionFilterTextModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionFilterModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This filter modal is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await safeReply(interaction, {
        content: "This filter modal is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const titleInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );
    const platformInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_PLATFORM_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );

    const nextState = {
      title: titleInput || undefined,
      platform: platformInput || undefined,
      ownershipType: parsed.ownershipType,
    };

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }
}

function buildPlatformLabel(entry: {
  platformName: string | null;
  platformAbbreviation: string | null;
}): string {
  const rawName = entry.platformName ?? entry.platformAbbreviation ?? "Unknown platform";
  if (!entry.platformAbbreviation || entry.platformAbbreviation === rawName) {
    return rawName;
  }
  return `${rawName} (${entry.platformAbbreviation})`;
}

function logNavDebug(event: string, details: Record<string, unknown>): void {
  console.log("[CollectionListNavDebug]", event, JSON.stringify(details));
}

export { buildCollectionListNavId };
