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
import { GIVEAWAY_HUB_CHANNEL_ID } from "../config/channels.js";
import { buildPageFooterText } from "../functions/PaginationUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";
import { buildActionButton, buildButtonRow } from "../functions/uiComponents.js";
import {
  buildTitledContainer,
  buildComponentsV2EditFlags,
} from "../functions/ComponentsV2Utils.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
const GIVEAWAY_HUB_SCAN_LIMIT = 50;

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

async function deleteAllGiveawayHubMessages(
  channel: TextBasedChannel,
): Promise<void> {
  let fetched = await channel.messages.fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT }).catch(() => null);
  while (fetched && fetched.size) {
    for (const message of fetched.values()) {
      safeIgnore(message.delete());
    }
    fetched = await channel.messages.fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT }).catch(() => null);
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

async function updateGiveawayHubMessages(
  client: Client,
  channel: TextBasedChannel,
  payload: GiveawayHubPayload,
  options?: { suppressNotifications?: boolean },
): Promise<void> {
  if (!("send" in channel)) {
    return;
  }

  const messages = await channel.messages
    .fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT })
    .catch((err) => {
      logError("GiveawayHubService.fetch", err);
      return null;
    });
  const hubMessages = messages
    ? Array.from(messages.values())
      .filter((message) => isGiveawayHubMessage(client, message as GiveawayMessage))
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    : [];

  const allComponents = [...payload.containers, ...payload.actionRows];
  const existing = hubMessages[0];
  if (existing) {
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
    ).catch((err) => {
      logError("GiveawayHubService.edit", err);
    });
  } else {
    await (channel as any).send({
      components: allComponents,
      flags: options?.suppressNotifications
        ? COMPONENTS_V2_FLAG | MessageFlags.SuppressNotifications
        : COMPONENTS_V2_FLAG,
    }).catch((err: unknown) => {
      logError("GiveawayHubService.send", err);
    });
  }

  const extras = hubMessages.slice(1);
  for (const extra of extras) {
    await extra.delete().catch((err) => {
      logError("GiveawayHubService.delete", err);
    });
  }
}

export async function refreshGiveawayHubMessage(
  client: Client,
  page = 0,
  options?: { forceRecreate?: boolean },
): Promise<void> {
  if (!client.user) {
    return;
  }

  const channel = await client.channels
    .fetch(GIVEAWAY_HUB_CHANNEL_ID)
    .catch((err) => {
      logError("GiveawayHubService.channelFetch", err);
      return null;
    });
  const textChannel = channel?.isTextBased() ? channel : null;
  if (!textChannel) {
    logWarn(
      "GiveawayHubService.updateHub",
      `Giveaway hub channel ${GIVEAWAY_HUB_CHANNEL_ID} not found or not text-based.`,
    );
    return;
  }

  const payload = await buildGiveawayHubPayload(page);
  const shouldRecreate = options?.forceRecreate ?? false;
  if (shouldRecreate) {
    if (!("send" in textChannel)) {
      logWarn("GiveawayHubService.updateHub", "Giveaway hub channel does not support send.");
      return;
    }
    await deleteAllGiveawayHubMessages(textChannel);
    await updateGiveawayHubMessages(client, textChannel, payload, {
      suppressNotifications: true,
    });
    return;
  }

  await updateGiveawayHubMessages(client, textChannel, payload);
}

export async function recreateGiveawayHubMessage(client: Client): Promise<void> {
  await refreshGiveawayHubMessage(client, 0, { forceRecreate: true });
}
