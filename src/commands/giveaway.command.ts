import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
} from "discordx";
import {
  AnyRepliable,
  safeDeferReply,
  safeDeferUpdate,
  replyIfNotOwner,
  safeReply,
  safeUpdate,
  stripModalInput,
} from "../functions/InteractionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import {
  buildOptionalPrevNextRow,
  parseDirAndPage,
} from "../functions/PaginationUtils.js";
import {
  claimGameKey,
  createGameKey,
  getGameKeyById,
  listAvailableGameKeys,
  listKeysByDonor,
  revokeGameKey,
} from "../classes/GameKey.js";
import Member from "../classes/Member.js";
import { isAdmin } from "./admin.command.js";
import {
  buildKeyListEmbed,
  getAvailableKeysPage,
  listAllAvailableKeys,
  refreshGiveawayHubMessage,
} from "../services/GiveawayHubService.js";
import { GIVEAWAY_HUB_CHANNEL_ID, GIVEAWAY_LOG_CHANNEL_ID } from "../config/channels.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

const MAX_TITLE_LENGTH = 200;
const MAX_PLATFORM_LENGTH = 50;
const MAX_KEY_LENGTH = 200;
const MEMBER_ROLE_ID = "747520789003239530";
const GIVEAWAY_DONATE_MODAL_ID = "giveaway-donate-modal";
const GIVEAWAY_REVOKE_MODAL_ID = "giveaway-revoke-modal";
const GIVEAWAY_DONATE_TITLE_ID = "giveaway-donate-title";
const GIVEAWAY_DONATE_PLATFORM_ID = "giveaway-donate-platform";
const GIVEAWAY_DONATE_KEY_ID = "giveaway-donate-key";
const GIVEAWAY_REVOKE_KEY_ID = "giveaway-revoke-key-id";
const GIVEAWAY_DONOR_SETTINGS_ID = "giveaway-hub-settings";
const GIVEAWAY_DONOR_NOTIFY_ID = "giveaway-donor-notify";

