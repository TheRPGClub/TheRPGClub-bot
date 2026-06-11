import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
} from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import UserGameCollection, {
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import { flattenErrorMessages } from "../imports/import-scaffold.service.js";
import {
  buildTextContainer,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { safeDeferUpdate } from "../../functions/InteractionUtils.js";
import {
  buildActionButton,
  buildButtonRow,
  buildUserHeaderContainer,
} from "../../functions/uiComponents.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { buildDisabledPrevNextRowWithIds } from "../../functions/PaginationUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError, logInfo } from "../../utilities/LogUtils.js";
import {
  COLLECTION_LIST_NAV_PREFIX,
  COLLECTION_LIST_FILTER_PREFIX,
  COLLECTION_LIST_FILTER_PANEL_PREFIX,
  COLLECTION_LIST_FILTER_MODAL_PREFIX,
} from "../../config/customIdPrefixes.js";
import { COLLECTION_LIST_PAGE_SIZE } from "../../config/pagination.js";
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
  if (!customId.startsWith(`${COLLECTION_LIST_NAV_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [viewerUserId, targetUserId, pageStr, visibility, direction] = segs;
  const page = Number(pageStr);
  if (!Number.isInteger(page) || page < 0) return null;
  if (visibility !== "e" && visibility !== "p") return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    viewerUserId,
    targetUserId,
    page,
    isEphemeral: visibility === "e",
    direction: direction as "prev" | "next",
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
  if (!customId.startsWith(`${COLLECTION_LIST_FILTER_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [viewerUserId, targetUserId, visibility, action] = segs;
  if (visibility !== "e" && visibility !== "p") return null;
  if (action !== "open") return null;

  return {
    viewerUserId,
    targetUserId,
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
  if (!customId.startsWith(`${COLLECTION_LIST_FILTER_PANEL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [viewerUserId, targetUserId, sourceMessageId, visibility, actionCode] = segs;
  const action = decodeFilterPanelAction(actionCode);
  if (visibility !== "e" && visibility !== "p") return null;
  if (!action) return null;

  return {
    viewerUserId,
    targetUserId,
    sourceMessageId,
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
  if (!customId.startsWith(`${COLLECTION_LIST_FILTER_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [viewerUserId, targetUserId, sourceMessageId, visibility, ownershipCode] = segs;
  if (visibility !== "e" && visibility !== "p") return null;
  return {
    viewerUserId,
    targetUserId,
    sourceMessageId,
    isEphemeral: visibility === "e",
    ownershipType: ownershipCodeToType(ownershipCode),
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
    buildButtonRow(
      buildActionButton(
        "edit",
        buildCollectionFilterPanelActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          sourceMessageId: params.sourceMessageId,
          isEphemeral: params.isEphemeral,
          action: "text",
        }),
        "Edit Text",
      ),
      buildActionButton({
        customId: buildCollectionFilterPanelActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          sourceMessageId: params.sourceMessageId,
          isEphemeral: params.isEphemeral,
          action: "ownership",
        }),
        label: `Ownership: ${params.ownershipType ?? "Any"}`,
        style: ButtonStyle.Secondary,
      }),
      buildActionButton(
        "confirm",
        buildCollectionFilterPanelActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          sourceMessageId: params.sourceMessageId,
          isEphemeral: params.isEphemeral,
          action: "apply",
        }),
        "Apply",
      ),
      buildActionButton({
        customId: buildCollectionFilterPanelActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          sourceMessageId: params.sourceMessageId,
          isEphemeral: params.isEphemeral,
          action: "clear",
        }),
        label: "Clear",
        style: ButtonStyle.Secondary,
      }),
      buildActionButton({
        customId: buildCollectionFilterPanelActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          sourceMessageId: params.sourceMessageId,
          isEphemeral: params.isEphemeral,
          action: "cancel",
        }),
        label: "Cancel",
        style: ButtonStyle.Danger,
      }),
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
    platformId: isPositiveInt(platformId) ? platformId : undefined,
    ownershipType,
  };
}

function logCollectionListNavDebug(
  event: string,
  details: Record<string, unknown>,
): void {
  logInfo("CollectionListNavDebug", { event, details });
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
      logError("CollectionListNavDebug.componentInvalid", {
        ...context,
        componentIndex: index,
        componentType: String((component as any)?.constructor?.name ?? "unknown"),
        messages: flattenErrorMessages(error),
      });
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
  logInfo("collection-list", { step: "searchEntries start", targetUserId: params.targetUserId });
  const entries = await UserGameCollection.searchEntries({
    targetUserId: params.targetUserId,
    title: params.title,
    platform: params.platform,
    platformId: params.platformId,
    ownershipType: params.ownershipType,
  });
  logInfo("collection-list", { step: "searchEntries done", count: entries.length });

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

  const filtersText = [
    params.title ? `title~${params.title}` : null,
    params.platformLabel ? `platform~${params.platformLabel}` : null,
    params.platformId ? `platform-id=${params.platformId}` : null,
    params.ownershipType ? `ownership=${params.ownershipType}` : null,
  ].filter(Boolean).join(" | ");

  const listText = pageEntries
    .map((entry) => {
      const platform = entry.platformName ?? "Unknown";
      return `**${safeV2TextContent(entry.title, 100)}** · ${platform} · ${entry.ownershipType}`;
    })
    .join("\n");

  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];

  components.push(
    buildUserHeaderContainer(params.targetUserId, params.memberLabel, "Game Collection"),
  );

  components.push(
    buildTextContainer(safeV2TextContent(listText, 3500)),
  );

  const footerParts = [`Page ${safePage + 1}/${pageCount}`, `${total} total entries`];
  if (filtersText) {
    footerParts.push(`Filters: ${filtersText}`);
  }
  components.push(
    buildTextContainer(safeV2TextContent(`-# ${footerParts.join(" | ")}`, 1000)),
  );

  const row = buildDisabledPrevNextRowWithIds(
    buildCollectionListNavId({
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      page: safePage,
      isEphemeral: params.isEphemeral,
      direction: "prev",
    }),
    buildCollectionListNavId({
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      page: safePage,
      isEphemeral: params.isEphemeral,
      direction: "next",
    }),
    safePage,
    pageCount,
  ) ?? buildButtonRow();

  row.addComponents(
    buildActionButton({
      customId: buildCollectionFilterActionId({
        viewerUserId: params.viewerUserId,
        targetUserId: params.targetUserId,
        isEphemeral: params.isEphemeral,
        action: "open",
      }),
      label: "Filter Results",
      style: ButtonStyle.Primary,
    }),
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

  logInfo("collection-list", { step: "components built", count: components.length });
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
  safeIgnore((interaction.message as any)?.delete?.());
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
