import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  InteractionReplyOptions,
  MessageFlags,
  ModalSubmitInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputStyle,
  channelMention,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  PRIVATE_OPTION_DESCRIPTION,
  replyIfNotOwner,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { decodeBase64Url, encodeWithMaxLength } from "../functions/CustomIdUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { ContainerBuilder } from "@discordjs/builders";
import {
  performAutoAcceptImages,
  performAutoAcceptReleaseData,
  performAutoAcceptVideos,
  performAutoAcceptDescriptions,
  performAutoAcceptAll,
  type AutoAcceptResult,
  type AllAcceptStats,
} from "../services/GamedbAuditService.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import Game, { IGame } from "../classes/Game.js";
import GameSearchSynonym from "../classes/GameSearchSynonym.js";
import GameSearchSynonymDraft, {
  type ISynonymDraftPair,
} from "../classes/GameSearchSynonymDraft.js";
import axios from "axios";
import { igdbService } from "../services/IGDB/IgdbService.js";
import { buildPageFooterText, shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import { buildActionButton, buildButtonRow, buildTextInputRow } from "../functions/uiComponents.js";
import { parseSynonymQuickAddTerms } from "./gamedb-synonym.utils.js";
import { isPositiveInt, truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { COLOR_PRIMARY, COLOR_SUCCESS, COLOR_HIGHLIGHT } from "../config/colors.js";
import { AUDIT_PAGE_SIZE, SYNONYM_LIST_PAGE_SIZE } from "../config/pagination.js";
import { assertCustomIdSegments, parseCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";

const AUDIT_VIDEO_MODAL_ID = "audit-video-modal";
const AUDIT_VIDEO_INPUT_ID = "audit-video-url";
const AUDIT_DESCRIPTION_MODAL_ID = "audit-description-modal";
const AUDIT_DESCRIPTION_INPUT_ID = "audit-description";
const AUDIT_AUTO_STOP_PREFIX = "audit-auto-stop";
const SYNONYM_ADD_MODAL_PREFIX = "gamedb-syn-add";
const SYNONYM_ADD_MORE_PREFIX = "gamedb-syn-more";
const SYNONYM_ADD_DONE_PREFIX = "gamedb-syn-done";
const SYNONYM_ADD_BULK_INPUT_ID = "gamedb-syn-bulk";
const SYNONYM_LIST_PAGE_PREFIX = "gamedb-syn-page";
const SYNONYM_EDIT_GROUP_SELECT_PREFIX = "gamedb-syn-edit-group";
const SYNONYM_EDIT_GROUP_MODAL_PREFIX = "gamedb-syn-edit-group-modal";
const SYNONYM_EDIT_GROUP_INPUT_ID = "gamedb-syn-edit-group-input";
const SYNONYM_DELETE_GROUP_SELECT_PREFIX = "gamedb-syn-delete-group";
const SYNONYM_ADD_FROM_LIST_PREFIX = "gamedb-syn-add-from-list";
const MAX_COMPONENT_CUSTOM_ID_LENGTH = 100;

function encodeSynonymQuery(query: string, maxLength: number): string {
  return encodeWithMaxLength(query.trim(), maxLength);
}

function decodeSynonymQuery(encoded: string): string {
  return decodeBase64Url(encoded);
}

function clampSynonymOptionText(value: string, maxLength = 100): string {
  return truncateWithEllipsis(value, maxLength);
}

function buildSynonymGroupEditModal(ownerId: string, groupId: number, terms: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SYNONYM_EDIT_GROUP_MODAL_PREFIX}:${ownerId}:${groupId}`)
    .setTitle("Edit Search Synonym Group")
    .addComponents(buildTextInputRow({
      customId: SYNONYM_EDIT_GROUP_INPUT_ID,
      label: "Synonym terms, one per line",
      style: TextInputStyle.Paragraph,
      maxLength: 2000,
      value: terms,
    }));
}

function buildSynonymListCustomId(
  ownerId: string,
  page: number,
  query: string,
  direction?: "next" | "prev",
): string {
  const base = `${SYNONYM_LIST_PAGE_PREFIX}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length - (direction ? `:${direction}`.length : 0);
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return direction
    ? `${base}${encodedQuery}:${direction}`
    : `${base}${encodedQuery}`;
}

function buildSynonymGroupSelectCustomId(
  prefix: string,
  ownerId: string,
  page: number,
  query: string,
): string {
  const base = `${prefix}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length;
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return `${base}${encodedQuery}`;
}
const AUDIT_SESSIONS = new Map<
  string,
  {
    userId: string;
    games: IGame[];
    page: number;
    filter: "all" | "image" | "video" | "description" | "release" | "mixed" | "complete";
  }
>();

function parseSynonymPairs(
  rawInput: string,
  maxPairs: number,
): ISynonymDraftPair[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs: ISynonymDraftPair[] = [];
  const separators = ["<-->", "<->", "=>", "->", "|", ","];
  for (const line of lines) {
    let separator: string | null = null;
    for (const candidate of separators) {
      if (line.includes(candidate)) {
        separator = candidate;
        break;
      }
    }
    if (!separator) continue;
    const [left, right] = line.split(separator).map((part) => part.trim());
    if (!left || !right) continue;
    pairs.push({ term: left, match: right });
    if (pairs.length >= maxPairs) break;
  }
  return pairs;
}

function buildSynonymAddModal(draftId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SYNONYM_ADD_MODAL_PREFIX}:${draftId}`)
    .setTitle("Add GameDB Search Synonyms")
    .addComponents(buildTextInputRow({
      customId: SYNONYM_ADD_BULK_INPUT_ID,
      label: "Synonym pairs, one per line",
      style: TextInputStyle.Paragraph,
      placeholder: "GTA <-> Grand Theft Auto\nKH <-> Kingdom Hearts\n1 <-> one",
      maxLength: 2000,
    }));
}

function buildSynonymContinueComponents(draftId: number): Array<ActionRowBuilder<ButtonBuilder>> {
  const addMore = buildActionButton({ customId: `${SYNONYM_ADD_MORE_PREFIX}:${draftId}`, label: "Add More", style: ButtonStyle.Primary });
  const done = buildActionButton({ customId: `${SYNONYM_ADD_DONE_PREFIX}:${draftId}`, label: "Done", style: ButtonStyle.Secondary });
  return [buildButtonRow(addMore, done)];
}
const AUTO_ACCEPT_RUNS = new Map<
  string,
  {
    canceled: boolean;
    ownerId: string | null;
  }
>();

function parseGameIdList(raw: string): number[] {
  const matches = raw.split(/[^0-9]+/).filter(Boolean);
  const ids = matches.map((part) => Number(part)).filter(isPositiveInt);
  return Array.from(new Set(ids));
}

function buildAutoAcceptStopId(runId: string): string {
  return `${AUDIT_AUTO_STOP_PREFIX}:${runId}`;
}

function parseAutoAcceptStopId(id: string): string | null {
  if (!id.startsWith(`${AUDIT_AUTO_STOP_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(id, 1);
  if (!segs) return null;
  return segs[0] || null;
}

function buildAutoAcceptFollowUpPayload(
  embeds: EmbedBuilder[],
  components: ActionRowBuilder<ButtonBuilder>[],
  isPublic: boolean,
): InteractionReplyOptions {
  return {
    embeds,
    // eslint-disable-next-line local/dynamic-components-require-chunking
    components,
    ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
  };
}

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDbAdmin {
  private async buildSynonymListPayload(
    ownerId: string,
    query: string,
    page: number,
    isPublic: boolean,
  ): Promise<{
    components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    >;
    flags: number;
  }> {
    const totalCount = await GameSearchSynonym.countSynonymGroups(query || undefined);
    const totalPages = Math.max(1, Math.ceil(totalCount / SYNONYM_LIST_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * SYNONYM_LIST_PAGE_SIZE;

    const terms = await GameSearchSynonym.listSynonymGroups({
      query: query || undefined,
      limit: SYNONYM_LIST_PAGE_SIZE,
      offset,
    });

    const grouped = new Map<number, typeof terms>();
    terms.forEach((term) => {
      const list = grouped.get(term.groupId) ?? [];
      list.push(term);
      grouped.set(term.groupId, list);
    });

    const groupEntries = Array.from(grouped.entries());
    const groupLines = groupEntries.map(([, groupTerms], index) => {
      const termList = groupTerms.map((term) => `"${term.termText}"`);
      const arrowLine = termList.length > 1
        ? termList.join(" ➜ ")
        : termList.join("");
      return `${offset + index + 1}. ${arrowLine}`;
    });

    const titleLine = query
      ? `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})\nQuery: ${query}`
      : `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})`;
    const content = groupLines.length
      ? `${titleLine}\n\n${groupLines.join("\n")}`
      : `${titleLine}\n\nNo search synonyms found.`;

    const container = buildTextContainer(safeV2TextContent(content, 3500));

    const prevDisabled = safePage === 0;
    const nextDisabled = safePage >= totalPages - 1;
    const prevButton = buildActionButton({
      customId: buildSynonymListCustomId(ownerId, safePage, query, "prev"),
      label: "Previous Page",
      style: ButtonStyle.Secondary,
    }).setDisabled(prevDisabled);
    const nextButton = buildActionButton({
      customId: buildSynonymListCustomId(ownerId, safePage, query, "next"),
      label: "Next Page",
      style: ButtonStyle.Secondary,
    }).setDisabled(nextDisabled);
    const addGroupButton = buildActionButton({
      customId: buildSynonymGroupSelectCustomId(
        SYNONYM_ADD_FROM_LIST_PREFIX,
        ownerId,
        safePage,
        query,
      ),
      label: "Add New Group",
      style: ButtonStyle.Primary,
    });
    const buttonRowItems: ButtonBuilder[] = [addGroupButton];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      buttonRowItems.push(prevButton, nextButton);
    }
    const buttonRow = buildButtonRow(...buttonRowItems);

    const components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    > = [container];

    if (groupEntries.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_EDIT_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to edit");
      const selectOptions = groupEntries.map(([groupId, groupTerms], index) => {
        const termList = groupTerms.map((term) => `"${term.termText}"`).join(" ↔ ");
        return {
          label: `Group ${offset + index + 1}`,
          value: String(groupId),
          description: clampSynonymOptionText(termList, 100),
        };
      });
      select.addOptions(selectOptions);
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

      const deleteSelect = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_DELETE_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to delete");
      deleteSelect.addOptions(selectOptions);
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(deleteSelect));
    }
    components.push(buttonRow);

    return {
      components,
      flags: buildComponentsV2Flags(!isPublic),
    };
  }
  @Slash({
    description: "Audit GameDB for missing images, videos, descriptions, or release data (Admin only)",
    name: "audit",
  })
  async audit(
    @SlashOption({
      description: "Filter for missing images",
      name: "missing_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingImages: boolean | undefined,
    @SlashOption({
      description: "Filter for missing featured videos",
      name: "missing_featured_video",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingFeaturedVideo: boolean | undefined,
    @SlashOption({
      description: "Filter for missing descriptions",
      name: "missing_descriptions",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingDescriptions: boolean | undefined,
    @SlashOption({
      description: "Filter for missing release data",
      name: "missing_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingReleaseData: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB images for all missing ones",
      name: "auto_accept_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptImages: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB featured videos for all missing ones",
      name: "auto_accept_videos",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptVideos: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB release data for all missing ones",
      name: "auto_accept_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptReleaseData: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB descriptions for all games missing one",
      name: "auto_accept_descriptions",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptDescriptions: boolean | undefined,
    @SlashOption({
      description: "Sweep all games missing any data and fill from IGDB in one pass",
      name: "auto_accept_all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptAll: boolean | undefined,
    @SlashOption({
      description: "Optional title query (matches any word)",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashOption({
      description: "Show only games with complete audit data",
      name: "show_complete_games",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showCompleteGames: boolean | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    const query = queryRaw
      ? sanitizeUserInput(queryRaw, { preserveNewlines: false })
      : "";
    const queryWords = query
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);

    if (autoAcceptAll) {
      await this.runAutoAcceptAll(interaction, isPublic, queryWords);
      return;
    }

    if (autoAcceptImages || autoAcceptVideos || autoAcceptReleaseData || autoAcceptDescriptions) {
      const multiOp = [
        autoAcceptImages,
        autoAcceptVideos,
        autoAcceptReleaseData,
        autoAcceptDescriptions,
      ].filter(Boolean).length > 1;
      if (autoAcceptImages) {
        await this.runAutoAcceptOperation(
          interaction, isPublic, multiOp, queryWords,
          "Auto-Accept IGDB Images", performAutoAcceptImages,
        );
      }
      if (autoAcceptVideos) {
        await this.runAutoAcceptOperation(
          interaction, isPublic, multiOp, queryWords,
          "Auto-Accept IGDB Videos", performAutoAcceptVideos,
        );
      }
      if (autoAcceptReleaseData) {
        await this.runAutoAcceptOperation(
          interaction, isPublic, multiOp, queryWords,
          "Auto-Accept IGDB Release Data", performAutoAcceptReleaseData,
        );
      }
      if (autoAcceptDescriptions) {
        await this.runAutoAcceptOperation(
          interaction, isPublic, multiOp, queryWords,
          "Auto-Accept IGDB Descriptions", performAutoAcceptDescriptions,
        );
      }
      return;
    }

    // Default to all if none specified, otherwise follow flags
    let checkImages = true;
    let checkFeaturedVideo = true;
    let checkDescriptions = true;
    let checkReleaseData = true;
    const useCompleteOnly = Boolean(showCompleteGames);

    if (
      missingImages !== undefined ||
      missingFeaturedVideo !== undefined ||
      missingDescriptions !== undefined ||
      missingReleaseData !== undefined
    ) {
      checkImages = !!missingImages;
      checkFeaturedVideo = !!missingFeaturedVideo;
      checkDescriptions = !!missingDescriptions;
      checkReleaseData = !!missingReleaseData;
    }

    if (
      !useCompleteOnly &&
      !checkImages &&
      !checkFeaturedVideo &&
      !checkDescriptions &&
      !checkReleaseData
    ) {
      await safeReply(interaction, buildTextReply(
        "You must check for at least one thing (images, videos, descriptions, or release data).",
        true,
      ));
      return;
    }

    const games = await Game.getGamesForAudit(
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
      queryWords,
      useCompleteOnly,
    );

    if (games.length === 0) {
      await safeReply(interaction, buildTextReply(
        "No games found matching the audit criteria! Great job.",
        !isPublic,
      ));
      return;
    }

    const sessionId = interaction.id;
    const filterLabel = this.buildAuditFilterLabel(
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
      useCompleteOnly,
    );

    AUDIT_SESSIONS.set(sessionId, {
      userId: interaction.user.id,
      games,
      page: 0,
      filter: filterLabel,
    });

    const response = await this.buildAuditListResponse(sessionId);
    await safeReply(interaction, {
      ...response,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Link alternate GameDB versions (Admin only)", name: "link-versions" })
  async linkVersions(
    @SlashOption({
      description: "Comma-separated GameDB ids to link together",
      name: "game_ids",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    gameIdsRaw: string,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    gameIdsRaw = sanitizeUserInput(gameIdsRaw, { preserveNewlines: false });
    const gameIds = parseGameIdList(gameIdsRaw);
    if (gameIds.length < 2) {
      await safeReply(interaction, buildTextReply(
        "Provide at least two valid GameDB ids to link.",
        true,
      ));
      return;
    }

    const games = await Game.getGamesByIds(gameIds);
    const foundIds = new Set(games.map((game) => game.id));
    const missingIds = gameIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      await safeReply(interaction, buildTextReply(
        `Missing GameDB id(s): ${missingIds.join(", ")}.`,
        true,
      ));
      return;
    }

    await Game.linkAlternateVersions(gameIds, interaction.user.id);
    const lines = games
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => `• **${game.title}** (GameDB #${game.id})`);
    const embed = new EmbedBuilder()
      .setTitle("Linked Alternate Versions")
      .setDescription(lines.join("\n"));

    await safeReply(interaction, {
      embeds: [embed],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^audit-page:[^:]+:(next|prev)$/ })
  async handleAuditPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, direction] = segs;

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const totalPages = Math.ceil(session.games.length / AUDIT_PAGE_SIZE);
    if (direction === "next" && session.page < totalPages - 1) {
      session.page++;
    } else if (direction === "prev" && session.page > 0) {
      session.page--;
    }

    const response = await this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @SelectMenuComponent({ id: /^audit-select:[^:]+$/ })
  async handleAuditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const gameId = Number(interaction.values[0]);
    const game = session.games.find((g) => g.id === gameId);

    if (!game) {
      await safeUpdate(interaction, buildTextReply("Game not found in session.", false));
      return;
    }

    const response = await this.buildAuditDetailResponse(sessionId, game);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-back:[^:]+$/ })
  async handleAuditBack(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [sessionId] = segs;
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }
    const response = await this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-next:[^:]+:\d+$/ })
  async handleAuditNext(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const currentIndex = session.games.findIndex((game) => game.id === gameId);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    if (nextIndex >= session.games.length) {
      const response = await this.buildAuditListResponse(sessionId);
      await safeUpdate(interaction, response);
      return;
    }

    const nextGame = session.games[nextIndex];
    const response = await this.buildAuditDetailResponse(sessionId, nextGame);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-accept-igdb:[^:]+:\d+$/ })
  async handleAuditAcceptIgdb(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, buildTextReply("Invalid game or missing IGDB ID.", true));
      return;
    }

    await safeReply(interaction, buildTextReply("Fetching image from IGDB...", true));

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details || !details.cover?.image_id) {
        await safeReply(interaction, buildTextReply("Failed to find cover image on IGDB.", true));
        return;
      }

      const imageUrl =
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const buffer = Buffer.from(resp.data);

      await Game.updateGameImage(gameId, buffer);

      // Update session data
      if (game) {
        game.imageData = buffer;
      }

      await safeReply(interaction, buildTextReply("IGDB Image accepted and saved!", true));

    } catch (err: any) {
      await safeReply(interaction, buildTextReply(
        `Error fetching IGDB image: ${err.message}`,
        true,
      ));
    }
  }

  @ButtonComponent({ id: /^audit-img:[^:]+:\d+$/ })
  async handleAuditImage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);
    
    // We need to use a collector in the channel to get the image
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeReply(interaction, buildTextReply(
      "Please upload an image (or paste a URL) for this game in the chat.",
      true,
    ));

    const channel = interaction.channel as any;
    if (!channel) return;

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => (
          m.author.id === interaction.user.id &&
          (m.attachments.size > 0 || m.content.length > 0)
        ),
        max: 1,
        time: 60000,
        errors: ["time"],
      });

      const msg = collected.first();
      if (!msg) return;

      let imageUrl = "";
      if (msg.attachments.size > 0) {
        imageUrl = msg.attachments.first()?.url ?? "";
      } else {
        imageUrl = msg.content.trim();
      }

      // Validate URL roughly
      if (!imageUrl.startsWith("http")) {
        await safeReply(interaction, buildTextReply("Invalid image URL/attachment.", true));
        return;
      }

      await safeReply(interaction, buildTextReply("Processing image...", true));

      try {
        const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(resp.data);

        await Game.updateGameImage(gameId, buffer);
        safeIgnore(msg.delete());

        // Update session data locally so UI reflects change if we go back/refresh
        const game = session.games.find(g => g.id === gameId);
        if (game) {
          game.imageData = buffer;
        }

        await safeReply(interaction, buildTextReply("Image updated successfully!", true));

        // Refresh detail view
        // We can't easily "edit" the previous interaction message from here without the
        // interaction object flow. The user can click "Back" or re-select to see changes.

      } catch (err: any) {
        await safeReply(interaction, buildTextReply(
          `Failed to update image: ${err.message}`,
          true,
        ));
      }

    } catch {
      await safeReply(interaction, buildTextReply("Timed out waiting for image.", true));
    }
  }

  @ButtonComponent({ id: /^audit-accept-video:[^:]+:\d+$/ })
  async handleAuditAcceptVideo(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, buildTextReply("Invalid game or missing IGDB ID.", true));
      return;
    }

    await safeDeferUpdate(interaction);

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      const videoUrl = details ? Game.getFeaturedVideoUrl(details) : null;
      if (!videoUrl) {
        await safeReply(interaction, buildTextReply("No featured video found on IGDB.", true));
        return;
      }

      await Game.updateFeaturedVideoUrl(gameId, videoUrl);
      game.featuredVideoUrl = videoUrl;
      if (session.filter === "video") {
        session.games = session.games.filter((entry) => entry.id !== gameId);
      }

      const refreshed = await Game.getGameById(gameId);
      if (refreshed) {
        const response = await this.buildAuditDetailResponse(sessionId, refreshed);
        await safeUpdate(interaction, response);
      }

      // no extra success message
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(
        `Error fetching featured video: ${err.message}`,
        true,
      ));
    }
  }

  @ButtonComponent({ id: /^audit-video:[^:]+:\d+$/ })
  async handleAuditVideo(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_VIDEO_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add YouTube Video")
      .addComponents(buildTextInputRow({
        customId: AUDIT_VIDEO_INPUT_ID,
        label: "YouTube URL",
        placeholder: "https://www.youtube.com/watch?v=...",
      }));

    safeIgnore(interaction.showModal(modal));
  }

  @ButtonComponent({ id: /^audit-description:[^:]+:\d+$/ })
  async handleAuditDescription(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_DESCRIPTION_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add Description")
      .addComponents(buildTextInputRow({
        customId: AUDIT_DESCRIPTION_INPUT_ID,
        label: "Description",
        style: TextInputStyle.Paragraph,
        maxLength: 2000,
      }));

    safeIgnore(interaction.showModal(modal));
  }

  @ModalComponent({ id: /^audit-video-modal:[^:]+:\d+$/ })
  async handleAuditVideoModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawUrl = interaction.fields.getTextInputValue(AUDIT_VIDEO_INPUT_ID);
    const videoUrl = sanitizeUserInput(rawUrl, { preserveNewlines: false });
    if (!videoUrl || !videoUrl.startsWith("http")) {
      await safeReply(interaction, buildTextReply("Please provide a valid YouTube URL.", true));
      return;
    }

    await Game.updateFeaturedVideoUrl(gameId, videoUrl);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.featuredVideoUrl = videoUrl;
    }
    if (session.filter === "video") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      safeIgnore(interaction.message.edit(response));
    }

    safeIgnore(interaction.deleteReply());
  }

  @ModalComponent({ id: /^audit-description-modal:[^:]+:\d+$/ })
  async handleAuditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, gameIdStr] = segs;
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawDescription = interaction.fields.getTextInputValue(AUDIT_DESCRIPTION_INPUT_ID);
    const description = sanitizeUserInput(rawDescription, { preserveNewlines: true });
    if (!description) {
      await safeReply(interaction, buildTextReply("Please provide a valid description.", true));
      return;
    }

    await Game.updateGameDescription(gameId, description);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.description = description;
    }
    if (session.filter === "description") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      safeIgnore(interaction.message.edit(response));
    }

    safeIgnore(interaction.deleteReply());
  }

  @ButtonComponent({ id: /^audit-auto-stop:[^:]+$/ })
  async stopAutoAccept(interaction: ButtonInteraction): Promise<void> {
    const runId = parseAutoAcceptStopId(interaction.customId);
    if (!runId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const run = AUTO_ACCEPT_RUNS.get(runId);
    if (!run) {
      await safeReply(interaction, buildTextReply(
        "This audit run has already finished.",
        true,
      ));
      return;
    }

    if (interaction.guild?.ownerId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply(
        "Only the server owner can stop this audit.",
        true,
      ));
      return;
    }

    run.canceled = true;
    AUTO_ACCEPT_RUNS.set(runId, run);

    const stopRow = this.buildAutoAcceptStopRow(runId, true, "Stopping...");
    await safeUpdate(interaction, {
      components: [stopRow],
    });
  }

  private buildAutoAcceptStopRow(
    runId: string,
    disabled: boolean,
    label: string = "Stop",
  ): ActionRowBuilder<ButtonBuilder> {
    return buildButtonRow(
      buildActionButton({
        customId: buildAutoAcceptStopId(runId),
        label,
        style: ButtonStyle.Danger,
      }).setDisabled(disabled),
    );
  }

  private buildAuditFilterLabel(
    checkImages: boolean,
    checkFeaturedVideo: boolean,
    checkDescriptions: boolean,
    checkReleaseData: boolean,
    showComplete: boolean,
  ): "all" | "image" | "video" | "description" | "release" | "mixed" | "complete" {
    if (showComplete) return "complete";
    const enabled = [
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
    ].filter(Boolean).length;
    if (enabled === 4) return "all";
    if (enabled === 1) {
      if (checkImages) return "image";
      if (checkFeaturedVideo) return "video";
      if (checkDescriptions) return "description";
      return "release";
    }
    return "mixed";
  }

  private async buildAuditListResponse(sessionId: string) {
    const session = AUDIT_SESSIONS.get(sessionId)!;
    const { games, page } = session;

    const totalPages = Math.ceil(games.length / AUDIT_PAGE_SIZE);
    const start = page * AUDIT_PAGE_SIZE;
    const end = start + AUDIT_PAGE_SIZE;
    const slice = games.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle(`GameDB Audit (${session.filter})`)
      .setDescription(
        `Showing items ${start + 1}-${Math.min(end, games.length)} of ${games.length}\n\n` +
        slice.map((g) => {
          const imageStatus = g.imageData ? "✅Img" : "❌Img";
          const videoStatus = g.featuredVideoUrl ? "✅Vid" : "❌Vid";
          const descStatus = g.description ? "✅Desc" : "❌Desc";
          const releaseStatus = g.initialReleaseDate ? "✅Rel" : "❌Rel";
          return `• **${g.title}** (ID: ${g.id}) ` +
            `${imageStatus} ${videoStatus} ${descStatus} ${releaseStatus}`;
        }).join("\n"),
      )
      .setFooter({ text: buildPageFooterText(page, totalPages) });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`audit-select:${sessionId}`)
      .setPlaceholder("Select a game to audit")
      .addOptions(
        slice.map(g => ({
          label: g.title.substring(0, 100),
          value: String(g.id),
          description: `ID: ${g.id}`,
        })),
      );

    const prevDisabled = page === 0;
    const nextDisabled = page >= totalPages - 1;

    const buttons = buildButtonRow(
      buildActionButton({ customId: `audit-page:${sessionId}:prev`, label: "Previous", style: ButtonStyle.Secondary }).setDisabled(prevDisabled),
      buildActionButton({ customId: `audit-page:${sessionId}:next`, label: "Next", style: ButtonStyle.Secondary }).setDisabled(nextDisabled),
    );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const components: ActionRowBuilder<any>[] = [row];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttons);
    }

    return {
      embeds: [embed],
      components,
      files: [],
    };
  }

  private async buildAuditDetailResponse(sessionId: string, game: IGame) {
    const embed = new EmbedBuilder()
      .setTitle(`Audit: ${game.title}`)
      .setDescription(`Game ID: ${game.id}\nIGDB ID: ${game.igdbId ?? "N/A"}`)
      .setColor(COLOR_HIGHLIGHT);

    const files: AttachmentBuilder[] = [];

    let igdbImageAvailable = false;
    let igdbImageUrl = "";
    let igdbVideoUrl: string | null = null;
    let igdbDetailsLoaded = false;

    // Check IGDB for image if missing
    if ((!game.imageData || !game.featuredVideoUrl) && game.igdbId) {
      try {
        const details = await igdbService.getGameDetails(game.igdbId);
        igdbDetailsLoaded = true;
        if (!game.imageData && details?.cover?.image_id) {
          igdbImageAvailable = true;
          igdbImageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
          embed.addFields({
            name: "IGDB Suggestion",
            value: "[Link to Image](" + igdbImageUrl + ")",
            inline: true,
          });
        }
        if (details && !game.featuredVideoUrl) {
          igdbVideoUrl = Game.getFeaturedVideoUrl(details);
        }
      } catch {
        // ignore
      }
    }

    if (game.imageData) {
        embed.addFields({ name: "Image", value: "✅ Present", inline: true });
        // Optionally show it
        const attach = new AttachmentBuilder(game.imageData, { name: "cover.jpg" });
        files.push(attach);
        embed.setImage("attachment://cover.jpg");
    } else {
        embed.addFields({ name: "Image", value: "❌ Missing", inline: true });
    }

    if (game.featuredVideoUrl) {
        embed.addFields({ name: "Featured Video", value: "✅ Present", inline: true });
    } else {
        embed.addFields({ name: "Featured Video", value: "❌ Missing", inline: true });
    }

    if (game.description) {
      embed.addFields({ name: "Description", value: "✅ Present", inline: true });
    } else {
      embed.addFields({ name: "Description", value: "❌ Missing", inline: true });
    }

    const releases = await Game.getGameReleases(game.id);
    if (releases.length) {
      embed.addFields({
        name: "Release Data",
        value: `✅ ${releases.length} release${releases.length === 1 ? "" : "s"}`,
        inline: true,
      });
    } else {
      embed.addFields({ name: "Release Data", value: "❌ Missing", inline: true });
    }

    // Check thread link
    const associations = await Game.getGameAssociations(game.id);
    const nowPlaying = await Game.getNowPlayingMembers(game.id); // Also checks for thread links in its query
    
    // Find any thread
    const threadId = 
        associations.gotmWins.find(w => w.threadId)?.threadId ??
        associations.nrGotmWins.find(w => w.threadId)?.threadId ??
        nowPlaying.find(p => p.threadId)?.threadId;

    if (threadId) {
        embed.addFields({ name: "Thread", value: `✅ ${channelMention(threadId)}`, inline: true });
    } else {
        embed.addFields({ name: "Thread", value: "❌ Missing", inline: true });
    }

    const navRow = buildButtonRow(
      buildActionButton({ customId: `audit-back:${sessionId}`, label: "Back to List", style: ButtonStyle.Secondary }),
      buildActionButton({ customId: `audit-next:${sessionId}:${game.id}`, label: "Go to Next Game", style: ButtonStyle.Secondary }),
    );

    const actionButtons: ButtonBuilder[] = [];
    if (!game.imageData && igdbImageAvailable) {
      actionButtons.push(
        buildActionButton({ customId: `audit-accept-igdb:${sessionId}:${game.id}`, label: "Accept IGDB Image", style: ButtonStyle.Success }),
      );
    }

    if (!game.featuredVideoUrl && (igdbVideoUrl || igdbDetailsLoaded)) {
      actionButtons.push(
        buildActionButton({ customId: `audit-accept-video:${sessionId}:${game.id}`, label: "Accept IGDB Video", style: ButtonStyle.Secondary }).setDisabled(!igdbVideoUrl),
      );
    }

    const session = AUDIT_SESSIONS.get(sessionId);
    if (session) {
      if (!game.featuredVideoUrl && ["video", "mixed", "all"].includes(session.filter)) {
        actionButtons.push(
          buildActionButton({ customId: `audit-video:${sessionId}:${game.id}`, label: "Add YouTube Video", style: ButtonStyle.Primary }),
        );
      }
      if (!game.description && ["description", "mixed", "all"].includes(session.filter)) {
        actionButtons.push(
          buildActionButton({ customId: `audit-description:${sessionId}:${game.id}`, label: "Add Description", style: ButtonStyle.Primary }),
        );
      }
    }

    const editRow = buildButtonRow(
      buildActionButton({ customId: `audit-img:${sessionId}:${game.id}`, label: "Upload Image", style: ButtonStyle.Primary }),
    );

    const components: ActionRowBuilder<ButtonBuilder>[] = [navRow];
    if (actionButtons.length) {
      components.push(buildButtonRow(...actionButtons));
    }
    components.push(editRow);

    return {
      embeds: [embed],
      components,
      files: files.length ? files : undefined,
    };
  }

  private async runAutoAcceptOperation(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
    titleWords: string[] | undefined,
    title: string,
    performer: (
      onProgress: (line: string, processed: number) => Promise<void>,
      shouldStop: () => boolean,
      titleWords?: string[],
    ) => Promise<AutoAcceptResult>,
  ): Promise<void> {
    const runId = interaction.id;
    AUTO_ACCEPT_RUNS.set(runId, {
      canceled: false,
      ownerId: interaction.guild?.ownerId ?? null,
    });

    let currentEmbed = new EmbedBuilder()
      .setTitle(title)
      .setDescription("Starting auto accept run...")
      .setColor(COLOR_PRIMARY);
    const stopRow = this.buildAutoAcceptStopRow(runId, false);

    const followUpPayload = buildAutoAcceptFollowUpPayload([currentEmbed], [stopRow], isPublic);
    let currentMessage: any = null;
    try {
      currentMessage = useFollowUp
        ? await safeReply(interaction, { ...followUpPayload, __forceFollowUp: true })
        : await safeReply(interaction, { embeds: [currentEmbed], components: [stopRow] });
    } catch {
      // ignore
    }
    if (!currentMessage) {
      try {
        currentMessage = await safeReply(
          interaction,
          { ...followUpPayload, __forceFollowUp: true },
        );
      } catch {
        // ignore
      }
    }

    const logLines: string[] = [];
    let currentChunk = 0;
    const shouldStop = (): boolean => AUTO_ACCEPT_RUNS.get(runId)?.canceled ?? true;
    const updateEmbed = async (log?: string, processed?: number) => {
      if (processed && processed > 0) {
        const chunk = Math.floor((processed - 1) / 50);
        if (chunk !== currentChunk) {
          currentChunk = chunk;
          currentEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription("Processing...")
            .setColor(COLOR_PRIMARY);
          logLines.length = 0;
          try {
            currentMessage = await safeReply(interaction, {
              ...buildAutoAcceptFollowUpPayload(
                [currentEmbed],
                [this.buildAutoAcceptStopRow(runId, shouldStop())],
                isPublic,
              ),
              __forceFollowUp: true,
            });
          } catch {
            // ignore
          }
        }
      }
      if (log) logLines.push(log);

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }
      currentEmbed.setDescription(content || "Processing...");
      try {
        if (currentMessage?.edit) {
          await currentMessage.edit({
            embeds: [currentEmbed],
            components: [this.buildAutoAcceptStopRow(runId, shouldStop())],
          });
        }
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performer(updateEmbed, shouldStop, titleWords);
    if (!logs.length) {
      await safeReply(interaction, {
        ...buildTextReply("No eligible games found for this operation.", !isPublic),
        __forceFollowUp: useFollowUp,
      });
      AUTO_ACCEPT_RUNS.delete(runId);
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    currentEmbed.setColor(COLOR_SUCCESS);
    const stopped = shouldStop();
    const finalStopRow = this.buildAutoAcceptStopRow(runId, true, stopped ? "Stopped" : "Stop");
    if (currentMessage?.edit) {
      await currentMessage.edit({ embeds: [currentEmbed], components: [finalStopRow] });
    }
    AUTO_ACCEPT_RUNS.delete(runId);
  }

  private async runAutoAcceptAll(
    interaction: CommandInteraction,
    isPublic: boolean,
    titleWords?: string[],
  ): Promise<void> {
    const runId = interaction.id;
    AUTO_ACCEPT_RUNS.set(runId, {
      canceled: false,
      ownerId: interaction.guild?.ownerId ?? null,
    });

    const title = "GameDB IGDB Sweep (All Fields)";
    let currentEmbed = new EmbedBuilder()
      .setTitle(title)
      .setDescription("Starting sweep...")
      .setColor(COLOR_PRIMARY);
    const stopRow = this.buildAutoAcceptStopRow(runId, false);

    let currentMessage: any = null;
    try {
      currentMessage = await safeReply(interaction, {
        embeds: [currentEmbed],
        components: [stopRow],
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
    } catch {
      // ignore
    }

    const logLines: string[] = [];
    let currentChunk = 0;
    const shouldStop = (): boolean => AUTO_ACCEPT_RUNS.get(runId)?.canceled ?? true;
    const updateEmbed = async (log?: string, processed?: number) => {
      if (processed && processed > 0) {
        const chunk = Math.floor((processed - 1) / 50);
        if (chunk !== currentChunk) {
          currentChunk = chunk;
          currentEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription("Processing...")
            .setColor(COLOR_PRIMARY);
          logLines.length = 0;
          try {
            currentMessage = await safeReply(interaction, {
              ...buildAutoAcceptFollowUpPayload(
                [currentEmbed],
                [this.buildAutoAcceptStopRow(runId, shouldStop())],
                isPublic,
              ),
              __forceFollowUp: true,
            });
          } catch {
            // ignore
          }
        }
      }
      if (log) logLines.push(log);

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }
      currentEmbed.setDescription(content || "Processing...");
      try {
        if (currentMessage?.edit) {
          await currentMessage.edit({
            embeds: [currentEmbed],
            components: [this.buildAutoAcceptStopRow(runId, shouldStop())],
          });
        }
      } catch {
        // ignore
      }
    };

    const stats: AllAcceptStats = await performAutoAcceptAll(updateEmbed, shouldStop, titleWords);

    if (!stats.logs.length) {
      await safeReply(interaction, buildTextReply(
        "No games found missing any data with a valid IGDB ID.",
        !isPublic,
      ));
      AUTO_ACCEPT_RUNS.delete(runId);
      return;
    }

    const summary = [
      "\n**Sweep Complete**",
      `Images:       ✅ ${stats.images.updated} | ⏭️ ${stats.images.skipped} | ❌ ${stats.images.failed}`,
      `Videos:       ✅ ${stats.videos.updated} | ⏭️ ${stats.videos.skipped} | ❌ ${stats.videos.failed}`,
      `Descriptions: ✅ ${stats.descriptions.updated} | ⏭️ ${stats.descriptions.skipped}` +
        ` | ❌ ${stats.descriptions.failed}`,
      `Releases:     ✅ ${stats.releases.updated} | ⏭️ ${stats.releases.skipped}` +
        ` | ❌ ${stats.releases.failed}`,
    ].join("\n");
    await updateEmbed(summary);
    currentEmbed.setColor(COLOR_SUCCESS);
    const stopped = shouldStop();
    const finalStopRow = this.buildAutoAcceptStopRow(runId, true, stopped ? "Stopped" : "Stop");
    if (currentMessage?.edit) {
      await currentMessage.edit({ embeds: [currentEmbed], components: [finalStopRow] });
    }
    AUTO_ACCEPT_RUNS.delete(runId);
  }

  @Slash({
    description: "Quick add one GameDB search synonym group (Admin only)",
    name: "synonym-add",
  })
  async synonymAdd(
    @SlashOption({
      description: "Base term for the group",
      name: "base_term",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    baseTerm: string,
    @SlashOption({
      description: "Required synonym for the base term",
      name: "synonym",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    synonym: string,
    @SlashOption({
      description: "Optional additional synonyms (comma, pipe, semicolon, or newline separated)",
      name: "additional_synonyms",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    additionalSynonyms: string | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
    if (!(await isAdmin(interaction))) return;

    const cleanedBaseTerm = sanitizeUserInput(baseTerm, { preserveNewlines: false });
    const cleanedSynonym = sanitizeUserInput(synonym, { preserveNewlines: false });
    const cleanedAdditionalSynonyms = additionalSynonyms
      ? sanitizeUserInput(additionalSynonyms, { preserveNewlines: true })
      : undefined;

    const terms = parseSynonymQuickAddTerms(
      cleanedBaseTerm,
      cleanedSynonym,
      cleanedAdditionalSynonyms,
    );
    if (terms.length < 2) {
      await safeReply(interaction, buildTextReply("Invalid input. Provide a base term and synonym with letters or numbers. " +
          "Additional synonyms can be separated by comma, pipe, semicolon, or newline.", !(isPublic)));
      return;
    }

    try {
      const result = await GameSearchSynonym.createGroupTerms(terms, interaction.user.id);
      const termList = result.terms.map((term) => `"${term.termText}"`).join(" | ");
      let content = `Saved synonym group #${result.groupId} with ${result.terms.length} terms:\n${termList}`;
      content = truncateWithEllipsis(content, 1900);
      await safeReply(interaction, buildTextReply(content, !(isPublic)));
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(`Failed to save synonym group. ${err?.message ?? "Unknown error."}`, !(isPublic)));
    }
  }

  @Slash({
    description: "List GameDB search synonyms (Admin only)",
    name: "synonym-list",
  })
  async synonymList(
    @SlashOption({
      description: "Optional query to filter terms",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: PRIVATE_OPTION_DESCRIPTION,
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !(privateFlag ?? false);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
    if (!(await isAdmin(interaction))) return;

    const cleanedQuery = query ? sanitizeUserInput(query, { preserveNewlines: false }) : "";
    const payload = await this.buildSynonymListPayload(
      interaction.user.id,
      cleanedQuery,
      0,
      isPublic,
    );
    await safeReply(interaction, payload);
  }

  @ModalComponent({ id: /^gamedb-syn-add:\d+$/ })
  async synonymAddModal(interaction: ModalSubmitInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_ADD_BULK_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const pairs = parseSynonymPairs(cleanedInput, 50);
    if (!pairs.length) {
      await safeReply(interaction, buildTextReply("No valid pairs found. Use one pair per line with a separator like \"<->\" or \"->\".", true));
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const addedLines: string[] = [];
    const errors: string[] = [];
    for (const pair of pairs) {
      const termText = sanitizeUserInput(pair.term, { preserveNewlines: false });
      const matchText = sanitizeUserInput(pair.match, { preserveNewlines: false });
      if (!termText || !matchText) continue;
      try {
        const result = await GameSearchSynonym.addSynonymPair(
          termText,
          matchText,
          interaction.user.id,
        );
        const list = result.terms.map((item) => `"${item.termText}"`).join(" | ");
        addedLines.push(`Group ${result.groupId}: ${list}`);
      } catch (err: any) {
        errors.push(err?.message ?? `Failed to add ${termText}`);
      }
    }

    await GameSearchSynonymDraft.appendPairs(draftId, pairs);

    const summaryLines = [
      `Added ${addedLines.length} synonym pair${addedLines.length === 1 ? "" : "s"}.`,
      ...addedLines,
      ...(errors.length ? ["", "Errors:", ...errors] : []),
      "",
      "Use Add More to continue, or Done to finish.",
    ];
    const content = truncateWithEllipsis(summaryLines.join("\n"), 1900);

    const synonymSummaryReply = buildTextReply(content, true);
    await safeReply(interaction, {
      ...synonymSummaryReply,
      components: [
        ...synonymSummaryReply.components,
        ...buildSynonymContinueComponents(draftId),
      ],
    });
  }

  @ButtonComponent({ id: /^gamedb-syn-more:\d+$/ })
  async synonymAddMore(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    safeIgnore(interaction.showModal(buildSynonymAddModal(draftId)));
  }

  @ButtonComponent({ id: /^gamedb-syn-done:\d+$/ })
  async synonymAddDone(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const draftId = Number(segs[0]);
    if (!isPositiveInt(draftId)) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer valid.", true));
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This synonym draft is no longer available.", true));
      return;
    }

    await GameSearchSynonymDraft.deleteDraft(draftId);
    await safeUpdate(interaction, buildTextReply("Synonym entry complete.", true));
  }

  @SelectMenuComponent({ id: /^gamedb-syn-edit-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupEditSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const groupId = Number(interaction.values[0]);
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const terms = await GameSearchSynonym.listGroupTerms(groupId);
    if (!terms.length) {
      await safeReply(interaction, buildTextReply("Synonym group not found.", true));
      return;
    }

    let termLines = terms.map((term) => term.termText).join("\n");
    if (termLines.length > 2000) {
      termLines = termLines.slice(0, 2000);
    }

    await interaction
      .showModal(buildSynonymGroupEditModal(ownerId, groupId, termLines))
      .catch(async () => {
        await safeReply(interaction, buildTextReply("Unable to open the edit modal. Please try again.", true));
      });
  }

  @SelectMenuComponent({ id: /^gamedb-syn-delete-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId, pageRaw, encodedQuery] = segs;
    const page = Number(pageRaw);
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const groupId = Number(interaction.values[0]);
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const deleted = await GameSearchSynonym.deleteGroup(groupId);
    if (!deleted) {
      await safeReply(interaction, buildTextReply("Synonym group not found.", true));
      return;
    }

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page : 0,
      isPublic,
    );
    await safeUpdate(interaction, payload);
  }

  @ButtonComponent({ id: /^gamedb-syn-add-from-list:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymAddFromList(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [ownerId] = segs;
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const draft = await GameSearchSynonymDraft.createDraft(interaction.user.id);
    await interaction
      .showModal(buildSynonymAddModal(draft.draftId))
      .catch(async () => {
        await safeReply(interaction, buildTextReply("Unable to open the synonym modal. Please try again.", true));
      });
  }

  @ModalComponent({ id: /^gamedb-syn-edit-group-modal:\d+:\d+$/ })
  async synonymGroupEditModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, groupIdRaw] = segs;
    const groupId = Number(groupIdRaw);
    if (await replyIfNotOwner(interaction, ownerId, "This edit request isn't for you.")) return;
    if (!isPositiveInt(groupId)) {
      await safeReply(interaction, buildTextReply("Invalid synonym group selected.", true));
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_EDIT_GROUP_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const line of cleanedInput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const norm = GameSearchSynonym.normalizeTerm(trimmed);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      terms.push(trimmed);
    }

    if (terms.length < 2) {
      await safeReply(interaction, buildTextReply("Synonym groups must include at least two terms.", true));
      return;
    }

    try {
      const result = await GameSearchSynonym.updateGroupTerms(
        groupId,
        terms,
        interaction.user.id,
      );
      const termList = result.terms.map((term) => `"${term.termText}"`).join(" | ");
      let content = `Updated synonym group with ${result.terms.length} terms:\n${termList}`;
      content = truncateWithEllipsis(content, 1900);
      await safeReply(interaction, buildTextReply(content, true));
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(err?.message ?? "Failed to update synonym group.", true));
    }
  }

  @ButtonComponent({ id: /^gamedb-syn-page:\d+:\d+:[A-Za-z0-9_-]*:(next|prev)$/ })
  async synonymListPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [ownerId, pageRaw, encodedQuery, direction] = segs;
    const page = Number(pageRaw);

    if (await replyIfNotOwner(interaction, ownerId)) return;

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const delta = direction === "next" ? 1 : -1;
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page + delta : 0,
      isPublic,
    );

    await safeUpdate(interaction, payload);
  }
}
