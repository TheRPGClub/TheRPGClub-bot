import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  AttachmentBuilder,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  MessageFlags,
} from "discord.js";
import {
  ButtonBuilder as V2ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import Game, { type IGameWithPlatforms, type IPlatformDef } from "../../classes/Game.js";
import Member, { type ICompletionRecord } from "../../classes/Member.js";
import type {
  CompletionatorAddFormState,
  CompletionatorThreadContext,
  ICompletionatorImport,
  ICompletionatorItem,
  CompletionatorModalKind,
  CompletionatorDateChoice,
  IgdbSelectOption,
} from "./completion.types.js";
import { COMPLETION_TYPES } from "../profile.command.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { formatTableDate } from "../../functions/DateFormatUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { COMPLETIONATOR_MATCH_THUMBNAIL_NAME } from "./completion.types.js";
import { isInteractionSettled, safeReply, safeUpdate } from "../../functions/InteractionUtils.js";
import { createIgdbSession } from "../../services/IGDB/IgdbSelectService.js";
import {
  buildImportMessageContainer,
  buildImportTextContainer,
} from "../imports/import-scaffold.service.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { buildCompletionatorChooseId } from "./completion-helpers.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputRow,
} from "../../functions/uiComponents.js";
import {
  DISCORD_AUTOCOMPLETE_DESC_MAX,
  DISCORD_SELECT_LABEL_MAX,
} from "../../config/textLimits.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";

