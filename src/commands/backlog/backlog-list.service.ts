import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
} from "discord.js";
import UserGameBacklog from "../../classes/UserGameBacklog.js";
import { safeV2TextContent } from "../../functions/ComponentsV2Utils.js";
import { safeDeferUpdate } from "../../functions/InteractionUtils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import {
  buildPaginatedUserListResponse,
  buildUserListNavId,
  parseUserListNavId,
} from "../../functions/PaginationUtils.js";
import {
  encodeVisibility,
  decodeVisibility,
  parseCustomIdSegments,
} from "../../utilities/CustomIdUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import {
  BACKLOG_LIST_NAV_PREFIX,
  BACKLOG_LIST_FILTER_PREFIX,
  BACKLOG_LIST_FILTER_MODAL_PREFIX,
} from "../../config/customIdPrefixes.js";
import { BACKLOG_LIST_PAGE_SIZE } from "../../config/pagination.js";

export const BACKLOG_FILTER_TITLE_INPUT_ID = "backlog-filter-title";

export function buildBacklogListNavId(params: {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
}): string {
  return buildUserListNavId(BACKLOG_LIST_NAV_PREFIX, params);
}

export function parseBacklogListNavId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
} | null {
  return parseUserListNavId(BACKLOG_LIST_NAV_PREFIX, customId);
}

export function buildBacklogFilterActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
}): string {
  return [
    BACKLOG_LIST_FILTER_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    encodeVisibility(params.isEphemeral),
    "open",
  ].join(":");
}