type GiveawayListPayload = {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

const CLAIM_MENU_CHUNK_SIZE = 20;

function getKeyRangeLabel(keys: Awaited<ReturnType<typeof listAvailableGameKeys>>): string {
  const startRaw = keys[0]?.gameTitle?.trim()?.[0] ?? "?";
  const endRaw = keys[keys.length - 1]?.gameTitle?.trim()?.[0] ?? "?";
  const start = startRaw.toUpperCase();
  const end = endRaw.toUpperCase();
  return `${start}-${end}`;
}

function buildKeySelectMenus(
  customIdPrefix: string,
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  for (let i = 0; i < keys.length; i += CLAIM_MENU_CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CLAIM_MENU_CHUNK_SIZE);
    if (!chunk.length) {
      continue;
    }
    const options = chunk.map((key) => ({
      label: key.gameTitle.slice(0, 100),
      value: String(key.keyId),
    }));
    const range = getKeyRangeLabel(chunk);
    const select = new StringSelectMenuBuilder()
       
      .setCustomId(`${customIdPrefix}:${rows.length}`)
      .setPlaceholder(`Claim a key... (${range})`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  return rows;
}

function hasMemberRole(member: any): boolean {
  const roleCache = member?.roles?.cache;
  return Boolean(roleCache?.has(MEMBER_ROLE_ID));
}

async function logGiveawayClaim(
  channel: any,
  userId: string,
  keyTitle: string,
  platform: string,
  keyId: number,
): Promise<void> {
  const message =
    `<@${userId}> claimed **${keyTitle}** (${platform}) [Key ID: ${keyId}].`;
  if (channel && typeof channel.send === "function") {
    const embed = new EmbedBuilder()
      .setTitle("Giveaway claim")
      .setDescription(message)
      .setColor(0x2ecc71)
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

type ClaimResult =
  | {
    status: "claimed";
    key: {
      keyId: number;
      keyTitle: string;
      platform: string;
      keyValue: string;
      donorName: string;
    };
  }
  | { status: "unavailable" };

type DonationInput =
  | {
    trimmedTitle: string;
    trimmedPlatform: string;
    trimmedKey: string;
  }
  | { error: string };

function normalizeDonationInput(
  title: string,
  platform: string,
  keyValue: string,
): DonationInput {
  const trimmedTitle = title.trim();
  const trimmedPlatform = platform.trim();
  const trimmedKey = keyValue.trim();

  if (!trimmedTitle || !trimmedPlatform || !trimmedKey) {
    return { error: "Title, platform, and key are all required." };
  }

  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    return { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  if (trimmedPlatform.length > MAX_PLATFORM_LENGTH) {
    return { error: `Platform must be ${MAX_PLATFORM_LENGTH} characters or fewer.` };
  }

  if (trimmedKey.length > MAX_KEY_LENGTH) {
    return { error: `Key must be ${MAX_KEY_LENGTH} characters or fewer.` };
  }

  return { trimmedTitle, trimmedPlatform, trimmedKey };
}

async function handleDonation(
  interaction: AnyRepliable,
  title: string,
  platform: string,
  keyValue: string,
): Promise<boolean> {
  const normalized = normalizeDonationInput(title, platform, keyValue);
  if ("error" in normalized) {
    await safeReply(interaction, buildTextReply(normalized.error, true));
    return false;
  }

  const created = await createGameKey(
    normalized.trimmedTitle,
    normalized.trimmedPlatform,
    normalized.trimmedKey,
    interaction.user.id,
  );

  await safeReply(interaction, buildTextReply(
    `Thanks! Added **${created.gameTitle}** (${created.platform}) to the giveaway pool ` +
    `(Key ID: ${created.keyId}).`,
    true,
  ));
  return true;
}

async function handleRevoke(interaction: AnyRepliable, keyId: number): Promise<boolean> {
  if (!isPositiveInt(keyId)) {
    await safeReply(interaction, buildTextReply("Invalid key id.", true));
    return false;
  }

  const key = await getGameKeyById(keyId);
  if (!key) {
    await safeReply(interaction, buildTextReply("No key found with that id.", true));
    return false;
  }

  const isDonor = key.donorUserId === interaction.user.id;
  if (!isDonor) {
    const isAdminUser = await isAdmin(interaction);
    if (!isAdminUser) {
      return false;
    }
  }

  const removed = await revokeGameKey(keyId);
  await safeReply(interaction, buildTextReply(
    removed
      ? `Removed **${key.gameTitle}** (${key.platform}) from the giveaway pool.`
      : "Could not remove that key.",
    true,
  ));

  return Boolean(removed);
}

function buildClaimConfirmContent(keyTitle: string, platform: string): string {
  return `You are about to claim **${keyTitle}** (${platform}). Are you sure?`;
}

function buildClaimConfirmComponents(
  confirmId: string,
  cancelId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const yesButton = new ButtonBuilder()
     
    .setCustomId(confirmId)
    .setLabel("Yes")
    .setStyle(ButtonStyle.Success);
  const noButton = new ButtonBuilder()
     
    .setCustomId(cancelId)
    .setLabel("No")
    .setStyle(ButtonStyle.Secondary);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton)];
}

function buildDonorInventorySummary(keys: Awaited<ReturnType<typeof listKeysByDonor>>): string {
  if (!keys.length) {
    return "You have not donated any keys yet.";
  }
  const availableKeys = keys.filter((key) => !key.claimedByUserId);
  if (!availableKeys.length) {
    return "You do not have any available donated keys right now.";
  }
  const lines = availableKeys.map((key) => {
    return `• **${key.gameTitle}** (${key.platform})`;
  });
  return lines.join("\n");
}

function formatDonorNotifyStatus(enabled: boolean): string {
  return enabled ? "On" : "Off";
}

function buildDonorSettingsRow(
  userId: string,
  enabled: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const yesButton = new ButtonBuilder()
     
    .setCustomId(`${GIVEAWAY_DONOR_NOTIFY_ID}:${userId}:yes`)
    .setLabel("Yes")
    .setStyle(ButtonStyle.Success)
    .setDisabled(enabled);
  const noButton = new ButtonBuilder()
     
    .setCustomId(`${GIVEAWAY_DONOR_NOTIFY_ID}:${userId}:no`)
    .setLabel("No")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!enabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton);
}

async function claimKey(
  interaction: AnyRepliable,
  keyId: number,
): Promise<ClaimResult> {
  const key = await getGameKeyById(keyId);
  if (!key || key.claimedByUserId) {
    return { status: "unavailable" };
  }

  const claimed = await claimGameKey(keyId, interaction.user.id);
  if (!claimed) {
    return { status: "unavailable" };
  }

  const logChannel = await interaction.client.channels
    .fetch(GIVEAWAY_LOG_CHANNEL_ID)
    .catch(() => null);
  const textChannel = logChannel?.isTextBased() ? logChannel : null;
  await logGiveawayClaim(
    textChannel,
    interaction.user.id,
    key.gameTitle,
    key.platform,
    key.keyId,
  );

  const donorUser = await interaction.client.users
    .fetch(key.donorUserId)
    .catch(() => null);
  const donorName = donorUser?.username ?? `<@${key.donorUserId}>`;
  const notifyDonor = await Member.getGiveawayDonorNotifySetting(key.donorUserId);
  if (notifyDonor && donorUser && key.donorUserId !== interaction.user.id) {
    const claimantMention = `<@${interaction.user.id}>`;
    await donorUser.send({
      content:
        `Your donated key for **${key.gameTitle}** (${key.platform}) was claimed by ` +
        `${claimantMention}. Thanks for contributing!`,
    }).catch(() => {});
  }

  return {
    status: "claimed",
    key: {
      keyId: key.keyId,
      keyTitle: key.gameTitle,
      platform: key.platform,
      keyValue: key.keyValue,
      donorName,
    },
  };
}

function buildDonateModal(): ModalBuilder {
  const titleInput = new TextInputBuilder()
     
    .setCustomId(GIVEAWAY_DONATE_TITLE_ID)
    .setLabel("Game title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_TITLE_LENGTH);
  const platformInput = new TextInputBuilder()
     
    .setCustomId(GIVEAWAY_DONATE_PLATFORM_ID)
    .setLabel("Platform (Steam, Epic, GOG, etc.)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_PLATFORM_LENGTH);
  const keyInput = new TextInputBuilder()
     
    .setCustomId(GIVEAWAY_DONATE_KEY_ID)
    .setLabel("Game key")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(MAX_KEY_LENGTH);

  return new ModalBuilder()
     
    .setCustomId(GIVEAWAY_DONATE_MODAL_ID)
    .setTitle("Donate a Game Key")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(platformInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput),
    );
}

function buildRevokeModal(): ModalBuilder {
  const keyIdInput = new TextInputBuilder()
     
    .setCustomId(GIVEAWAY_REVOKE_KEY_ID)
    .setLabel("Key ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
     
    .setCustomId(GIVEAWAY_REVOKE_MODAL_ID)
    .setTitle("Revoke a Game Key")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(keyIdInput));
}

function buildKeyListComponents(
  sessionId: string,
  ownerId: string,
  page: number,
  totalPages: number,
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
  isPublic: boolean,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (keys.length) {
    if (isPublic) {
      const claimButton = new ButtonBuilder()
         
        .setCustomId(`giveaway-claim-button:${sessionId}:${page}`)
        .setLabel("Claim a key")
        .setStyle(ButtonStyle.Primary);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(claimButton));
    } else {
      const selectRows = buildKeySelectMenus(
        `giveaway-claim:${sessionId}:${ownerId}:${page}`,
        keys,
      );
      rows.push(...selectRows);
    }
  }

  const pageBase = isPublic
    ? `giveaway-page-public:${sessionId}`
    : `giveaway-page:${sessionId}:${ownerId}`;
  const pageRow = buildOptionalPrevNextRow(pageBase, page, totalPages);
  if (pageRow) rows.push(pageRow);

  return rows;
}

async function buildKeyListPayload(
  page: number,
  sessionId: string,
  ownerId: string,
  isPublic: boolean,
): Promise<GiveawayListPayload> {
  const { keys, totalCount, totalPages, safePage } = await getAvailableKeysPage(page);
  if (!totalCount || !keys.length) {
    return {
      content: "There are no available game keys right now.",
      embeds: [],
      components: [],
    };
  }

  const embed = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
  const components = buildKeyListComponents(
    sessionId,
    ownerId,
    safePage,
    totalPages,
    keys,
    isPublic,
  );
  // eslint-disable-next-line local/dynamic-components-require-chunking
  return { embeds: [embed], components };
}

async function updateKeyListInteraction(
  interaction: ButtonInteraction,
  sessionId: string,
  ownerId: string,
  page: number,
  isPublic: boolean,
): Promise<void> {
  const payload = await buildKeyListPayload(page, sessionId, ownerId, isPublic);
  if (payload.content) {
    await safeUpdate(interaction, {
      content: payload.content,
      embeds: [],
      components: [],
    });
    return;
  }

  await safeUpdate(interaction, {
    embeds: payload.embeds,
    components: payload.components,
  });
}

async function updatePublicListMessage(
  interaction: StringSelectMenuInteraction,
  sessionId: string,
  ownerId: string,
  page: number,
  messageId: string,
): Promise<void> {
  const payload = await buildKeyListPayload(page, sessionId, ownerId, true);
  if (!interaction.channelId) {
    return;
  }

  const channel = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
  const textChannel = channel?.isTextBased() ? channel : null;
  if (!textChannel) {
    return;
  }

  const message = await textChannel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    return;
  }

  if (payload.content) {
    await message.edit({
      content: payload.content,
      embeds: [],
      components: [],
    }).catch(() => {});
    return;
  }

  await message.edit({
    embeds: payload.embeds,
    components: payload.components,
  }).catch(() => {});
}

@Discord()
export class GiveawayCommand {
  /*
  @Slash({ description: "List available donated game keys", name: "list" })
  async listKeys(
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await deferWithShowInChat(interaction, showInChat);

    const sessionId = `giveaway-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const payload = await buildKeyListPayload(
      0,
      sessionId,
      interaction.user.id,
      Boolean(showInChat),
    );

    await safeReply(interaction, {
      ...payload,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @Slash({ description: "Donate a game key to the giveaway pool", name: "donate" })
  async donateKey(
    @SlashOption({
      description: "Game title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Digital platform (Steam, Epic, GOG, etc.)",
      name: "platform",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    platform: string,
    @SlashOption({
      description: "The key to give away",
      name: "key",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    keyValue: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    title = sanitizeUserInput(title, { preserveNewlines: false });
    platform = sanitizeUserInput(platform, { preserveNewlines: false });
    keyValue = sanitizeUserInput(keyValue, { preserveNewlines: false });
    const created = await handleDonation(interaction, title, platform, keyValue);
    if (created) {
      await refreshGiveawayHubMessage(interaction.client).catch(() => {});
    }
  }

  @Slash({ description: "Revoke a donated game key", name: "revoke" })
  async revokeKey(
    @SlashOption({
      description: "Key ID to revoke",
      name: "key_id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    keyId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const removed = await handleRevoke(interaction, keyId);
    if (removed) {
      await refreshGiveawayHubMessage(interaction.client).catch(() => {});
    }
  }
  */
   
  @ButtonComponent({ id: /^giveaway-page:[^:]+:\d+:\d+:(prev|next)$/ })
  async handlePage(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, ownerId, pageRaw, dir] = interaction.customId.split(":");
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    await updateKeyListInteraction(interaction, sessionId, ownerId, parsed.nextPage, false);
  }
   
  @ButtonComponent({ id: /^giveaway-page-public:[^:]+:\d+:(prev|next)$/ })
  async handlePublicPage(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, pageRaw, dir] = interaction.customId.split(":");
    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    await updateKeyListInteraction(
      interaction, sessionId, interaction.user.id, parsed.nextPage, true);
  }
   
  @ButtonComponent({ id: /^giveaway-hub-claim:\d+$/ })
  async handleHubClaim(interaction: ButtonInteraction): Promise<void> {
    const [, pageRaw] = interaction.customId.split(":");
    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply("Claiming keys requires the Member role.", true));
      return;
    }

    const keys = await listAllAvailableKeys();
    if (!keys.length) {
      await safeReply(interaction, buildTextReply(
        "There are no available game keys right now.",
        true,
      ));
      return;
    }

    await safeReply(interaction, {
      content: "Pick a key to claim:",
      components: buildKeySelectMenus(
        `giveaway-hub-claim-select:${interaction.user.id}`,
        keys,
      ),
      flags: MessageFlags.Ephemeral,
    });
  }
   
  @ButtonComponent({ id: "giveaway-hub-donate" })
  async handleHubDonate(interaction: ButtonInteraction): Promise<void> {
    await interaction.showModal(buildDonateModal()).catch(() => {});
  }
   
  @ButtonComponent({ id: GIVEAWAY_DONOR_SETTINGS_ID })
  async handleDonorSettings(interaction: ButtonInteraction): Promise<void> {
    const enabled = await Member.getGiveawayDonorNotifySetting(interaction.user.id);
    const donatedKeys = await listKeysByDonor(interaction.user.id);
    const inventory = buildDonorInventorySummary(donatedKeys);
    await safeReply(interaction, {
      content:
        [
          "Your donated keys:",
          inventory,
          "",
          "Notify you when your donated keys are claimed? " +
            `Current setting: **${formatDonorNotifyStatus(enabled)}**.`,
        ].join("\n"),
      components: [buildDonorSettingsRow(interaction.user.id, enabled)],
      flags: MessageFlags.Ephemeral,
    });
  }
   
  @ButtonComponent({ id: "giveaway-hub-revoke" })
  async handleHubRevoke(interaction: ButtonInteraction): Promise<void> {
    await interaction.showModal(buildRevokeModal()).catch(() => {});
  }
   
  @ButtonComponent({ id: /^giveaway-donor-notify:\d+:(yes|no)$/ })
  async handleDonorNotifyUpdate(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, choice] = interaction.customId.split(":");
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const enabled = choice === "yes";
    await Member.setGiveawayDonorNotifySetting(interaction.user.id, enabled);
    const donatedKeys = await listKeysByDonor(interaction.user.id);
    const inventory = buildDonorInventorySummary(donatedKeys);
    await safeUpdate(interaction, {
      content:
        [
          "Your donated keys:",
          inventory,
          "",
          "Notify you when your donated keys are claimed? " +
            `Current setting: **${formatDonorNotifyStatus(enabled)}**.`,
        ].join("\n"),
      components: [buildDonorSettingsRow(interaction.user.id, enabled)],
    });
  }
   
  @ButtonComponent({ id: /^giveaway-claim-button:[^:]+:\d+$/ })
  async handleClaimButton(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, pageRaw] = interaction.customId.split(":");
    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply("Claiming keys requires the Member role.", true));
      return;
    }

    const { keys, totalCount, totalPages, safePage } = await getAvailableKeysPage(page);
    if (!totalCount || !keys.length) {
      await safeReply(interaction, buildTextReply(
        "There are no available game keys right now.",
        true,
      ));
      return;
    }

    await safeReply(interaction, {
      content: "Pick a key to claim:",
      embeds: [buildKeyListEmbed(keys, safePage, totalPages, totalCount)],
      components: buildKeySelectMenus(
        `giveaway-claim-public:${sessionId}:${safePage}:${interaction.message.id}:${interaction.user.id}`,
        keys,
      ),
      flags: MessageFlags.Ephemeral,
    });
  }
   
  @SelectMenuComponent({ id: /^giveaway-claim:[^:]+:\d+:\d+:\d+$/ })
  async handleClaim(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId, ownerId, pageRaw] = interaction.customId.split(":");
    if (await replyIfNotOwner(interaction, ownerId)) return;

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply("Claiming keys requires the Member role.", true));
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    const keyId = Number(interaction.values?.[0]);
    if (!isPositiveInt(keyId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const key = await getGameKeyById(keyId);
    if (!key || key.claimedByUserId) {
      await safeUpdate(interaction, {
        content: "That key is no longer available.",
        embeds: [],
        components: [],
      });
      return;
    }

    const confirmId = `giveaway-claim-confirm:private:${keyId}:${page}:${sessionId}:${ownerId}`;
    const cancelId = `giveaway-claim-cancel:${interaction.user.id}`;
    await safeUpdate(interaction, {
      content: buildClaimConfirmContent(key.gameTitle, key.platform),
      embeds: [],
      components: buildClaimConfirmComponents(confirmId, cancelId),
    });
  }
   
  @SelectMenuComponent({ id: /^giveaway-hub-claim-select:\d+:\d+$/ })
  async handleHubClaimSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, userId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await safeReply(interaction, buildTextReply("This giveaway claim isn't for you.", true));
      return;
    }

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply("Claiming keys requires the Member role.", true));
      return;
    }

    const page = 0;

    const keyId = Number(interaction.values?.[0]);
    if (!isPositiveInt(keyId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const key = await getGameKeyById(keyId);
    if (!key || key.claimedByUserId) {
      await safeUpdate(interaction, {
        content: "That key is no longer available.",
        embeds: [],
        components: [],
      });
      return;
    }

    const confirmId = `giveaway-claim-confirm:hub:${keyId}:${page}:${interaction.user.id}`;
    const cancelId = `giveaway-claim-cancel:${interaction.user.id}`;
    await safeUpdate(interaction, {
      content: buildClaimConfirmContent(key.gameTitle, key.platform),
      embeds: [],
      components: buildClaimConfirmComponents(confirmId, cancelId),
    });
  }
   
  @SelectMenuComponent({ id: /^giveaway-claim-public:[^:]+:\d+:\d+:\d+:\d+$/ })
  async handlePublicClaim(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId, pageRaw, messageId, userId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await safeReply(interaction, buildTextReply("This giveaway claim isn't for you.", true));
      return;
    }

    if (!hasMemberRole(interaction.member)) {
      await safeReply(interaction, buildTextReply("Claiming keys requires the Member role.", true));
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    const keyId = Number(interaction.values?.[0]);
    if (!isPositiveInt(keyId)) {
      await safeReply(interaction, buildTextReply("Invalid selection.", true));
      return;
    }

    const key = await getGameKeyById(keyId);
    if (!key || key.claimedByUserId) {
      await safeUpdate(interaction, {
        content: "That key is no longer available.",
        embeds: [],
        components: [],
      });
      return;
    }

    const confirmId =
      `giveaway-claim-confirm:public:${keyId}:${page}:${sessionId}:${messageId}:${userId}`;
    const cancelId = `giveaway-claim-cancel:${interaction.user.id}`;
    await safeUpdate(interaction, {
      content: buildClaimConfirmContent(key.gameTitle, key.platform),
      embeds: [],
      components: buildClaimConfirmComponents(confirmId, cancelId),
    });
  }
   
  @ButtonComponent({ id: /^giveaway-claim-confirm:(hub|private|public):/ })
  async handleClaimConfirm(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const scope = parts[1];
    const keyId = Number(parts[2]);
    const page = Number(parts[3]);

    if (!isPositiveInt(keyId)) {
      await safeUpdate(interaction, {
        content: "Invalid selection.",
        embeds: [],
        components: [],
      });
      return;
    }

    if (!hasMemberRole(interaction.member)) {
      await safeUpdate(interaction, {
        content: "Claiming keys requires the Member role.",
        embeds: [],
        components: [],
      });
      return;
    }

    if (scope === "hub") {
      const userId = parts[4];
      if (interaction.user.id !== userId) {
        await safeReply(interaction, buildTextReply("This giveaway claim isn't for you.", true));
        return;
      }
    }

    if (scope === "private") {
      const ownerId = parts[5];
      if (await replyIfNotOwner(interaction, ownerId)) return;
    }

    if (scope === "public") {
      const userId = parts[6];
      if (await replyIfNotOwner(interaction, userId)) return;
    }

    await safeDeferUpdate(interaction);
    const result = await claimKey(interaction, keyId);
    if (result.status === "unavailable") {
      await safeReply(interaction, buildTextReply("That key is no longer available.", false));
      return;
    }

    await safeReply(interaction, buildTextReply("Sending your key by DM now.", false));

    const dmResult = await interaction.user
      .send({
        content:
          `You claimed **${result.key.keyTitle}** (${result.key.platform}).\n` +
          `Key: \`${result.key.keyValue}\`\n` +
          `This key was donated by ${result.key.donorName}, be sure to thank them!`,
      })
      .catch(() => null);

    if (dmResult) {
      await safeReply(interaction, {
        ...buildTextReply("Your key was sent by DM. Thanks for claiming responsibly.", false),
        __forceFollowUp: true,
      });
    } else {
      await safeReply(interaction, {
        ...buildTextReply(
          "I could not send you a DM. Please enable DMs and contact an admin to resend your key.",
          false,
        ),
        __forceFollowUp: true,
      });
    }

    if (scope === "public") {
      const sessionId = parts[4];
      const messageId = parts[5];
      const ownerId = parts[6];
      await updatePublicListMessage(
        interaction as unknown as StringSelectMenuInteraction,
        sessionId,
        ownerId,
        page,
        messageId,
      );
    }

    await refreshGiveawayHubMessage(interaction.client)
      .catch(() => {});
  }
   
  @ButtonComponent({ id: /^giveaway-claim-cancel:\d+$/ })
  async handleClaimCancel(interaction: ButtonInteraction): Promise<void> {
    const [, userId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await safeReply(interaction, buildTextReply("This giveaway claim isn't for you.", true));
      return;
    }

    await safeUpdate(interaction, {
      content: "Claim cancelled.",
      embeds: [],
      components: [],
    });
  }
   
  @ModalComponent({ id: GIVEAWAY_DONATE_MODAL_ID })
  async handleDonateModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const title = stripModalInput(interaction.fields.getTextInputValue(GIVEAWAY_DONATE_TITLE_ID));
    const platform = stripModalInput(
      interaction.fields.getTextInputValue(GIVEAWAY_DONATE_PLATFORM_ID),
    );
    const keyValue = stripModalInput(interaction.fields.getTextInputValue(GIVEAWAY_DONATE_KEY_ID));

    const created = await handleDonation(interaction, title, platform, keyValue);
    if (created) {
      await refreshGiveawayHubMessage(interaction.client).catch(() => {});
    }
  }
   
  @ModalComponent({ id: GIVEAWAY_REVOKE_MODAL_ID })
  async handleRevokeModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const keyIdInput = stripModalInput(
      interaction.fields.getTextInputValue(GIVEAWAY_REVOKE_KEY_ID),
    );
    const keyId = Number(keyIdInput);
    if (Number.isNaN(keyId)) {
      await safeReply(interaction, buildTextReply("Invalid key id.", true));
      return;
    }

    const removed = await handleRevoke(interaction, keyId);
    if (removed) {
      await refreshGiveawayHubMessage(interaction.client).catch(() => {});
    }
  }
}

@Discord()
export class GiveawayRedirectCommand {
  @Slash({ description: "Go to the giveaway hub", name: "gamegiveaway" })
  async redirect(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId;
    const link = guildId
      ? `https://discord.com/channels/${guildId}/${GIVEAWAY_HUB_CHANNEL_ID}`
      : `https://discord.com/channels/@me/${GIVEAWAY_HUB_CHANNEL_ID}`;
    await safeReply(interaction, buildTextReply(
      `Use the giveaway hub here: ${link}`,
      true,
    ));
  }
}