export class CompletionatorUiService {
  buildCompletionatorBaseLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): string[] {
    const platformLabel = formatPlatformDisplayName(item.platformName) ?? "Unknown";
    const completedLabel = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return [
      `## Completionator Import #${session.importId}`,
      `Row ${item.rowIndex}/${session.totalCount}`,
      "",
      `**Title:** ${item.gameTitle}`,
      `**Platform:** ${platformLabel}`,
      `**Region:** ${item.regionName ?? "Unknown"}`,
      `**Type:** ${item.sourceType ?? "Unknown"}`,
      `**Playtime:** ${item.timeText ?? "Unknown"}`,
      `**Completed:** ${completedLabel}`,
    ];
  }

  buildCompletionatorHeaderContainer(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    thumbnailName?: string,
  ): ContainerBuilder {
    const content = this.buildCompletionatorBaseLines(session, item).join("\n").trim();
    const thumbnailUrl = thumbnailName ? `attachment://${thumbnailName}` : null;
    return buildImportMessageContainer({
      content,
      thumbnailUrl,
      logPrefix: "Completionator",
      logMeta: {
        importId: session.importId,
        itemId: item.itemId,
        rowIndex: item.rowIndex,
      },
    });
  }

  buildCompletionatorActionsContainer(
    helpText: string,
    rows: ActionRowBuilder<any>[] = [],
  ): ContainerBuilder {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Actions"),
      new TextDisplayBuilder().setContent(safeV2TextContent(helpText, 900)),
    );
    rows.forEach((row) => {
      container.addActionRowComponents(row.toJSON());
    });
    return container;
  }

  buildCompletionatorCandidatesContainer(params: {
    ownerId: string;
    importId: number;
    itemId: number;
    results: Array<IGameWithPlatforms>;
    guidanceText?: string | null;
  }): ContainerBuilder {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### GameDB Match Candidates"),
      ...(params.guidanceText
        ? [new TextDisplayBuilder().setContent(safeV2TextContent(params.guidanceText, 1000))]
        : []),
    );

    if (!params.results.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No GameDB matches found yet."),
      );
      return container;
    }

    params.results.slice(0, 5).forEach((game) => {
      const year = game.initialReleaseDate instanceof Date
        ? String(game.initialReleaseDate.getFullYear())
        : game.initialReleaseDate
          ? String(new Date(game.initialReleaseDate).getFullYear())
          : "TBD";
      const platformNames = Array.from(
        new Set(
          (game.platforms ?? [])
            .map((platform: IPlatformDef) => {
              const formatted = formatPlatformDisplayName(platform.name) ?? platform.name;
              return formatted;
            })
            .filter((name: string | null) => Boolean(name)),
        ),
      );
      const platformsLabel = platformNames.length
        ? platformNames
          .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
          .join(", ")
        : "Unknown platforms";
      const sectionText = safeV2TextContent(
        `**${game.title}**\n` +
        `-# **Release Year:** ${year} | **Platforms:** ${platformsLabel} | ` +
        `**GameDB ID:** ${game.id}`,
        900,
      );
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(sectionText, 900)),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
           
          .setCustomId(buildCompletionatorChooseId({
            ownerId: params.ownerId,
            importId: params.importId,
            itemId: params.itemId,
            gameId: game.id,
          }))
          .setLabel("Choose")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });

    return container;
  }

  buildCompletionatorIgdbContainer(params: {
    searchTitle: string;
    igdbRows: ActionRowBuilder<any>[];
    noResultsText: string | null;
  }): ContainerBuilder {
    const igdbSearchUrl = `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${
      encodeURIComponent(params.searchTitle)
    }`;
    const igdbLink = `[Search IGDB for ${params.searchTitle}](${igdbSearchUrl})`;
    const container = buildTextContainer("### Import Game From IGDB");
    for (const row of params.igdbRows) {
      container.addActionRowComponents(row.toJSON());
    }
    if (params.noResultsText) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(params.noResultsText, 1000)),
      );
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(
          `Not seeing the right title? ${igdbLink}, find the **IGDB ID** and enter it below.`,
          1000,
        ),
      ),
    );
    return container;
  }

  buildCompletionatorIgdbSelectRows(
    userId: string,
    igdbResults: any[],
    onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>,
  ): ActionRowBuilder<any>[] {
    const opts: IgdbSelectOption[] = igdbResults.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX),
      };
    });

    const { components } = createIgdbSession(userId, opts, onSelect);
    return components;
  }

  buildCompletionatorComponents(params: {
    session?: ICompletionatorImport;
    item?: ICompletionatorItem;
    headerLines?: string[];
    headerThumbnailName?: string;
    actionText?: string;
    actionRows?: ActionRowBuilder<any>[];
    extraContainers?: ContainerBuilder[];
  }): Array<ContainerBuilder | ActionRowBuilder<any>> {
    const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];

    if (params.session && params.item) {
      components.push(this.buildCompletionatorHeaderContainer(
        params.session,
        params.item,
        params.headerThumbnailName,
      ));
    } else if (params.headerLines?.length) {
      components.push(buildImportTextContainer(params.headerLines.join("\n").trim()));
    }

    if (params.extraContainers?.length) {
      components.push(...params.extraContainers);
    }

    if (params.actionText || params.actionRows?.length) {
      components.push(
        this.buildCompletionatorActionsContainer(
          params.actionText ?? "Use the controls below to continue.",
          params.actionRows ?? [],
        ),
      );
    }

    return components;
  }

  buildCompletionatorWorkingComponents(): Array<ContainerBuilder> {
    return [buildImportTextContainer("Working...")];
  }

  async buildCompletionatorExistingCompletionsContainer(
    userId: string,
    gameId: number,
    mappedType: string,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): Promise<{
    container: ContainerBuilder;
    files: AttachmentBuilder[];
    changeRow: ActionRowBuilder<ButtonBuilder>;
  }> {
    const game = await Game.getGameById(gameId);
    const completions = await Member.getCompletionsForGame(userId, gameId);
    const gamePlatforms = await Game.getPlatformsForGame(gameId);
    const platforms = await Game.getAllPlatforms();
    const platformMap = 
      new Map(platforms.map((platform: IPlatformDef) => [platform.id, platform.name]));
    const formattedPlatforms = gamePlatforms
      .map((platform: IPlatformDef) => formatPlatformDisplayName(platform.name) ?? platform.name)
      .sort((a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }));
    const platformLine = formattedPlatforms.length
      ? `**Platforms:** ${formattedPlatforms.join(", ")}`
      : "**Platforms:** None listed";

    const gameIdLine = game ? `**GameDB ID:** ${game.id}` : "**GameDB ID:** Unknown";
    const lines: string[] = [
      "## Matched Game",
      game ? `**Title:** ${game.title}` : "**Title:** Unknown",
      gameIdLine,
      `**Mapped Type:** ${mappedType}`,
      platformLine,
      "",
      "## Your Existing Completions",
    ];
    if (!completions.length) {
      lines.push("No completions recorded for this game yet.");
    } else {
      completions.forEach((completion: ICompletionRecord) => {
        const dateLabel = completion.completedAt
          ? formatTableDate(completion.completedAt)
          : "Unknown";
        const playtimeLabel = completion.finalPlaytimeHours
          ? `${completion.finalPlaytimeHours} hrs`
          : "Unknown";
        const platformName = completion.platformId
          ? platformMap.get(completion.platformId) ?? "Unknown Platform"
          : "Unknown Platform";
        const formattedPlatform = formatPlatformDisplayName(platformName) ?? platformName;
        const parts = [
          completion.completionType ?? "Unknown",
          dateLabel,
          playtimeLabel,
          formattedPlatform,
        ].filter(Boolean);
        lines.push(`• ${parts.join(" - ")}`);
      });
    }
    lines.push(
      "",
      "If this completion is not listed above, complete the form below.",
      "Select a completion type, choose a date option, select a platform, then add the completion.",
    );

    const files: AttachmentBuilder[] = [];
    if (game) {
      const primaryArt = game.imageData;
      if (primaryArt) {
        const { AttachmentBuilder } = await import("discord.js");
        files.push(
          new AttachmentBuilder(primaryArt, { name: COMPLETIONATOR_MATCH_THUMBNAIL_NAME }),
        );
      }
    }
    const thumbnailName = files.length ? COMPLETIONATOR_MATCH_THUMBNAIL_NAME : undefined;
    const container = buildImportMessageContainer({
      content: lines.join("\n").trim(),
      thumbnailUrl: thumbnailName ? `attachment://${thumbnailName}` : null,
      logPrefix: "Completionator",
      logMeta: {
        importId: session.importId,
        itemId: item.itemId,
        rowIndex: item.rowIndex,
      },
    });
     
    const changeButton = buildActionButton({
      customId: `comp-import-action:${userId}:${session.importId}:${item.itemId}:igdb`,
      label: "Choose a Different Game",
      style: ButtonStyle.Secondary,
    });
    const changeRow = buildButtonRow(changeButton);
    return { container, files, changeRow };
  }

  buildCompletionatorAddFormRows(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
    platforms: Array<{ id: number; name: string }>,
  ): ActionRowBuilder<any>[] {
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(
        // eslint-disable-next-line local/custom-id-has-matching-handler
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:type`,
      )
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((value: string) => ({
          label: value.slice(0, DISCORD_SELECT_LABEL_MAX),
          value,
          default: state.completionType === value,
        })),
      );

    const dateOptions: Array<{
      label: string;
      value: CompletionatorDateChoice;
      default?: boolean;
    }> = [];
    if (item.completedAt) {
      dateOptions.push({
        label: `Use CSV date (${formatTableDate(item.completedAt)})`,
        value: "csv",
        default: state.dateChoice === "csv",
      });
    }
    dateOptions.push(
      {
        label: "Today",
        value: "today",
        default: state.dateChoice === "today",
      },
      {
        label: "Unknown date",
        value: "unknown",
        default: state.dateChoice === "unknown",
      },
      {
        label: "Enter date",
        value: "date",
        default: state.dateChoice === "date",
      },
    );

    const dateSelect = new StringSelectMenuBuilder()
      .setCustomId(
        // eslint-disable-next-line local/custom-id-has-matching-handler
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:date`,
      )
      .setPlaceholder("Completion date")
      .addOptions(dateOptions);

    const sortedPlatforms = [...platforms].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    const platformOptions = sortedPlatforms.map((platform) => ({
      label: platform.name.slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(platform.id),
      default: state.platformId === platform.id,
    }));
    const options = [
      ...platformOptions.slice(0, 24),
      { label: "Other", value: "other", default: state.otherPlatform },
    ];
    const platformSelect = new StringSelectMenuBuilder()
      .setCustomId(
        // eslint-disable-next-line local/custom-id-has-matching-handler
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:platform`,
      )
      .setPlaceholder("Platform")
      .addOptions(options);
     
    const addButton = buildActionButton(
      "add",
      `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:add`,
      "Add Completion",
    );
     
    const skipButton = buildActionButton({
      customId: `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:skip`,
      label: "Skip",
      style: ButtonStyle.Secondary,
    });
     
    const pauseButton = buildActionButton({
      customId: `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:pause`,
      label: "Pause",
      style: ButtonStyle.Secondary,
    });

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(platformSelect),
      buildButtonRow(addButton, skipButton, pauseButton),
    ];
  }

  buildConfirmSameButtons(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder> {
    return buildButtonRow(
      buildActionButton(
        "confirm",
         
        `comp-import-action:${userId}:${importId}:${itemId}:same-yes`,
        "Yes",
      ),
      buildActionButton(
        "cancel",
         
        `comp-import-action:${userId}:${importId}:${itemId}:same-no`,
        "No",
      ),
    );
  }

  buildUpdateSelectionComponents(
    userId: string,
    importId: number,
    itemId: number,
    updateOptions: Array<{ label: string; value: string; description: string }>,
  ): {
    updateRow: ActionRowBuilder<StringSelectMenuBuilder>;
    buttonsRow: ActionRowBuilder<ButtonBuilder>;
  } {
    const updateSelect = new StringSelectMenuBuilder()
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`comp-import-update-fields:${userId}:${importId}:${itemId}`)
      .setPlaceholder("Select fields to update")
      .setMinValues(1)
      .setMaxValues(updateOptions.length)
      .addOptions(updateOptions);
     
    const skipBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:skip`,
      label: "Skip",
      style: ButtonStyle.Secondary,
    });
     
    const pauseBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:pause`,
      label: "Pause",
      style: ButtonStyle.Secondary,
    });
    const buttons = buildButtonRow(skipBtn, pauseBtn);

    return {
      updateRow: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(updateSelect),
      buttonsRow: buttons,
    };
  }

  buildCompletionatorNoMatchRows(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder>[] {
     
    const igdbManualBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:igdb-manual`,
      label: "Enter IGDB ID",
      style: ButtonStyle.Primary,
    });
     
    const queryBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:query`,
      label: "Query GameDB",
      style: ButtonStyle.Primary,
    });
     
    const manualBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:manual`,
      label: "Enter GameDB ID",
      style: ButtonStyle.Primary,
    });
    const primaryRow = buildButtonRow(igdbManualBtn, queryBtn, manualBtn);
     
    const noMatchSkipBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:skip`,
      label: "Skip",
      style: ButtonStyle.Secondary,
    });
     
    const noMatchPauseBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:pause`,
      label: "Pause",
      style: ButtonStyle.Secondary,
    });
    const secondaryRow = buildButtonRow(noMatchSkipBtn, noMatchPauseBtn);
    return [primaryRow, secondaryRow];
  }

  buildIgdbSelectionComponents(
    userId: string,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    igdbResults: any[],
    onSelect: (interaction: StringSelectMenuInteraction, gameId: number) => Promise<void>,
  ): {
    selectComponents: ActionRowBuilder<any>[];
    extraRows: ActionRowBuilder<ButtonBuilder>[];
  } {
    const opts: IgdbSelectOption[] = igdbResults.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").slice(0, DISCORD_AUTOCOMPLETE_DESC_MAX),
      };
    });
     
    const pauseButton = buildActionButton({
      customId: `comp-import-action:${userId}:${session.importId}:${item.itemId}:pause`,
      label: "Pause",
      style: ButtonStyle.Secondary,
    });
     
    const skipButton = buildActionButton({
      customId: `comp-import-action:${userId}:${session.importId}:${item.itemId}:skip`,
      label: "Skip",
      style: ButtonStyle.Secondary,
    });
     
    const queryButton = buildActionButton({
      customId: `comp-import-action:${userId}:${session.importId}:${item.itemId}:igdb-query`,
      label: "New IGDB Search",
      style: ButtonStyle.Secondary,
    });
    const extraRows = [
      buildButtonRow(pauseButton, skipButton, queryButton),
    ];

    const { components } = createIgdbSession(userId, opts, onSelect, extraRows);

    return {
      selectComponents: components,
      extraRows: [],
    };
  }

  buildIgdbRetryButtons(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder> {
     
    const igdbQueryBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:igdb-query`,
      label: "New IGDB Search",
      style: ButtonStyle.Secondary,
    });
     
    const retrySkipBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:skip`,
      label: "Skip",
      style: ButtonStyle.Secondary,
    });
     
    const retryPauseBtn = buildActionButton({
      customId: `comp-import-action:${userId}:${importId}:${itemId}:pause`,
      label: "Pause",
      style: ButtonStyle.Secondary,
    });
    return buildButtonRow(igdbQueryBtn, retrySkipBtn, retryPauseBtn);
  }

  resolvePlatformId(
    platformName: string,
    platforms: Array<{ id: number; name: string }>,
  ): number | null {
    const platformKey = platformName.trim().toLowerCase();
    const mappedNames = GAMEDB_CSV_PLATFORM_MAP[platformKey] ?? [];
    if (!mappedNames.length) return null;

    const platformByName = new Map(
      platforms.map((platform) => [platform.name.toLowerCase(), platform.id]),
    );
    return (
      mappedNames
        .map((name: string) => platformByName.get(name.toLowerCase()))
        .find((id: number | undefined): id is number => Boolean(id)) ?? null
    );
  }

  async respondToImportInteraction(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    payload: {
      components: Array<ContainerBuilder | ActionRowBuilder<any>>;
      files?: any[];
    },
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const flags = buildComponentsV2Flags(Boolean(ephemeral));
    const files = payload.files ?? [];
    if (context?.message) {
      safeIgnore(context.message.edit({ ...payload, files, flags }));
      return;
    }

    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      if (isInteractionSettled(interaction)) {
        await safeReply(interaction, { ...payload, files, flags });
      } else {
        await safeUpdate(interaction, { ...payload, files, flags });
      }
      return;
    }

    await safeReply(interaction, {
      ...payload,
      files,
      flags,
    });
  }

  isInteractionEphemeral(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ): boolean {
    const message = "message" in interaction ? interaction.message : null;
    const flags = message?.flags;
    return Boolean(flags && flags.has(MessageFlags.Ephemeral));
  }

  createDateModal(
    userId: string,
    importId: number,
    itemId: number,
  ): ModalBuilder {
    const modal = new ModalBuilder()
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`comp-import-date:${userId}:${importId}:${itemId}`)
      .setTitle("Completion Date");
    modal.addComponents(buildTextInputRow({
      customId: "completion-date",
      label: "Completion date (YYYY-MM-DD)",
      placeholder: "2025-12-31",
    }));
    return modal;
  }

  createInputModal(
    kind: CompletionatorModalKind,
    title: string,
    label: string,
    placeholder: string,
    userId: string,
    importId: number,
    itemId: number,
    itemTitle?: string,
  ): ModalBuilder {
    const modal = new ModalBuilder()
      // eslint-disable-next-line local/custom-id-has-matching-handler
      .setCustomId(`comp-import-modal:${kind}:${userId}:${importId}:${itemId}`)
      .setTitle(title);
    modal.addComponents(buildTextInputRow({
      customId: "completionator-input",
      label: label.slice(0, 45),
      placeholder: (itemTitle ?? placeholder).slice(0, DISCORD_SELECT_LABEL_MAX),
    }));
    return modal;
  }
}
