import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import UserGameCollection, {
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import Game from "../../classes/Game.js";
import { igdbService } from "../../services/IGDB/IgdbService.js";
import { flattenErrorMessages } from "../imports/import-scaffold.service.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { formatTableDate } from "../profile.command.js";
import { safeDeferUpdate } from "../../functions/InteractionUtils.js";

const COLLECTION_LIST_PAGE_SIZE = 10;
const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
const COLLECTION_LIST_FILTER_PREFIX = "collection-list-filter-v1";
const COLLECTION_LIST_FILTER_PANEL_PREFIX = "clf1";
const COLLECTION_LIST_FILTER_MODAL_PREFIX = "clfm1";
export const COLLECTION_FILTER_TITLE_INPUT_ID = "collection-filter-title";
export const COLLECTION_FILTER_PLATFORM_INPUT_ID = "collection-filter-platform";

function ownershipTypeToCode(value: CollectionOwnershipType | undefined): string {
  if (!value) return "_";
  return value[0]?.toUpperCase() ?? "_";
}

function ownershipCodeToType(code: string): CollectionOwnershipType | undefined {
  if (code === "D") return "Digital";
  if (code === "P") return "Physical";
  if (code === "S") return "Subscription";
  if (code === "O") return "Other";
  return undefined;
}

export function nextOwnershipType(
  ownershipType: CollectionOwnershipType | undefined,
): CollectionOwnershipType | undefined {
  if (!ownershipType) return "Digital";
  if (ownershipType === "Digital") return "Physical";
  if (ownershipType === "Physical") return "Subscription";
  if (ownershipType === "Subscription") return "Other";
  return undefined;
}

export function buildCollectionListNavId(params: {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
}): string {
  return [
    COLLECTION_LIST_NAV_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    String(params.page),
    params.isEphemeral ? "e" : "p",
    params.direction,
  ].join(":");
}

export function parseCollectionListNavId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_NAV_PREFIX) return null;

  const viewerUserId = parts[1];
  const targetUserId = parts[2];
  const page = Number(parts[3]);
  const visibility = parts[4];
  const direction = parts[5] as "prev" | "next";
  if (!Number.isInteger(page) || page < 0) return null;
  if (visibility !== "e" && visibility !== "p") return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    viewerUserId,
    targetUserId,
    page,
    isEphemeral: visibility === "e",
    direction,
  };
}

export function buildCollectionFilterActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
}): string {
  return [
    COLLECTION_LIST_FILTER_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.isEphemeral ? "e" : "p",
    params.action,
  ].join(":");
}

export function parseCollectionFilterActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PREFIX) return null;
  const visibility = parts[3];
  const action = parts[4] as "open";
  if (visibility !== "e" && visibility !== "p") return null;
  if (action !== "open") return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    isEphemeral: visibility === "e",
    action,
  };
}

function encodeFilterPanelAction(
  action: "text" | "ownership" | "apply" | "clear" | "cancel",
): string {
  if (action === "text") return "t";
  if (action === "ownership") return "o";
  if (action === "apply") return "a";
  if (action === "clear") return "c";
  return "x";
}

function decodeFilterPanelAction(
  code: string,
): "text" | "ownership" | "apply" | "clear" | "cancel" | null {
  if (code === "t") return "text";
  if (code === "o") return "ownership";
  if (code === "a") return "apply";
  if (code === "c") return "clear";
  if (code === "x") return "cancel";
  return null;
}

export function buildCollectionFilterPanelActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
}): string {
  return [
    COLLECTION_LIST_FILTER_PANEL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    encodeFilterPanelAction(params.action),
  ].join(":");
}

export function parseCollectionFilterPanelActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PANEL_PREFIX) return null;
  const visibility = parts[4];
  const action = decodeFilterPanelAction(parts[5]);
  if (visibility !== "e" && visibility !== "p") return null;
  if (!action) return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    action,
  };
}

export function buildCollectionFilterModalId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipCode: string;
}): string {
  return [
    COLLECTION_LIST_FILTER_MODAL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    params.ownershipCode,
  ].join(":");
}

