import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  userMention,
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
  getModalField,
} from "../functions/InteractionUtils.js";
import {
  buildTextReply,
  buildTextContainer,
  buildTitledContainer,
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
} from "../functions/ComponentsV2Utils.js";
import {
  buildOptionalPrevNextRow,
  parseDirAndPage,
} from "../functions/PaginationUtils.js";
import { ContainerBuilder } from "@discordjs/builders";
import {
  claimGameKey,
  createGameKey,
  getGameKeyById,
  listAvailableGameKeys,
  listKeysByDonor,
  revokeGameKey,
} from "../classes/GameKey.js";
import Member from "../classes/Member.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import {
  buildKeyListEmbed,
  getAvailableKeysPage,
  listAllAvailableKeys,
  refreshGiveawayHubMessage,
} from "../services/GiveawayHubService.js";
import { GIVEAWAY_HUB_CHANNEL_ID, GIVEAWAY_LOG_CHANNEL_ID } from "../config/channels.js";
import { MEMBER_ROLE_ID } from "../config/roles.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { COLOR_SUCCESS } from "../config/colors.js";
import { CLAIM_MENU_CHUNK_SIZE } from "../config/pagination.js";
import {
  GIVEAWAY_MAX_TITLE_LENGTH,
  GIVEAWAY_MAX_PLATFORM_LENGTH,
  GIVEAWAY_MAX_KEY_LENGTH,
} from "../config/textLimits.js";
import { assertCustomIdSegments, parseCustomIdSegmentsMin } from "../utilities/CustomIdUtils.js";
import {
  buildActionButton,
  buildSelectOptions,
  buildTextInputRow,
  buildButtonRow,
  buildSelectRow,
} from "../functions/uiComponents.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";
const GIVEAWAY_DONATE_MODAL_ID = "giveaway-donate-modal";
const GIVEAWAY_REVOKE_MODAL_ID = "giveaway-revoke-modal";
const GIVEAWAY_DONATE_TITLE_ID = "giveaway-donate-title";
const GIVEAWAY_DONATE_PLATFORM_ID = "giveaway-donate-platform";
const GIVEAWAY_DONATE_KEY_ID = "giveaway-donate-key";
const GIVEAWAY_REVOKE_KEY_ID = "giveaway-revoke-key-id";
const GIVEAWAY_DONOR_SETTINGS_ID = "giveaway-hub-settings";
const GIVEAWAY_DONOR_NOTIFY_ID = "giveaway-donor-notify";

