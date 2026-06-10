import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
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
  buildTextReply,
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
} from "../../functions/ComponentsV2Utils.js";
import { flattenErrorMessages } from "../imports/import-scaffold.service.js";
import { formatStructuredLog } from "../../utilities/LogUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
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
      name: "private",
      description: "Send reply privately (only visible to you).",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = privateFlag ?? false;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    const targetUserId = member?.id ?? interaction.user.id;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;
    const platformFilter = platform
      ? sanitizeUserInput(platform, { preserveNewlines: false })
      : undefined;

    const memberLabel = resolveMemberLabel(member, interaction.user);
    let response: Awaited<ReturnType<typeof buildCollectionListResponse>>;
    try {
      const timeoutMs = 20_000;
      response = await Promise.race([
        buildCollectionListResponse({
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
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`collection list timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (err) {
      console.error(formatStructuredLog({
        context: "collection list",
        event: "build_response_failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      await safeReply(
        interaction,
        buildTextReply("Failed to load your collection. Please try again.", isEphemeral),
      );
      return;
    }

    console.log("[collection list] step: sending reply", {
      hasContent: Boolean(response.content),
      componentCount: response.components?.length,
    });
    try {
      if (response.content) {
        await safeReply(interaction, buildTextReply(response.content, isEphemeral));
        return;
      }
      await safeReply(interaction, {
        components: response.components,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err) {
      console.error(formatStructuredLog({
        context: "collection list",
        event: "safe_reply_failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      try {
        await safeReply(
          interaction,
          buildTextReply("Failed to display collection. Please try again.", isEphemeral),
        );
      } catch (fallbackErr) {
        console.error(formatStructuredLog({
          context: "collection list",
          event: "fallback_safe_reply_failed",
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        }));
      }
    }
    console.log("[collection list] step: reply sent");
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
      name: "private",
      description: "Send reply privately (only visible to you).",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = privateFlag ?? false;
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
      safeIgnore(safeReply(interaction, buildTextReply("This collection overview control is invalid.", true)));
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      safeIgnore(safeReply(interaction, buildTextReply("This collection overview is not for you.", true)));
      return;
    }

    const selection = parseCollectionOverviewSelectValue(interaction.values?.[0] ?? "");
    if (!selection) {
      safeIgnore(safeReply(interaction, buildTextReply("That collection selection is invalid.", true)));
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

      safeIgnore(safeReply(interaction, {
        components,
        flags: buildComponentsV2EditFlags(),
      }));
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
        safeIgnore(safeReply(interaction, {
          content: response.content,
          components: [],
        }));
        return;
      }

      safeIgnore(safeReply(interaction, {
        components: response.components,
        flags: buildComponentsV2EditFlags(),
      }));
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
      safeIgnore(safeReply(interaction, {
        content: response.content,
        components: [],
      }));
      return;
    }

    safeIgnore(safeReply(interaction, {
      components: response.components,
      flags: buildComponentsV2EditFlags(),
    }));
  }

  @ButtonComponent({
    id: /^collection-list-nav-v2:[^:]+:[^:]+:\d+:[ep]:(prev|next)$/,
  })
  async onCollectionListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionListNavId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This collection view control is invalid.", true)));
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      safeIgnore(safeReply(interaction, buildTextReply("This collection view is not for you.", true)));
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
      safeIgnore(safeReply(interaction, buildTextReply("This filter control is invalid.", true)));
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      safeIgnore(safeReply(interaction, buildTextReply("This collection view is not for you.", true)));
      return;
    }

    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    const filterPanelReply = buildTextReply(
      buildCollectionFilterPanelContent({
        title: currentFilters.title,
        platform: currentFilters.platform,
        ownershipType: currentFilters.ownershipType,
      }),
      true,
    );
    safeIgnore(safeReply(interaction, {
      ...filterPanelReply,
      components: [
        ...filterPanelReply.components,
        ...buildCollectionFilterPanelComponents({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: interaction.message.id,
          isEphemeral: parsed.isEphemeral,
          ownershipType: currentFilters.ownershipType,
        }),
      ],
    }));
  }

  @ButtonComponent({
    id: /^clf1:[^:]+:[^:]+:[^:]+:[ep]:[toacx]$/,
  })
  async onCollectionFilterAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterPanelActionId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter control is invalid.", true)));
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter control is not for you.", true)));
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
      safeIgnore(interaction.showModal(modal));
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
      safeIgnore((interaction.message as any)?.delete?.() ?? Promise.resolve());
      if (!applied) {
        await safeReply(interaction, { ...buildTextReply("Could not update that collection message.", true), __forceFollowUp: true });
        return;
      }
      return;
    }

    const filterUpdateReply = buildTextReply(buildCollectionFilterPanelContent(nextState), true);
    await safeUpdate(interaction, {
      ...filterUpdateReply,
      components: [
        ...filterUpdateReply.components,
        ...buildCollectionFilterPanelComponents({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: parsed.sourceMessageId,
          isEphemeral: parsed.isEphemeral,
          ownershipType: nextState.ownershipType,
        }),
      ],
    });
  }

  @ModalComponent({
    id: /^clfm1:[^:]+:[^:]+:[^:]+:[ep]:[^:]+$/,
  })
  async onCollectionFilterTextModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionFilterModalId(interaction.customId);
    if (!parsed) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter modal is invalid.", true)));
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      safeIgnore(safeReply(interaction, buildTextReply("This filter modal is not for you.", true)));
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

    const modalFilterUpdateReply = buildTextReply(
      buildCollectionFilterPanelContent(nextState),
      true,
    );
    await safeUpdate(interaction, {
      ...modalFilterUpdateReply,
      components: [
        ...modalFilterUpdateReply.components,
        ...buildCollectionFilterPanelComponents({
          viewerUserId: parsed.viewerUserId,
          targetUserId: parsed.targetUserId,
          sourceMessageId: parsed.sourceMessageId,
          isEphemeral: parsed.isEphemeral,
          ownershipType: nextState.ownershipType,
        }),
      ],
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
