import type { Client, TextBasedChannel } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  Routes,
} from "discord.js";
import { ContainerBuilder } from "@discordjs/builders";
import { countAvailableGameKeys, listAvailableGameKeys } from "../classes/GameKey.js";
import { BOT_DEV_CHANNEL_ID, GIVEAWAY_HUB_CHANNEL_ID } from "../config/channels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import type { FeatureState, IFeatureFlagSource } from "../functions/FeatureGate.js";
import { routeFeaturePostFor } from "./FeaturePostRouting.js";
import { buildPageFooterText } from "../functions/PaginationUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import { buildActionButton, buildButtonRow } from "../functions/uiComponents.js";
import {
  buildTitledContainer,
  buildComponentsV2EditFlags,
} from "../functions/ComponentsV2Utils.js";
const GIVEAWAY_HUB_SCAN_LIMIT = 50;

/**
 * The hub message the bot last posted or found in each channel, so a busy channel (bot-dev,
 * where the hub lives while Giveaways is in Preview) never has to find it by scanning its
 * latest messages. Lost on restart, when the scan finds the hub again.
 */
const hubMessageIds = new Map<string, string>();

export const KEYS_PAGE_SIZE = 20;

type GiveawayHubPayload = {
  containers: ContainerBuilder[];
  actionRows: ActionRowBuilder<ButtonBuilder>[];
};

type GiveawayMessage = {
  id: string;
  channelId: string;
  createdTimestamp: number;
  delete: () => Promise<unknown>;
  author?: { id?: string };
  components?: Array<{ components?: Array<{ customId?: string }> }>;
};

export function buildKeyListEmbed(
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
  page: number,
  totalPages: number,
  totalCount: number,
): ContainerBuilder {
  if (!keys.length) {
    return buildTitledContainer(
      "Game Key Giveaway",
      "No keys are available right now.",
      { footer: buildPageFooterText(page, totalPages, `${totalCount} total`) },
    );
  }

  const lines = keys.map((key, idx) => {
    const number = page * KEYS_PAGE_SIZE + idx + 1;
    return `${number}. **${key.gameTitle}** (${key.platform})`;
  });

  return buildTitledContainer(
    "Game Key Giveaway",
    lines.join("\n"),
    { footer: buildPageFooterText(page, totalPages, `${totalCount} total`) },
  );
}

function buildGiveawayHubContainers(
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
): ContainerBuilder[] {
  if (!keys.length) {
    return [];
  }

  const lines = keys.map((key, idx) =>
    `${idx + 1}. **${key.gameTitle}** (${key.platform})`,
  );

  const containers: ContainerBuilder[] = [];
  let chunk: string[] = [];
  let chunkLen = 0;
  const CHUNK_MAX = 3000;

  for (const line of lines) {
    if (chunkLen + line.length + 1 > CHUNK_MAX && chunk.length > 0) {
      const isFirst = containers.length === 0;
      containers.push(buildTitledContainer(
        isFirst ? "Game Key Giveaway" : "Game Key Giveaway (continued)",
        chunk.join("\n"),
      ));
      chunk = [];
      chunkLen = 0;
    }
    chunk.push(line);
    chunkLen += line.length + 1;
  }

  if (chunk.length > 0) {
    const isFirst = containers.length === 0;
    containers.push(buildTitledContainer(
      isFirst ? "Game Key Giveaway" : "Game Key Giveaway (continued)",
      chunk.join("\n"),
      { footer: `Total keys: ${keys.length}` },
    ));
  }

  return containers;
}