type GiveawayListPayload = {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>)[];
  flags: number;
};

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
    const options = buildSelectOptions(chunk.map((key) => ({
      label: key.gameTitle,
      value: String(key.keyId),
    })));
    const range = getKeyRangeLabel(chunk);
    const select = new StringSelectMenuBuilder()
       
      .setCustomId(`${customIdPrefix}:${rows.length}`)
      .setPlaceholder(`Claim a key... (${range})`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);
    rows.push(buildSelectRow(select));
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
    `${userMention(userId)} claimed **${keyTitle}** (${platform}) [Key ID: ${keyId}].`;
  if (channel && typeof channel.send === "function") {
    const container = buildTitledContainer("Giveaway claim", message, { color: COLOR_SUCCESS });
    safeIgnore(channel.send({ components: [container], flags: buildComponentsV2EditFlags() }));
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

  if (trimmedTitle.length > GIVEAWAY_MAX_TITLE_LENGTH) {
    return { error: `Title must be ${GIVEAWAY_MAX_TITLE_LENGTH} characters or fewer.` };
  }

  if (trimmedPlatform.length > GIVEAWAY_MAX_PLATFORM_LENGTH) {
    return { error: `Platform must be ${GIVEAWAY_MAX_PLATFORM_LENGTH} characters or fewer.` };
  }

  if (trimmedKey.length > GIVEAWAY_MAX_KEY_LENGTH) {
    return { error: `Key must be ${GIVEAWAY_MAX_KEY_LENGTH} characters or fewer.` };
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
  const yesButton = buildActionButton({ customId: confirmId, label: "Yes", style: ButtonStyle.Success });
  const noButton = buildActionButton({ customId: cancelId, label: "No", style: ButtonStyle.Secondary });
  return [buildButtonRow(yesButton, noButton)];
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
  const yesButton = buildActionButton({
    customId: `${GIVEAWAY_DONOR_NOTIFY_ID}:${userId}:yes`,
    label: "Yes",
    style: ButtonStyle.Success,
  }).setDisabled(enabled);
  const noButton = buildActionButton({
    customId: `${GIVEAWAY_DONOR_NOTIFY_ID}:${userId}:no`,
    label: "No",
    style: ButtonStyle.Secondary,
  }).setDisabled(!enabled);
  return buildButtonRow(yesButton, noButton);
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
  const donorName = donorUser?.username ?? userMention(key.donorUserId);
  const notifyDonor = await Member.getGiveawayDonorNotifySetting(key.donorUserId);
  if (notifyDonor && donorUser && key.donorUserId !== interaction.user.id) {
    const claimantMention = userMention(interaction.user.id);
    safeIgnore(donorUser.send({
      content:
        `Your donated key for **${key.gameTitle}** (${key.platform}) was claimed by ` +
        `${claimantMention}. Thanks for contributing!`,
    }));
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
  return new ModalBuilder()

    .setCustomId(GIVEAWAY_DONATE_MODAL_ID)
    .setTitle("Donate a Game Key")
    .addComponents(
      buildTextInputRow({ customId: GIVEAWAY_DONATE_TITLE_ID, label: "Game title", maxLength: GIVEAWAY_MAX_TITLE_LENGTH }),
      buildTextInputRow({ customId: GIVEAWAY_DONATE_PLATFORM_ID, label: "Platform (Steam, Epic, GOG, etc.)", maxLength: GIVEAWAY_MAX_PLATFORM_LENGTH }),
      buildTextInputRow({ customId: GIVEAWAY_DONATE_KEY_ID, label: "Game key", maxLength: GIVEAWAY_MAX_KEY_LENGTH }),
    );
}

function buildRevokeModal(): ModalBuilder {
  return new ModalBuilder()

    .setCustomId(GIVEAWAY_REVOKE_MODAL_ID)
    .setTitle("Revoke a Game Key")
    .addComponents(buildTextInputRow({ customId: GIVEAWAY_REVOKE_KEY_ID, label: "Key ID" }));
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
      const claimButton = buildActionButton({
        customId: `giveaway-claim-button:${sessionId}:${page}`,
        label: "Claim a key",
        style: ButtonStyle.Primary,
      });
      rows.push(buildButtonRow(claimButton));
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
      components: [buildTitledContainer("Game Key Giveaway", "There are no available game keys right now.")],
      flags: buildComponentsV2EditFlags(),
    };
  }

  const container = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
  const actionRows = buildKeyListComponents(
    sessionId,
    ownerId,
    safePage,
    totalPages,
    keys,
    isPublic,
  );
  return { components: [container, ...actionRows], flags: buildComponentsV2EditFlags() };
}

async function updateKeyListInteraction(
  interaction: ButtonInteraction,
  sessionId: string,
  ownerId: string,
  page: number,
  isPublic: boolean,
): Promise<void> {
  const payload = await buildKeyListPayload(page, sessionId, ownerId, isPublic);
  await safeUpdate(interaction, payload);
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

  safeIgnore(message.edit(payload));
}

@Discord()
export class GiveawayCommand {
  /*
  @Slash({ description: "List available donated game keys", name: "list" })
  async listKeys(
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    const sessionId = `giveaway-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const payload = await buildKeyListPayload(
      0,
      sessionId,
      interaction.user.id,
      !(privateFlag ?? false),
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
      safeIgnore(refreshGiveawayHubMessage(interaction.client));
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
      safeIgnore(refreshGiveawayHubMessage(interaction.client));
    }
  }
  */
   