export function parseCollectionFilterModalId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_MODAL_PREFIX) return null;
  const visibility = parts[4];
  if (visibility !== "e" && visibility !== "p") return null;
  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    ownershipType: ownershipCodeToType(parts[5]),
  };
}

export function buildCollectionFilterPanelContent(params: {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): string {
  const titleText = params.title ?? "(any)";
  const platformText = params.platform ?? "(any)";
  const ownershipText = params.ownershipType ?? "(any)";
  return (
    "### Filter collection results\n" +
    `> Title: ${titleText}\n` +
    `> Platform: ${platformText}\n` +
    `> Ownership: ${ownershipText}\n\n` +
    "Use **Edit Text** for title/platform, then **Apply**."
  );
}

export function buildCollectionFilterPanelComponents(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
}): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "text",
          }),
        )
        .setLabel("Edit Text")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "ownership",
          }),
        )
        .setLabel(`Ownership: ${params.ownershipType ?? "Any"}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "apply",
          }),
        )
        .setLabel("Apply")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "clear",
          }),
        )
        .setLabel("Clear")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "cancel",
          }),
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function buildOwnershipFilterCode(
  ownershipType: CollectionOwnershipType | undefined,
): string {
  return ownershipTypeToCode(ownershipType);
}

export function parseCollectionFilterStateFromContent(content: string): {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const getValue = (label: "Title" | "Platform" | "Ownership"): string | undefined => {
    const match = content.match(new RegExp(`> ${label}:\\s*(.+)$`, "mi"));
    const value = match?.[1]?.trim();
    if (!value || value === "(any)") return undefined;
    return value;
  };

  const ownershipRaw = getValue("Ownership");
  const ownershipType = ownershipRaw === "Digital" ||
      ownershipRaw === "Physical" ||
      ownershipRaw === "Subscription" ||
      ownershipRaw === "Other"
    ? ownershipRaw
    : undefined;

  return {
    title: getValue("Title"),
    platform: getValue("Platform"),
    ownershipType,
  };
}

export function parseCollectionFiltersFromListMessage(message: any): {
  title: string | undefined;
  platform: string | undefined;
  platformId: number | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const filterBlock = textBlocks.find(
    (value) => value.includes("Filters:") || value.includes("**Filters**"),
  );
  if (!filterBlock) {
    return {
      title: undefined,
      platform: undefined,
      platformId: undefined,
      ownershipType: undefined,
    };
  }

  const titleMatch = filterBlock.match(/title~([^|\n]+)/i);
  const platformMatch = filterBlock.match(/platform~([^|\n]+)/i);
  const platformIdMatch = filterBlock.match(/platform-id=(\d+)/i);
  const platformId = platformIdMatch ? Number(platformIdMatch[1]) : undefined;
  const ownershipMatch = filterBlock.match(/ownership=([A-Za-z]+)/i);
  const ownershipType = ownershipMatch?.[1] === "Digital" ||
      ownershipMatch?.[1] === "Physical" ||
      ownershipMatch?.[1] === "Subscription" ||
      ownershipMatch?.[1] === "Other"
    ? (ownershipMatch[1] as CollectionOwnershipType)
    : undefined;

  return {
    title: titleMatch?.[1]?.trim() || undefined,
    platform: platformMatch?.[1]?.trim() || undefined,
    platformId: Number.isInteger(platformId) && (platformId as number) > 0 ? platformId : undefined,
    ownershipType,
  };
}

async function buildCollectionThumbnails(
  entries: Array<{ gameId: number }>,
): Promise<Map<number, string>> {
  const thumbnailsByGameId = new Map<number, string>();
  if (!entries.length) return thumbnailsByGameId;

  const uniqueGameIds = [...new Set(entries.map((e) => e.gameId))];
  console.log("[collection-list] thumbnails: getGameById start", { count: uniqueGameIds.length });
  const games = await Promise.all(uniqueGameIds.map((id) => Game.getGameById(id)));
  console.log("[collection-list] thumbnails: getGameById done");

  const igdbIdsByGameId = new Map<number, number>();
  for (let i = 0; i < uniqueGameIds.length; i++) {
    const game = games[i];
    if (game?.igdbId) igdbIdsByGameId.set(uniqueGameIds[i]!, game.igdbId);
  }

  if (!igdbIdsByGameId.size) return thumbnailsByGameId;

  console.log("[collection-list] thumbnails: getCoversForGames start", { count: igdbIdsByGameId.size });
  let imageIdsByIgdbId: Map<number, string>;
  try {
    imageIdsByIgdbId = await igdbService.getCoversForGames([...igdbIdsByGameId.values()]);
    console.log("[collection-list] thumbnails: getCoversForGames done");
  } catch (err) {
    console.error("[collection-list] thumbnails: getCoversForGames failed", err);
    return thumbnailsByGameId;
  }

  for (const [gameId, igdbId] of igdbIdsByGameId) {
    const imageId = imageIdsByIgdbId.get(igdbId);
    if (imageId) {
      thumbnailsByGameId.set(
        gameId,
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`,
      );
    }
  }
  return thumbnailsByGameId;
}

function logCollectionListNavDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  console.log("[CollectionListNavDebug]", event, JSON.stringify(details));
}

function validateComponentsForCollectionNavDebug(
  components: Array<ContainerBuilder | ActionRowBuilder<any>>,
  context: Record<string, unknown>,
): void {
  for (const [index, component] of components.entries()) {
    try {
      (component as any)?.toJSON?.();
      logCollectionListNavDebug("component_valid", {
        ...context,
        componentIndex: index,
        componentType: String((component as any)?.constructor?.name ?? "unknown"),
      });
    } catch (error) {
      console.error(
        "[CollectionListNavDebug] component_invalid",
        JSON.stringify({
          ...context,
          componentIndex: index,
          componentType: String((component as any)?.constructor?.name ?? "unknown"),
          messages: flattenErrorMessages(error),
        }),
      );
    }
  }
}

async function buildCollectionListResponse(params: {
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
}): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  content?: string;
}> {
  console.log("[collection-list] step: searchEntries start", { targetUserId: params.targetUserId });
  const entries = await UserGameCollection.searchEntries({
    targetUserId: params.targetUserId,
    title: params.title,
    platform: params.platform,
    platformId: params.platformId,
    ownershipType: params.ownershipType,
  });
  console.log("[collection-list] step: searchEntries done", { count: entries.length });

  const total = entries.length;
  if (!total) {
    return {
      content: params.targetUserId === params.viewerUserId
        ? "No collection entries matched your filters."
        : "No collection entries matched your filters for that member.",
      components: [],
    };
  }

  const pageCount = Math.max(1, Math.ceil(total / COLLECTION_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(params.page, 0), pageCount - 1);
  const start = safePage * COLLECTION_LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + COLLECTION_LIST_PAGE_SIZE);

  if (params.debugSource === "nav") {
    logCollectionListNavDebug("build_response_start", {
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      requestedPage: params.page,
      safePage,
      pageCount,
      total,
      pageEntryCount: pageEntries.length,
      titleFilter: params.title ?? null,
      platformFilter: params.platform ?? null,
      platformIdFilter: params.platformId ?? null,
      ownershipFilter: params.ownershipType ?? null,
    });
  }

  const headerTitle = params.targetUserId === params.viewerUserId
    ? (params.isEphemeral ? "Your game collection" : `${params.memberLabel}'s Game Collection`)
    : `${params.memberLabel}'s Game Collection`;
  const filtersText = [
    params.title ? `title~${params.title}` : null,
    params.platformLabel ? `platform~${params.platformLabel}` : null,
    params.platformId ? `platform-id=${params.platformId}` : null,
    params.ownershipType ? `ownership=${params.ownershipType}` : null,
  ].filter(Boolean).join(" | ");
  console.log("[collection-list] step: buildThumbnails start", { pageEntryCount: pageEntries.length });
  const thumbnailsByGameId = await buildCollectionThumbnails(pageEntries);
  console.log("[collection-list] step: buildThumbnails done", { count: thumbnailsByGameId.size });
  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];

  const headerContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`## ${headerTitle}`, 250)),
  );
  components.push(headerContainer);

  for (const entry of pageEntries) {
    const platform = entry.platformName ?? "Unknown platform";
    const noteLine = entry.note ? `\n> Note: ${entry.note}` : "";
    const sectionText = safeV2TextContent(
      `### ${entry.title}\n` +
      `> Platform: ${platform}\n` +
      `> Ownership: ${entry.ownershipType}\n` +
      `> Added: ${formatTableDate(entry.createdAt)}${noteLine}`,
      1000,
    );
    if (params.debugSource === "nav") {
      logCollectionListNavDebug("entry_section_payload", {
        entryId: entry.entryId,
        gameId: entry.gameId,
        titleLength: entry.title.length,
        noteLength: entry.note?.length ?? 0,
        platformLength: (entry.platformName ?? "Unknown platform").length,
        sectionTextLength: sectionText.length,
      });
    }
    const thumb = thumbnailsByGameId.get(entry.gameId);
    if (!thumb) {
      const entryContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(sectionText, 1000)),
      );
      components.push(entryContainer);
      continue;
    }

    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(sectionText, 1000)),
    );
    try {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb));
      section.toJSON();
    } catch {
      const entryContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(sectionText, 1000)),
      );
      components.push(entryContainer);
      continue;
    }
    const entryContainer = new ContainerBuilder().addSectionComponents(section);
    components.push(entryContainer);
  }

  const footerParts = [`Page ${safePage + 1}/${pageCount}`, `${total} total entries`];
  if (filtersText) {
    footerParts.push(`Filters: ${filtersText}`);
  }
  const footerContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`-# ${footerParts.join(" | ")}`, 1000)),
  );
  components.push(footerContainer);

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pageCount > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "prev",
          }),
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "next",
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionFilterActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          isEphemeral: params.isEphemeral,
          action: "open",
        }),
      )
      .setLabel("Filter Results")
      .setStyle(ButtonStyle.Primary),
  );
  components.push(row);

  if (params.debugSource === "nav") {
    validateComponentsForCollectionNavDebug(components, {
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      safePage,
      pageCount,
      total,
    });
  }

  // eslint-disable-next-line local/dynamic-components-require-chunking
  return { components };
}