export async function getAvailableKeysPage(page: number): Promise<{
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>;
  totalCount: number;
  totalPages: number;
  safePage: number;
}> {
  const totalCount = await countAvailableGameKeys();
  if (totalCount === 0) {
    return { keys: [], totalCount: 0, totalPages: 1, safePage: 0 };
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / KEYS_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * KEYS_PAGE_SIZE;
  const keys = await listAvailableGameKeys(offset, KEYS_PAGE_SIZE);
  return { keys, totalCount, totalPages, safePage };
}

export async function listAllAvailableKeys(): Promise<
  Awaited<ReturnType<typeof listAvailableGameKeys>>
> {
  const totalCount = await countAvailableGameKeys();
  if (!totalCount) {
    return [];
  }

  const keys: Awaited<ReturnType<typeof listAvailableGameKeys>> = [];
  for (let offset = 0; offset < totalCount; offset += KEYS_PAGE_SIZE) {
    const batch = await listAvailableGameKeys(offset, KEYS_PAGE_SIZE);
    keys.push(...batch);
  }

  return keys;
}

function buildGiveawayHubComponents(hasKeys: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const claimButton = buildActionButton({
    customId: "giveaway-hub-claim:0",
    label: "Claim a Game",
    style: ButtonStyle.Primary,
  }).setDisabled(!hasKeys);

  const donateButton = buildActionButton({
    customId: "giveaway-hub-donate",
    label: "Donate a Game",
    style: ButtonStyle.Success,
  });

  const donorSettingsButton = buildActionButton({
    customId: "giveaway-hub-settings",
    label: "Donor Settings",
    style: ButtonStyle.Secondary,
  });

  return [buildButtonRow(claimButton, donateButton, donorSettingsButton)];
}

async function buildGiveawayHubPayload(page: number): Promise<GiveawayHubPayload> {
  void page;
  const keys = await listAllAvailableKeys();
  if (!keys.length) {
    return {
      containers: [buildTitledContainer("Game Key Giveaway", "There are no available game keys right now.")],
      actionRows: buildGiveawayHubComponents(false),
    };
  }

  return {
    containers: buildGiveawayHubContainers(keys),
    actionRows: buildGiveawayHubComponents(true),
  };
}

// Pages backwards with `before` so a message that cannot be deleted is never refetched,
// and stops at the first page holding no hub message.
export async function deleteGiveawayHubMessages(
  client: Client,
  channel: TextBasedChannel,
): Promise<void> {
  const tracked = await fetchTrackedHub(client, channel);
  hubMessageIds.delete(channel.id);
  if (tracked) {
    await tracked.delete().catch((err) => {
      logError("GiveawayHubService.cleanupDelete", err);
    });
  }
  let before: string | undefined;
  for (;;) {
    const fetched = await channel.messages
      .fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT, ...(before ? { before } : {}) })
      .catch((err) => {
        logError("GiveawayHubService.cleanupFetch", err);
        return null;
      });
    const page = fetched
      ? Array.from(fetched.values(), (message) => message as GiveawayMessage)
      : [];
    if (!page.length) {
      return;
    }

    const hubMessages = page.filter((message) => isGiveawayHubMessage(client, message));
    if (!hubMessages.length) {
      return;
    }
    for (const message of hubMessages) {
      await message.delete().catch((err) => {
        logError("GiveawayHubService.cleanupDelete", err);
      });
    }

    if (page.length < GIVEAWAY_HUB_SCAN_LIMIT) {
      return;
    }
    before = page.reduce((oldest, message) =>
      message.createdTimestamp < oldest.createdTimestamp ? message : oldest,
    ).id;
  }
}

function isGiveawayHubMessage(client: Client, message: GiveawayMessage): boolean {
  if (message.author?.id !== client.user?.id) {
    return false;
  }

  return message.components?.some((row) =>
    row.components?.some((component) =>
      typeof component.customId === "string" &&
      component.customId.startsWith("giveaway-hub"),
    ),
  ) ?? false;
}

/** The hub this channel's id points at, if it is still there. */
async function fetchTrackedHub(
  client: Client,
  channel: TextBasedChannel,
): Promise<GiveawayMessage | null> {
  const messageId = hubMessageIds.get(channel.id);
  if (!messageId) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message && isGiveawayHubMessage(client, message as GiveawayMessage)) {
    return message as GiveawayMessage;
  }
  hubMessageIds.delete(channel.id);
  return null;
}