export function parseBacklogFilterActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
} | null {
  if (!customId.startsWith(`${BACKLOG_LIST_FILTER_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [viewerUserId, targetUserId, visibility, action] = segs;
  if (action !== "open") return null;
  const isEphemeral = decodeVisibility(visibility);
  if (isEphemeral === null) return null;
  return { viewerUserId, targetUserId, isEphemeral };
}

export function buildBacklogFilterModalId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
}): string {
  return [
    BACKLOG_LIST_FILTER_MODAL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    encodeVisibility(params.isEphemeral),
  ].join(":");
}

export function parseBacklogFilterModalId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
} | null {
  if (!customId.startsWith(`${BACKLOG_LIST_FILTER_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 4);
  if (!segs) return null;
  const [viewerUserId, targetUserId, sourceMessageId, visibility] = segs;
  const isEphemeral = decodeVisibility(visibility);
  if (isEphemeral === null) return null;
  return { viewerUserId, targetUserId, sourceMessageId, isEphemeral };
}

export function buildBacklogFilterPanelContent(title: string | undefined): string {
  const titleText = title ?? "(any)";
  return (
    "### Filter backlog\n" +
    `> Title: ${titleText}\n\n` +
    "Use **Edit Title** to filter by game name, then **Apply**."
  );
}

export function buildBacklogFilterPanelButtons(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
}): ActionRowBuilder<ButtonBuilder>[] {
  const base = {
    viewerUserId: params.viewerUserId,
    targetUserId: params.targetUserId,
    sourceMessageId: params.sourceMessageId,
    isEphemeral: params.isEphemeral,
  };
  const editId = ["backlog-filter-panel", params.viewerUserId, params.targetUserId,
    params.sourceMessageId, encodeVisibility(params.isEphemeral), "text"].join(":");
  const applyId = ["backlog-filter-panel", params.viewerUserId, params.targetUserId,
    params.sourceMessageId, encodeVisibility(params.isEphemeral), "apply"].join(":");
  const clearId = ["backlog-filter-panel", params.viewerUserId, params.targetUserId,
    params.sourceMessageId, encodeVisibility(params.isEphemeral), "clear"].join(":");
  const cancelId = ["backlog-filter-panel", params.viewerUserId, params.targetUserId,
    params.sourceMessageId, encodeVisibility(params.isEphemeral), "cancel"].join(":");
  void base;
  return [
    buildButtonRow(
      buildActionButton("edit", editId, "Edit Title"),
      buildActionButton("confirm", applyId, "Apply"),
      buildActionButton({ customId: clearId, label: "Clear", style: ButtonStyle.Secondary }),
      buildActionButton({ customId: cancelId, label: "Cancel", style: ButtonStyle.Secondary }),
    ),
  ];
}

export const BACKLOG_FILTER_PANEL_PREFIX = "backlog-filter-panel";

export function parseBacklogFilterPanelActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "apply" | "clear" | "cancel";
} | null {
  if (!customId.startsWith(`${BACKLOG_FILTER_PANEL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 5);
  if (!segs) return null;
  const [viewerUserId, targetUserId, sourceMessageId, visibility, actionCode] = segs;
  const isEphemeral = decodeVisibility(visibility);
  if (isEphemeral === null) return null;
  const action = actionCode === "text" ? "text"
    : actionCode === "apply" ? "apply"
    : actionCode === "clear" ? "clear"
    : actionCode === "cancel" ? "cancel"
    : null;
  if (!action) return null;
  return { viewerUserId, targetUserId, sourceMessageId, isEphemeral, action };
}

export function parseBacklogFilterStateFromContent(content: string): {
  title: string | undefined;
} {
  const match = content.match(/^> Title:\s*(.+)$/mi);
  const value = match?.[1]?.trim();
  return { title: value && value !== "(any)" ? value : undefined };
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

export function parseBacklogFiltersFromListMessage(message: any): {
  title: string | undefined;
} {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const filterBlock = textBlocks.find((b) => b.includes("Filter:"));
  if (!filterBlock) return { title: undefined };
  const titleMatch = filterBlock.match(/title~([^|\n]+)/i);
  return { title: titleMatch?.[1]?.trim() || undefined };
}

export async function buildBacklogListResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  title: string | undefined;
  page: number;
  isEphemeral: boolean;
}): Promise<{ components: Array<any>; content?: string }> {
  const allEntries = await UserGameBacklog.listForUser(params.targetUserId);

  const filtered = params.title
    ? allEntries.filter((e) =>
      e.title.toLowerCase().includes(params.title!.toLowerCase()),
    )
    : allEntries;

  const total = filtered.length;
  if (!total) {
    const msg = params.title
      ? "No backlog entries matched your filter."
      : params.targetUserId === params.viewerUserId
        ? "Your backlog is empty."
        : "That member has no backlog entries.";
    return { content: msg, components: [] };
  }

  const pageCount = Math.max(1, Math.ceil(total / BACKLOG_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(params.page, 0), pageCount - 1);
  const start = safePage * BACKLOG_LIST_PAGE_SIZE;
  const pageEntries = filtered.slice(start, start + BACKLOG_LIST_PAGE_SIZE);

  const listText = pageEntries
    .map((entry) => {
      const platform = entry.platformName ?? "No platform";
      const noteTag = entry.note ? ` · _${safeV2TextContent(entry.note, 60)}_` : "";
      return `**${safeV2TextContent(entry.title, 100)}** · ${platform}${noteTag}`;
    })
    .join("\n");

  const footerParts = [`Page ${safePage + 1}/${pageCount}`, `${total} total entries`];
  if (params.title) footerParts.push(`Filter: title~${params.title}`);

  const components = buildPaginatedUserListResponse({
    headerUserId: params.targetUserId,
    headerLabel: params.memberLabel,
    headerTitle: "Game Backlog",
    bodyText: listText,
    footerParts,
    prevCustomId: buildBacklogListNavId({
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      page: safePage,
      isEphemeral: params.isEphemeral,
      direction: "prev",
    }),
    nextCustomId: buildBacklogListNavId({
      viewerUserId: params.viewerUserId,
      targetUserId: params.targetUserId,
      page: safePage,
      isEphemeral: params.isEphemeral,
      direction: "next",
    }),
    page: safePage,
    pageCount,
    extraButtons: [
      buildActionButton({
        customId: buildBacklogFilterActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          isEphemeral: params.isEphemeral,
        }),
        label: "Filter",
        style: ButtonStyle.Primary,
      }),
    ],
  });

  // eslint-disable-next-line local/dynamic-components-require-chunking
  return { components };
}

export async function applyBacklogFiltersToSourceMessage(params: {
  interaction: ButtonInteraction;
  sourceMessageId: string;
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  title: string | undefined;
}): Promise<boolean> {
  const channel = params.interaction.channel;
  if (!channel || !("messages" in channel)) return false;

  const memberLabel = params.targetUserId === params.viewerUserId
    ? params.interaction.user.globalName ?? params.interaction.user.username
    : "Member";

  const response = await buildBacklogListResponse({
    viewerUserId: params.viewerUserId,
    targetUserId: params.targetUserId,
    memberLabel,
    title: params.title,
    page: 0,
    isEphemeral: params.isEphemeral,
  });

  const sourceMessage = await (channel as any).messages
    .fetch(params.sourceMessageId)
    .catch(() => null);
  if (!sourceMessage) return false;

  if (response.content) {
    await sourceMessage.edit({ content: response.content, components: [] });
  } else {
    await sourceMessage.edit({ content: null, components: response.components });
  }
  return true;
}

export async function closeBacklogFilterPanel(
  interaction: ButtonInteraction,
): Promise<void> {
  await safeDeferUpdate(interaction);
  safeIgnore((interaction.message as any)?.delete?.());
}