  @ButtonComponent({ id: /^giveaway-page:[^:]+:\d+:\d+:(prev|next)$/ })
  async handlePage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [sessionId, ownerId, pageRaw, dir] = segs;
    if (await replyIfNotOwner(interaction, ownerId)) return;

    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    await updateKeyListInteraction(interaction, sessionId, ownerId, parsed.nextPage, false);
  }
   
  @ButtonComponent({ id: /^giveaway-page-public:[^:]+:\d+:(prev|next)$/ })
  async handlePublicPage(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [sessionId, pageRaw, dir] = segs;
    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    await updateKeyListInteraction(
      interaction, sessionId, interaction.user.id, parsed.nextPage, true);
  }
   
  @ButtonComponent({ id: /^giveaway-hub-claim:\d+$/ })
  async handleHubClaim(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [pageRaw] = segs;
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
      components: [
        buildTextContainer("Pick a key to claim:"),
        ...buildKeySelectMenus(`giveaway-hub-claim-select:${interaction.user.id}`, keys),
      ],
      flags: buildComponentsV2Flags(true),
    });
  }
   
  @ButtonComponent({ id: "giveaway-hub-donate" })
  async handleHubDonate(interaction: ButtonInteraction): Promise<void> {
    safeIgnore(interaction.showModal(buildDonateModal()));
  }
   
  @ButtonComponent({ id: GIVEAWAY_DONOR_SETTINGS_ID })
  async handleDonorSettings(interaction: ButtonInteraction): Promise<void> {
    const enabled = await Member.getGiveawayDonorNotifySetting(interaction.user.id);
    const donatedKeys = await listKeysByDonor(interaction.user.id);
    const inventory = buildDonorInventorySummary(donatedKeys);
    await safeReply(interaction, {
      components: [
        buildTextContainer(
          [
            "Your donated keys:",
            inventory,
            "",
            "Notify you when your donated keys are claimed? " +
              `Current setting: **${formatDonorNotifyStatus(enabled)}**.`,
          ].join("\n"),
        ),
        buildDonorSettingsRow(interaction.user.id, enabled),
      ],
      flags: buildComponentsV2Flags(true),
    });
  }
   
  @ButtonComponent({ id: "giveaway-hub-revoke" })
  async handleHubRevoke(interaction: ButtonInteraction): Promise<void> {
    safeIgnore(interaction.showModal(buildRevokeModal()));
  }
   
  @ButtonComponent({ id: /^giveaway-donor-notify:\d+:(yes|no)$/ })
  async handleDonorNotifyUpdate(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [ownerId, choice] = segs;
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
    const segs = assertCustomIdSegments(interaction, 2);
    if (!segs) return;
    const [sessionId, pageRaw] = segs;
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

    const claimContainer = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
    const claimSelectRows = buildKeySelectMenus(
      `giveaway-claim-public:${sessionId}:${safePage}:${interaction.message.id}:${interaction.user.id}`,
      keys,
    );
    await safeReply(interaction, {
      components: [claimContainer, ...claimSelectRows],
      flags: buildComponentsV2Flags(true),
    });
  }
   
  @SelectMenuComponent({ id: /^giveaway-claim:[^:]+:\d+:\d+:\d+$/ })
  async handleClaim(interaction: StringSelectMenuInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 3);
    if (!segs) return;
    const [sessionId, ownerId, pageRaw] = segs;
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
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [userId] = segs;
    if (await replyIfNotOwner(interaction, userId, "This giveaway claim isn't for you.")) return;

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
    const segs = assertCustomIdSegments(interaction, 4);
    if (!segs) return;
    const [sessionId, pageRaw, messageId, userId] = segs;
    if (await replyIfNotOwner(interaction, userId, "This giveaway claim isn't for you.")) return;

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
    const segs = parseCustomIdSegmentsMin(interaction.customId, 4);
    if (!segs) return;
    const [scope, keyIdStr, pageStr, ...extraSegs] = segs;
    const keyId = Number(keyIdStr);
    const page = Number(pageStr);

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
      const userId = extraSegs[0];
      if (await replyIfNotOwner(interaction, userId, "This giveaway claim isn't for you.")) return;
    }

    if (scope === "private") {
      const ownerId = extraSegs[1];
      if (await replyIfNotOwner(interaction, ownerId)) return;
    }

    if (scope === "public") {
      const userId = extraSegs[2];
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
      const sessionId = extraSegs[0];
      const messageId = extraSegs[1];
      const ownerId = extraSegs[2];
      await updatePublicListMessage(
        interaction as unknown as StringSelectMenuInteraction,
        sessionId,
        ownerId,
        page,
        messageId,
      );
    }

    safeIgnore(refreshGiveawayHubMessage(interaction.client));
  }
   
  @ButtonComponent({ id: /^giveaway-claim-cancel:\d+$/ })
  async handleClaimCancel(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [userId] = segs;
    if (await replyIfNotOwner(interaction, userId, "This giveaway claim isn't for you.")) return;

    await safeUpdate(interaction, {
      content: "Claim cancelled.",
      embeds: [],
      components: [],
    });
  }
   
  @ModalComponent({ id: GIVEAWAY_DONATE_MODAL_ID })
  async handleDonateModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const title = getModalField(interaction, GIVEAWAY_DONATE_TITLE_ID);
    const platform = getModalField(interaction, GIVEAWAY_DONATE_PLATFORM_ID);
    const keyValue = getModalField(interaction, GIVEAWAY_DONATE_KEY_ID);

    const created = await handleDonation(interaction, title, platform, keyValue);
    if (created) {
      safeIgnore(refreshGiveawayHubMessage(interaction.client));
    }
  }
   
  @ModalComponent({ id: GIVEAWAY_REVOKE_MODAL_ID })
  async handleRevokeModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const keyIdInput = getModalField(interaction, GIVEAWAY_REVOKE_KEY_ID);
    const keyId = Number(keyIdInput);
    if (Number.isNaN(keyId)) {
      await safeReply(interaction, buildTextReply("Invalid key id.", true));
      return;
    }

    const removed = await handleRevoke(interaction, keyId);
    if (removed) {
      safeIgnore(refreshGiveawayHubMessage(interaction.client));
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
