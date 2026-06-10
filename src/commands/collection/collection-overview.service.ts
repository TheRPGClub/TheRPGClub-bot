import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import UserGameCollection, {
  type IUserGameCollectionOverviewEntry,
} from "../../classes/UserGameCollection.js";
import { COLLECTION_OVERVIEW_EMOJIS } from "../../config/emojis.js";
import {
  buildTextContainer,
  safeV2TextContent,
} from "../../functions/ComponentsV2Utils.js";
import { formatLocalNumber } from "../../functions/DateFormatUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../../utilities/CustomIdUtils.js";

export const COLLECTION_OVERVIEW_SELECT_PREFIX = "collection-overview-select-v1";
const COLLECTION_OVERVIEW_SELECT_OVERVIEW = "overview";
const COLLECTION_OVERVIEW_SELECT_ALL_GAMES = "all-games";
const COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX = "platform";
export const COLLECTION_OVERVIEW_UNKNOWN_PLATFORM = "Unknown platform";
const COLLECTION_OVERVIEW_MAX_TEXT_COMPONENTS_PER_CONTAINER = 34;

export const COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS: Record<
  string,
  keyof typeof COLLECTION_OVERVIEW_EMOJIS
> = {
  "pc (microsoft windows)": "win",
  "pc (steam)": "steam",
  windows: "win",
  "pc (windows)": "win",
  "pc windows": "win",
  win: "win",
  steam: "steam",
  "steam deck": "steam",
  playstation: "ps1",
  "playstation 2": "ps2",
  "playstation 3": "ps3",
  "playstation 4": "ps4",
  "playstation 5": "ps5",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  ps4: "ps4",
  ps5: "ps5",
  xbox: "xbox",
  "xbox 360": "x360",
  "xbox one": "xone",
  "xbox series": "xsx",
  "xbox series x": "xsx",
  "xbox series s": "xsx",
  "xbox series x|s": "xsx",
  nintendo: "nsw",
  "nintendo switch": "nsw",
  "nintendo switch 2": "nsw2",
  nsw: "nsw",
  "switch 2": "nsw2",
  switch: "nsw",
  "pc (epic)": "epic",
  "pc (luna)": "luna",
  ios: "ios",
  iphone: "ios",
  ipad: "ios",
  "mobile (ios)": "ios",
  "mobile ios": "ios",
  browser: "browser",
  "web browser": "browser",
  "web browser:": "browser",
  web: "browser",
  internet: "browser",
  "playstation vita": "vita",
  "ps vita": "vita",
  psvita: "vita",
  psv: "vita",
  vita: "vita",
  wii: "wii",
  "wii u": "wiiu",
  wiiu: "wiiu",
  "new nintendo 3ds": "new3ds",
  "new nintendo 3ds xl": "new3ds",
  "new 3ds": "new3ds",
  n3ds: "new3ds",
  new3ds: "new3ds",
  "nintendo 64": "n64",
  n64: "n64",
  "nintendo 3ds": "3ds",
  "nintendo ds": "ds",
  "game boy": "gb",
  "game boy color": "gbc",
  "game boy advance": "gba",
  "nintendo gamecube": "gc",
  "gamecube (gcn)": "gc",
  gamecube: "gc",
  gcn: "gc",
  gc: "gc",
  gba: "gba",
  gb: "gb",
  gbc: "gbc",
  ds: "ds",
  "3ds": "3ds",
};

function normalizePlatformEmojiKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  return normalized.length ? normalized : null;
}

function resolveCollectionOverviewEmoji(params: {
  platformName: string | null;
  platformAbbreviation: string | null;
}): string | null {
  const nameKey = normalizePlatformEmojiKey(params.platformName);
  const resolvedNameKey = nameKey
    ? COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS[nameKey]
    : undefined;
  if (resolvedNameKey) {
    return COLLECTION_OVERVIEW_EMOJIS[resolvedNameKey] ?? null;
  }
  const abbrevKey = normalizePlatformEmojiKey(params.platformAbbreviation);
  const resolvedAbbrevKey = abbrevKey
    ? COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS[abbrevKey]
    : undefined;
  if (resolvedAbbrevKey) {
    return COLLECTION_OVERVIEW_EMOJIS[resolvedAbbrevKey] ?? null;
  }
  return ":question:";
}

function formatCollectionOverviewPlatformLabel(
  entry: IUserGameCollectionOverviewEntry,
): string {
  const rawName = entry.platformName ??
    entry.platformAbbreviation ??
    COLLECTION_OVERVIEW_UNKNOWN_PLATFORM;
  const displayName = formatPlatformDisplayName(rawName) ?? rawName;
  if (!entry.platformAbbreviation || entry.platformAbbreviation === displayName) {
    return displayName;
  }
  return `${displayName} (${entry.platformAbbreviation})`;
}