async function updateGiveawayHubMessages(
  client: Client,
  channel: TextBasedChannel,
  payload: GiveawayHubPayload,
  options?: { suppressNotifications?: boolean; throwOnFailure?: boolean },
): Promise<void> {
  if (!("send" in channel)) {
    return;
  }
  const strict = options?.throwOnFailure ?? false;

  const messages = await channel.messages
    .fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT })
    .catch((err: unknown) => {
      if (strict) throw err;
      logError("GiveawayHubService.fetch", err);
      return null;
    });
  const scanned = messages
    ? Array.from(messages.values(), (message) => message as GiveawayMessage)
      .filter((message) => isGiveawayHubMessage(client, message))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    : [];
  const tracked = await fetchTrackedHub(client, channel);
  const hubMessages = tracked
    ? [tracked, ...scanned.filter((message) => message.id !== tracked.id)]
    : scanned;

  const allComponents = [...payload.containers, ...payload.actionRows];
  const existing = hubMessages[0];
  if (existing) {
    hubMessageIds.set(channel.id, existing.id);
    const hubMsg = existing as GiveawayMessage;
    await client.rest.patch(
      Routes.channelMessage(hubMsg.channelId, hubMsg.id),
      {
        body: {
          embeds: [],
          components: allComponents.map((c) => c.toJSON()),
          flags: buildComponentsV2EditFlags(),
        },
      },
    ).catch((err: unknown) => {
      if (strict) throw err;
      logError("GiveawayHubService.edit", err);
    });
  } else {
    const sent: { id: string } | null = await (channel as any).send({
      components: allComponents,
      flags: options?.suppressNotifications
        ? MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications
        : MessageFlags.IsComponentsV2,
    }).catch((err: unknown) => {
      if (strict) throw err;
      logError("GiveawayHubService.send", err);
      return null;
    });
    if (sent) hubMessageIds.set(channel.id, sent.id);
  }

  const extras = hubMessages.slice(1);
  for (const extra of extras) {
    await extra.delete().catch((err) => {
      logError("GiveawayHubService.delete", err);
    });
  }
}

/**
 * Removes the Preview hub from the bot-dev channel: the one this process posted or found,
 * and any its latest messages hold. For when Giveaways leaves Preview.
 */
export async function removePreviewGiveawayHub(client: Client): Promise<void> {
  if (GIVEAWAY_HUB_CHANNEL_ID === BOT_DEV_CHANNEL_ID) return;
  const channel = await client.channels.fetch(BOT_DEV_CHANNEL_ID).catch((err: unknown) => {
    logError("GiveawayHubService.previewChannelFetch", err);
    return null;
  });
  if (!channel?.isTextBased()) return;
  await deleteGiveawayHubMessages(client, channel);
}

/**
 * Re-renders the giveaway hub where the Giveaways Feature's flag routes it: the hub channel
 * when Live, the bot-dev channel in Preview, and nowhere when Off (the hub channel's hub is
 * left as it is). Out of Preview, a Preview hub this process left in bot-dev is removed.
 */
export async function refreshGiveawayHubMessage(
  client: Client,
  page = 0,
  options?: {
    forceRecreate?: boolean;
    throwOnFailure?: boolean;
    /** The Giveaways Feature's state when already read (a bot job's); else it is read. */
    featureState?: FeatureState | null;
    /** Where the flag state is read; the shared flag cache unless a test passes one. */
    featureFlags?: IFeatureFlagSource;
  },
): Promise<void> {
  // A bot job must fail when the hub was not refreshed; other callers only log it.
  const strict = options?.throwOnFailure ?? false;
  const skip = (message: string): void => {
    if (strict) throw new Error(message);
    logWarn("GiveawayHubService.updateHub", message);
  };
  if (!client.user) {
    skip("The bot is not logged in, so the giveaway hub was not refreshed.");
    return;
  }

  const hubChannelId = await routeFeaturePostFor(
    POST_FEATURE_KEYS.giveawayHub,
    GIVEAWAY_HUB_CHANNEL_ID,
    { state: options?.featureState, source: options?.featureFlags },
  );
  if (hubChannelId !== BOT_DEV_CHANNEL_ID && hubMessageIds.has(BOT_DEV_CHANNEL_ID)) {
    await removePreviewGiveawayHub(client);
  }
  if (!hubChannelId) return;

  const channel = await client.channels
    .fetch(hubChannelId)
    .catch((err: unknown) => {
      if (strict) throw err;
      logError("GiveawayHubService.channelFetch", err);
      return null;
    });
  const textChannel = channel?.isTextBased() ? channel : null;
  if (!textChannel) {
    skip(`Giveaway hub channel ${hubChannelId} not found or not text-based.`);
    return;
  }

  const payload = await buildGiveawayHubPayload(page);
  const shouldRecreate = options?.forceRecreate ?? false;
  if (shouldRecreate) {
    if (!("send" in textChannel)) {
      skip("Giveaway hub channel does not support send.");
      return;
    }
    await deleteGiveawayHubMessages(client, textChannel);
    await updateGiveawayHubMessages(client, textChannel, payload, {
      suppressNotifications: true,
      throwOnFailure: strict,
    });
    return;
  }

  await updateGiveawayHubMessages(client, textChannel, payload, { throwOnFailure: strict });
}

export async function recreateGiveawayHubMessage(client: Client): Promise<void> {
  await refreshGiveawayHubMessage(client, 0, { forceRecreate: true });
}