export async function buildCollectionListResponseForTests(params: {
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
}): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  content?: string;
}> {
  return buildCollectionListResponse(params);
}

export async function applyFiltersToSourceMessage(params: {
  interaction: ButtonInteraction;
  sourceMessageId: string;
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): Promise<boolean> {
  const channel = params.interaction.channel;
  if (!channel || !("messages" in channel)) {
    return false;
  }

  const memberLabel = params.targetUserId === params.viewerUserId
    ? params.interaction.user.username
    : "Member";
  const response = await buildCollectionListResponse({
    viewerUserId: params.viewerUserId,
    targetUserId: params.targetUserId,
    memberLabel,
    title: params.title,
    platform: params.platform,
    platformId: undefined,
    platformLabel: params.platform,
    ownershipType: params.ownershipType,
    page: 0,
    isEphemeral: params.isEphemeral,
  });

  const sourceMessage = await (channel as any).messages
    .fetch(params.sourceMessageId)
    .catch(() => null);
  if (!sourceMessage) {
    return false;
  }

  if (response.content) {
    await sourceMessage.edit({
      content: response.content,
      components: [],
    });
    return true;
  }

  await sourceMessage.edit({
    content: null,
    components: response.components,
  });
  return true;
}

export async function closeFilterPanel(interaction: ButtonInteraction): Promise<void> {
  await safeDeferUpdate(interaction);
  await (interaction.message as any)?.delete?.().catch(() => {});
}

function collectTextDisplayContent(
  components: any[] | undefined,
  output: string[],
): void {
  if (!components?.length) return;
  for (const component of components) {
    if (component && typeof component.content === "string") {
      output.push(component.content);
    }
    if (Array.isArray(component?.components)) {
      collectTextDisplayContent(component.components, output);
    }
  }
}