function formatCollectionOverviewFixedLabel(label: string, width: number): string {
  return `\`\` ${label.padEnd(width, " ")} \`\``;
}

function formatCollectionOverviewFixedTotal(total: number, width: number): string {
  const formatted = formatLocalNumber(total);
  return `\`\` ${formatted.padStart(width, " ")} \`\``;
}

export function buildCollectionOverviewSelectId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
}): string {
  return [
    COLLECTION_OVERVIEW_SELECT_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.isEphemeral ? "e" : "p",
  ].join(":");
}

export function parseCollectionOverviewSelectId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
} | null {
  if (!customId.startsWith(`${COLLECTION_OVERVIEW_SELECT_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [viewerUserId, targetUserId, visibility] = segs;
  if (visibility !== "e" && visibility !== "p") return null;

  return {
    viewerUserId,
    targetUserId,
    isEphemeral: visibility === "e",
  };
}

export function buildCollectionOverviewSelectValue(platformId: number): string {
  return `${COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX}:${platformId}`;
}

export function parseCollectionOverviewSelectValue(
  value: string,
): { platformId: number } | "overview" | "all-games" | null {
  if (value === COLLECTION_OVERVIEW_SELECT_OVERVIEW) return "overview";
  if (value === COLLECTION_OVERVIEW_SELECT_ALL_GAMES) return "all-games";
  if (!value.startsWith(`${COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(value, 1);
  if (!segs) return null;
  const platformId = Number(segs[0]);
  if (!isPositiveInt(platformId)) return null;
  return { platformId };
}

function buildCollectionOverviewSelectOptions(
  platformCounts: IUserGameCollectionOverviewEntry[],
): Array<{ label: string; value: string; description: string }> {
  const unique = new Map<number, IUserGameCollectionOverviewEntry>();
  for (const entry of platformCounts) {
    if (!entry.platformId) continue;
    unique.set(entry.platformId, entry);
  }
  const ordered = Array.from(unique.values())
    .map((entry) => ({
      entry,
      label: formatCollectionOverviewPlatformLabel(entry),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const options = [{
    label: "Overview",
    value: COLLECTION_OVERVIEW_SELECT_OVERVIEW,
    description: "Show the summary view",
  }, {
    label: "All games",
    value: COLLECTION_OVERVIEW_SELECT_ALL_GAMES,
    description: "View the full collection list",
  }];

  for (const { entry, label } of ordered) {
    const totalText = entry.total === 1 ? "1 game" : `${entry.total} games`;
    options.push({
      label,
      value: buildCollectionOverviewSelectValue(entry.platformId as number),
      description: totalText,
    });
  }

  return options;
}

export async function buildCollectionOverviewResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  isEphemeral: boolean;
  titleOverride?: string;
}): Promise<Array<ContainerBuilder | ActionRowBuilder<any>>> {
  const isSelf = params.viewerUserId === params.targetUserId;
  const overview = await UserGameCollection.getOverviewForUser(params.targetUserId);
  const title = params.titleOverride ??
    (params.isEphemeral
      ? (isSelf ? "Your collection overview" : `${params.memberLabel} collection overview`)
      : `${params.memberLabel}'s Game Collection`);

  const container = buildCollectionOverviewContainer({
    title,
    totalCount: overview.totalCount,
    platformCounts: overview.platformCounts,
  });

  const options = buildCollectionOverviewSelectOptions(overview.platformCounts);
  if (options.length <= 2) {
    return [container];
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(
      buildCollectionOverviewSelectId({
        viewerUserId: params.viewerUserId,
        targetUserId: params.targetUserId,
        isEphemeral: params.isEphemeral,
      }),
    )
    .setPlaceholder("View collection by platform")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return [container, row];
}

export function buildCollectionOverviewContainer(params: {
  title: string;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}): ContainerBuilder {
  const container = buildTextContainer(safeV2TextContent(`## ${params.title}`, 250));

  if (params.totalCount <= 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No collection entries yet."),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(`Total games: **${formatLocalNumber(params.totalCount)}**`, 1000),
    ),
  );

  const platformLabels = params.platformCounts.map((entry) =>
    formatCollectionOverviewPlatformLabel(entry),
  );
  const totals = params.platformCounts.map((entry) => formatLocalNumber(entry.total));
  const labelWidth = platformLabels.length
    ? Math.max(...platformLabels.map((label) => label.length), 8)
    : 8;
  const totalWidth = totals.length
    ? Math.max(...totals.map((value) => value.length), 2)
    : 2;

  for (const entry of params.platformCounts) {
    const emoji = resolveCollectionOverviewEmoji({
      platformName: entry.platformName,
      platformAbbreviation: entry.platformAbbreviation,
    });
    const label = formatCollectionOverviewPlatformLabel(entry);
    const fixedLabel = formatCollectionOverviewFixedLabel(label, labelWidth);
    const fixedTotal = formatCollectionOverviewFixedTotal(entry.total, totalWidth);
    const prefix = emoji ? `${emoji} ` : "";
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`${prefix}**${fixedLabel}** ${fixedTotal}`, 1000),
      ),
    );
  }

  return container;
}

export async function buildAllCollectionsOverviewMessages(): Promise<
  Array<{ components: Array<ContainerBuilder> }>
> {
  const overview = await UserGameCollection.getOverviewForAllUsers();
  const containers = buildAllCollectionsSummaryContainers({
    title: "All Game Collections",
    totalCount: overview.totalCount,
    platformCounts: overview.platformCounts,
  });

  const messages: Array<{ components: Array<ContainerBuilder> }> = containers.map(
    (container) => ({ components: [container] }),
  );

  if (!messages.length) {
    messages.push({
      components: [
        buildCollectionOverviewContainer({
          title: "All Game Collections",
          totalCount: 0,
          platformCounts: [],
        }),
      ],
    });
  }

  return messages;
}

export function buildAllCollectionsSummaryContainers(params: {
  title: string;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}): ContainerBuilder[] {
  const createBaseContainer = (title: string): ContainerBuilder =>
    buildTextContainer(safeV2TextContent(`## ${title}`, 250));

  if (params.totalCount <= 0) {
    const empty = createBaseContainer(params.title);
    empty.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No collection entries yet."),
    );
    return [empty];
  }

  const platformLabels = params.platformCounts.map((entry) =>
    formatCollectionOverviewPlatformLabel(entry),
  );
  const totals = params.platformCounts.map((entry) => formatLocalNumber(entry.total));
  const labelWidth = platformLabels.length
    ? Math.max(...platformLabels.map((label) => label.length), 8)
    : 8;
  const totalWidth = totals.length
    ? Math.max(...totals.map((value) => value.length), 2)
    : 2;

  const lines = params.platformCounts.map((entry) => {
    const emoji = resolveCollectionOverviewEmoji({
      platformName: entry.platformName,
      platformAbbreviation: entry.platformAbbreviation,
    });
    const label = formatCollectionOverviewPlatformLabel(entry);
    const fixedLabel = formatCollectionOverviewFixedLabel(label, labelWidth);
    const fixedTotal = formatCollectionOverviewFixedTotal(entry.total, totalWidth);
    const prefix = emoji ? `${emoji} ` : "";
    return `${prefix}**${fixedLabel}** ${fixedTotal}`;
  });

  const containers: ContainerBuilder[] = [];
  let offset = 0;
  let part = 1;
  while (offset < lines.length) {
    const isFirst = part === 1;
    const title = isFirst ? params.title : `${params.title} (cont. ${part})`;
    const container = createBaseContainer(title);
    if (isFirst) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`Total games: **${formatLocalNumber(params.totalCount)}**`, 1000),
        ),
      );
    }

    const reserved = isFirst ? 2 : 1;
    const capacity = Math.max(
      1,
      COLLECTION_OVERVIEW_MAX_TEXT_COMPONENTS_PER_CONTAINER - reserved,
    );
    const chunk = lines.slice(offset, offset + capacity);
    for (const line of chunk) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(safeV2TextContent(line, 1000)),
      );
    }

    containers.push(container);
    offset += chunk.length;
    part += 1;
  }

  return containers;
}

export function extractOverviewTitleFromMessage(message: any): string | null {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const headerBlock = textBlocks.find((value) => value.trim().startsWith("## "));
  if (!headerBlock) return null;
  const firstLine = headerBlock.split("\n")[0]?.trim();
  if (!firstLine?.startsWith("## ")) return null;
  return firstLine.replace(/^##\s*/, "").trim() || null;
}

export function resolveMemberLabelFromOverviewTitle(title: string, fallback: string): string {
  if (!title) return fallback;
  if (title === "Your collection overview" || title === "Your game collection") {
    return fallback;
  }
  const match = title.match(/^(.*)'s Game Collection$/);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  const overviewMatch = title.match(/^(.*) collection overview$/i);
  if (overviewMatch?.[1]?.trim()) {
    return overviewMatch[1].trim();
  }
  return fallback;
}

function collectTextDisplayContent(components: any[] | undefined, output: string[]): void {
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
