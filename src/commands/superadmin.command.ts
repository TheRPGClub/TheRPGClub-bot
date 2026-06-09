import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { ButtonInteraction, CommandInteraction, User } from "discord.js";
import axios from "axios";
import crypto from "node:crypto";
import {
  ButtonComponent,
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
  SelectMenuComponent,
  SlashChoice,
} from "discordx";
import {
  AnyRepliable,
  extractErrorMessage,
  safeDeferReply,
  safeDeferUpdate,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import Member, { type IMemberRecord } from "../classes/Member.js";
import Game, { type IGame } from "../classes/Game.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "./profile.command.js";
import {
  notifyUnknownCompletionPlatform,
  saveCompletion,
} from "../functions/CompletionHelpers.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

type CompletionAddContext = {
  targetUserId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note?: string | null;
  source: "existing" | "igdb";
  query?: string;
  announce?: boolean;
};

const superadminCompletionAddSessions = new Map<string, CompletionAddContext>();
type CompletionPlatformContext = CompletionAddContext & {
  userId: string;
  gameId: number;
  gameTitle: string;
  platforms: Array<{ id: number; name: string }>;
};
const superadminCompletionPlatformSessions = new Map<string, CompletionPlatformContext>();
const SUPERADMIN_COMPLETION_PLATFORM_SELECT_PREFIX = "sa-comp-platform-select";

type SuperAdminHelpTopicId =
  | "memberscan"
  | "completion-add-other"
  | "say";

type SuperAdminHelpTopic = {
  id: SuperAdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

export const SUPERADMIN_HELP_TOPICS: SuperAdminHelpTopic[] = [
  {
    id: "completion-add-other",
    label: "/superadmin completion-add-other",
    summary: "Add a game completion for another user.",
    syntax: "Syntax: /superadmin completion-add-other user:<user> completion_type:<type> title:<string> [completion_date:<string>] [final_playtime_hours:<number>] [announce:<bool>]",
    notes: "Uses a search query to find or import the game, then prompts for a platform.",
  },
  {
    id: "memberscan",
    label: "/superadmin memberscan",
    summary: "Scan the server and refresh member records in the database.",
    syntax: "Syntax: /superadmin memberscan",
    notes: "Runs in the current server. Make sure env role IDs are set so roles classify correctly.",
  },
  {
    id: "say",
    label: "/superadmin say",
    summary: "Have the bot send a message or reply to a message.",
    syntax:
      "Syntax: /superadmin say message:<string> [message_id:<string>] [channel_id:<string>]",
    notes:
      "If message_id is provided, the bot replies in that channel. If not, channel_id is required.",
  },
];

function buildSuperAdminHelpButtons(
  activeId?: SuperAdminHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("superadmin-help-select")
    .setPlaceholder("/superadmin help")
    .addOptions(
      SUPERADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

type ImageBufferResult = { buffer: Buffer; mimeType: string | null };

function buildStableSuperAdminSessionId(prefix: string, parts: string[]): string {
  const hash = crypto.createHash("sha256");
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  hash.update(parts.join(":"));
  return `${prefix}-${hash.digest("hex").slice(0, 16)}`;
}

async function downloadImageBuffer(url: string): Promise<ImageBufferResult> {
  const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const mime = resp.headers?.["content-type"] ?? null;
  return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
}

export function buildSuperAdminHelpEmbed(topic: SuperAdminHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
  
  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

@Discord()
@SlashGroup({ description: "Server Owner Commands", name: "superadmin" })
@SlashGroup("superadmin")
export class SuperAdmin {
  @Slash({ description: "Add a game completion for another user", name: "completion-add-other" })
  async completionAddOther(
    @SlashOption({
      description: "User to add completion for",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashChoice(
      ...COMPLETION_TYPES.map((t) => ({
        name: t,
        value: t,
      })),
    )
    @SlashOption({
      description: "Type of completion",
      name: "completion_type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    completionType: CompletionType,
    @SlashOption({
      description: "Search text to find/import the game",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    query: string,
    @SlashOption({
      description: "Completion date (defaults to today)",
      name: "completion_date",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionDate: string | undefined,
    @SlashOption({
      description: "Final playtime in hours (e.g., 12.5)",
      name: "final_playtime_hours",
      required: false,
      type: ApplicationCommandOptionType.Number,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      description: "Announce this completion in the completions channel?",
      name: "announce",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    announce: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    if (!COMPLETION_TYPES.includes(completionType)) {
      await safeReply(interaction, buildTextReply("Invalid completion type.", true));
      return;
    }

    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
    const normalizedDate = completionDate
      ? sanitizeUserInput(completionDate, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(normalizedDate ?? "today");
    } catch (err: any) {
      await safeReply(interaction, buildTextReply(err?.message ?? "Invalid completion date.", true));
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await safeReply(interaction, buildTextReply("Final playtime must be a non-negative number of hours.", true));
      return;
    }

    const playtime = finalPlaytimeHours === undefined ? null : finalPlaytimeHours;

    await this.promptCompletionSelection(interaction, searchTerm, {
      targetUserId: user.id,
      completionType,
      completedAt,
      finalPlaytimeHours: playtime,
      source: "existing",
      query: searchTerm,
      announce,
    });
  }

  @SelectMenuComponent({ id: /^sa-comp-add-select:.+/ })
  async handleSuperAdminCompletionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const ctx = superadminCompletionAddSessions.get(sessionId);

    if (!ctx) {
      await safeReply(interaction, buildTextReply("This completion prompt has expired.", true))
        .catch(() => {});
      return;
    }

    // Since it's admin, we check if the interaction user is an admin, not necessarily the context target user
    const okToUseCommand: boolean = await isSuperAdmin(interaction as any);
    if (!okToUseCommand) return;

    const value = interaction.values?.[0];
    if (!value) {
      await safeReply(interaction, buildTextReply("No selection received.", true)).catch(() => {});
      return;
    }

    await safeDeferUpdate(interaction);

    try {
      await this.processCompletionSelection(interaction, value, ctx);
    } finally {
      superadminCompletionAddSessions.delete(sessionId);
      try {
        await safeReply(interaction, { components: [] }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  @SelectMenuComponent({ id: /^sa-comp-platform-select:.+/ })
  async handleSuperAdminCompletionPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const ctx = superadminCompletionPlatformSessions.get(sessionId);

    if (!ctx) {
      await safeReply(interaction, buildTextReply("This completion prompt has expired.", true)).catch(() => {});
      return;
    }

    const okToUseCommand: boolean = await isSuperAdmin(interaction as any);
    if (!okToUseCommand) return;

    if (interaction.user.id !== ctx.userId) {
      await safeReply(interaction, buildTextReply("This completion prompt isn't for you.", true)).catch(() => {});
      return;
    }

    const selected = interaction.values?.[0];
    const isOther = selected === "other";
    let platformId: number | null = null;
    if (!isOther) {
      const parsedId = Number(selected);
      if (Number.isInteger(parsedId)) {
        platformId = parsedId;
      }
    }
    const valid = isOther || (
      platformId !== null &&
      ctx.platforms.some((platform) => platform.id === platformId)
    );
    if (!valid) {
      await safeReply(interaction, buildTextReply("Invalid platform selection.", true)).catch(() => {});
      return;
    }

    await safeDeferUpdate(interaction);
    superadminCompletionPlatformSessions.delete(sessionId);

    const game = await Game.getGameById(ctx.gameId);
    if (!game) {
      await safeReply(interaction, { ...buildTextReply("Selected game was not found in GameDB.", true), __forceFollowUp: true });
      return;
    }

    if (isOther) {
      await notifyUnknownCompletionPlatform(interaction, game.title, game.id);
    }
    await this.saveCompletionForContext(interaction, ctx, game, platformId);
    await safeReply(interaction, { components: [] });
  }

  private async promptCompletionSelection(
    interaction: AnyRepliable,
    searchTerm: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
    const localResults = await Game.searchGames(searchTerm);
    if (localResults.length) {
      const sessionId = buildStableSuperAdminSessionId("sacomp", [
        interaction.id,
        ctx.targetUserId,
        ctx.completionType,
        searchTerm,
      ]);
      superadminCompletionAddSessions.set(sessionId, ctx);

      const options = localResults.slice(0, 24).map((game) => ({
        label: game.title.slice(0, 100),
        value: String(game.id),
        description: `GameDB #${game.id}`,
      }));

      options.push({
        label: "Import another game from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`sa-comp-add-select:${sessionId}`)
        .setPlaceholder("Select a game to log completion")
        .addOptions(options);

      await safeReply(interaction, {
        content: `Select the game for "${searchTerm}".`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.promptIgdbSelection(interaction, searchTerm, ctx);
  }

  private createCompletionPlatformSession(
    ctx: CompletionPlatformContext,
    sourceInteractionId: string,
  ): string {
    const sessionId = buildStableSuperAdminSessionId("sacomp-platform", [
      sourceInteractionId,
      ctx.targetUserId,
      String(ctx.gameId),
      ctx.completionType,
    ]);
    superadminCompletionPlatformSessions.set(sessionId, ctx);
    return sessionId;
  }

  private async promptCompletionPlatformSelection(
    interaction: AnyRepliable,
    ctx: CompletionAddContext,
    game: IGame,
  ): Promise<void> {
    const platforms = await Game.getPlatformsForGameWithStandard(
      game.id,
      STANDARD_PLATFORM_IDS,
    );
    if (!platforms.length) {
      await safeReply(interaction, buildTextReply("No platform release data found for this game.", true));
      return;
    }

    const platformOptions = [...platforms]
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
      .map((platform) => ({
        id: platform.id,
        name: platform.name,
      }));
    const sessionId = this.createCompletionPlatformSession(
      {
        ...ctx,
        userId: interaction.user.id,
        gameId: game.id,
        gameTitle: game.title,
        platforms: platformOptions,
      },
      interaction.id,
    );
    const baseOptions = platformOptions.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const options = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${SUPERADMIN_COMPLETION_PLATFORM_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platformOptions.length > 24
      ? `Select the platform for **${game.title}** (showing first 24).`
      : `Select the platform for **${game.title}**.`;
    await safeReply(interaction, {
      content,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async promptIgdbSelection(
    interaction: AnyRepliable,
    searchTerm: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      const loading = { content: `Searching IGDB for "${searchTerm}"...`, components: [] };
      if (interaction.deferred || interaction.replied) {
        await safeReply(interaction, loading).catch(() => {});
      } else {
        await safeUpdate(interaction, loading).catch(() => {});
      }
    } else {
      await safeReply(interaction, buildTextReply(`Searching IGDB for "${searchTerm}"...`, true));
    }

    const igdbSearch = await igdbService.searchGames(searchTerm);
    if (!igdbSearch.results.length) {
      const content = `No GameDB or IGDB matches found for "${searchTerm}".`;
      if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
        await safeReply(interaction, buildTextReply(content, false)).catch(() => {});
      } else {
        await safeReply(interaction, buildTextReply(content, true));
      }
      return;
    }

    const opts: IgdbSelectOption[] = igdbSearch.results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").slice(0, 95),
      };
    });

    const { components } = createIgdbSession(
      interaction.user.id,
      opts,
      async (sel, gameId) => {
        if (!sel.deferred && !sel.replied) {
          await safeDeferUpdate(sel);
        }
        await safeReply(sel, {
          content: "Importing game details from IGDB...",
          components: [],
        }).catch(() => {});

        const imported = await this.importGameFromIgdbForCompletion(gameId);
        const game = await Game.getGameById(imported.gameId);
        if (!game) {
          await safeReply(sel, { ...buildTextReply("Imported game was not found in GameDB.", true), __forceFollowUp: true });
          return;
        }
        await this.promptCompletionPlatformSelection(sel, ctx, game);
      },
    );

    const content = `No GameDB match; select an IGDB result to import for "${searchTerm}".`;
    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      await safeReply(interaction, {
        content: "Found results on IGDB. See message below.",
        components: [],
      });
      await safeReply(interaction, {
        content,
        components,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    } else {
      await safeReply(interaction, {
        content,
        components,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Have the bot send a message", name: "say" })
  async say(
    @SlashOption({
      description: "What should the bot say?",
      name: "message",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    message: string,
    @SlashOption({
      description: "Message ID to reply to (optional)",
      name: "message_id",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    messageId: string | undefined,
    @SlashOption({
      description: "Channel ID to post in (required if no message_id)",
      name: "channel_id",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    channelId: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const sanitizedMessage = sanitizeUserInput(message, { preserveNewlines: true });
    if (!sanitizedMessage) {
      await safeReply(interaction, buildTextReply("Message cannot be empty.", true));
      return;
    }

    const replyTargetId = messageId?.trim() ?? "";
    const targetChannelId = channelId?.trim() ?? "";

    let targetChannel: any = null;
    if (replyTargetId) {
      if (targetChannelId) {
        targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
      } else {
        targetChannel = interaction.channel;
      }
      if (!targetChannel || !("messages" in targetChannel)) {
        await safeReply(interaction, buildTextReply("Channel not found for that message id.", true));
        return;
      }
      const targetMessage = await (targetChannel as any).messages
        .fetch(replyTargetId)
        .catch(() => null);
      if (!targetMessage) {
        await safeReply(interaction, buildTextReply("Message not found in that channel.", true));
        return;
      }

      try {
        await targetMessage.reply(buildTextReply(sanitizedMessage, false));
      } catch {
        await safeReply(interaction, buildTextReply("Could not send that reply.", true));
        return;
      }
      await safeReply(interaction, buildTextReply("Reply sent.", true));
      return;
    }

    if (!targetChannelId) {
      await safeReply(interaction, buildTextReply("Channel ID is required when no message id is provided.", true));
      return;
    }

    targetChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
    if (!targetChannel || !("send" in targetChannel)) {
      await safeReply(interaction, buildTextReply("Channel not found or not a text channel.", true));
      return;
    }

    await (targetChannel as any).send({ content: sanitizedMessage }).catch(() => {});
    await safeReply(interaction, buildTextReply("Message sent.", true));
  }

  private async processCompletionSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
    ctx: CompletionAddContext,
  ): Promise<boolean> {
    if (value === "import-igdb") {
      if (!ctx.query) {
        await safeReply(interaction, buildTextReply("Original search query lost. Please try again.", true));
        return false;
      }
      await this.promptIgdbSelection(interaction, ctx.query, ctx);
      return true;
    }

    try {
      const parsedId = Number(value);
      if (!isPositiveInt(parsedId)) {
        await safeReply(interaction, { ...buildTextReply("Invalid selection.", true), __forceFollowUp: true });
        return false;
      }
      const game = await Game.getGameById(parsedId);
      if (!game) {
        await safeReply(interaction, { ...buildTextReply("Selected game was not found in GameDB.", true), __forceFollowUp: true });
        return false;
      }

      await this.promptCompletionPlatformSelection(interaction, ctx, game);
      return true;
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, { ...buildTextReply(`Failed to add completion: ${msg}`, true), __forceFollowUp: true });
      return false;
    }
  }

  private async importGameFromIgdbForCompletion(
    igdbId: number,
  ): Promise<{ gameId: number; title: string }> {
    const existing = await Game.getGameByIgdbId(igdbId);
    if (existing) {
      return { gameId: existing.id, title: existing.title };
    }

    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      throw new Error("Failed to load game details from IGDB.");
    }

    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        imageData = Buffer.from(imageResponse.data);
      } catch (err) {
        console.error("Failed to download cover image:", err);
      }
    }

    const newGame = await Game.createGame(
      details.name,
      details.summary ?? "",
      imageData,
      details.id,
      details.slug ?? null,
      details.total_rating ?? null,
      details.url ?? null,
      Game.getFeaturedVideoUrl(details),
    );
    await Game.saveFullGameMetadata(newGame.id, details);
    return { gameId: newGame.id, title: details.name };
  }

  private async saveCompletionForContext(
    interaction: StringSelectMenuInteraction,
    ctx: CompletionAddContext,
    game: IGame,
    platformId: number | null,
  ): Promise<void> {
    await saveCompletion(
      interaction,
      ctx.targetUserId,
      game.id,
      platformId,
      ctx.completionType,
      ctx.completedAt,
      ctx.finalPlaytimeHours,
      ctx.note ?? null,
      game.title,
      ctx.announce,
      true,
    );
  }

  @ButtonComponent({ id: /^(gotm|nr-gotm)-audit(img)?-(stop|skip|novalue).*-/ })
  async handleAuditButtons(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      await safeDeferUpdate(interaction);
    }
  }

  @Slash({ description: "Scan guild members and upsert into RPG_CLUB_USERS", name: "memberscan" })
  async memberScan(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, buildTextReply("This command must be run in a guild.", true));
      return;
    }

    const roleMap = {
      admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    };

    await safeReply(interaction, buildTextReply("Fetching all guild members... this may take a moment.", true));

    const members = await guild.members.fetch();
    const departedCount = await Member.markDepartedNotIn(Array.from(members.keys()));

    let successCount = 0;
    let failCount = 0;

    const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const avatarBuffersDifferent = (a: Buffer | null, b: Buffer | null): boolean => {
      if (!a && !b) return false;
      if (!!a !== !!b) return true;
      if (!a || !b) return true;
      if (a.length !== b.length) return true;
      return !a.equals(b);
    };

    for (const member of members.values()) {
      const user = member.user;
      const existing = await Member.getByUserId(user.id);

      let avatarBlob: Buffer | null = null;
      const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
      if (avatarUrl) {
        try {
          const { buffer } = await downloadImageBuffer(avatarUrl);
          avatarBlob = buffer;
        } catch {
          // ignore avatar fetch failures
        }
      }

      const hasRole = (id?: string | null): number => {
        if (!id) return 0;
        return member.roles.cache.has(id) ? 1 : 0;
      };
      const adminFlag =
        hasRole(roleMap.admin) || member.permissions.has("Administrator") ? 1 : 0;
      const moderatorFlag =
        hasRole(roleMap.mod) || member.permissions.has("ManageMessages") ? 1 : 0;
      const regularFlag = hasRole(roleMap.regular);
      const memberFlag = hasRole(roleMap.member);
      const newcomerFlag = hasRole(roleMap.newcomer);

      const baseRecord: IMemberRecord = {
        userId: user.id,
        isBot: user.bot ? 1 : 0,
        username: user.username,
        globalName: (user as any).globalName ?? null,
        avatarBlob: null,
        serverJoinedAt: member.joinedAt ?? existing?.serverJoinedAt ?? null,
        serverLeftAt: null,
        lastSeenAt: existing?.lastSeenAt ?? null,
        roleAdmin: adminFlag,
        roleModerator: moderatorFlag,
        roleRegular: regularFlag,
        roleMember: memberFlag,
        roleNewcomer: newcomerFlag,
        messageCount: existing?.messageCount ?? null,
        completionatorUrl: existing?.completionatorUrl ?? null,
        psnUsername: existing?.psnUsername ?? null,
        xblUsername: existing?.xblUsername ?? null,
        nswFriendCode: existing?.nswFriendCode ?? null,
        steamUrl: existing?.steamUrl ?? null,
        profileImage: existing?.profileImage ?? null,
        profileImageAt: existing?.profileImageAt ?? null,
      };

      let avatarToUse: Buffer | null = avatarBlob;
      if (!avatarToUse && existing?.avatarBlob) {
        avatarToUse = existing.avatarBlob;
      } else if (avatarToUse && existing?.avatarBlob) {
        if (!avatarBuffersDifferent(avatarToUse, existing.avatarBlob)) {
          avatarToUse = existing.avatarBlob;
        }
      }

      try {
        await Member.upsert({ ...baseRecord, avatarBlob: avatarToUse });
        successCount++;
      } catch (err) {
        const code = (err as any)?.code ?? (err as any)?.errorNum;
        if (code === "ORA-03146") {
          try {
            await Member.upsert({ ...baseRecord, avatarBlob: null });
            successCount++;
            await delay(1000);
            continue;
          } catch (retryErr) {
            failCount++;
            console.error(`Failed to upsert user ${user.id} after stripping avatar`, retryErr);
            await delay(1000);
            continue;
          }
        }
        failCount++;
        console.error(`Failed to upsert user ${user.id}`, err);
      }

      await delay(1000);
    }

    await safeReply(interaction, buildTextReply(`Member scan complete. Upserts succeeded: ${successCount}. Failed: ${failCount}. ` +
        `Marked departed: ${departedCount}.`, true));
  }

  @Slash({ description: "Show help for server owner commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildSuperAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: "superadmin-help-select" })
  async handleSuperAdminHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as SuperAdminHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = topicId ? SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildSuperAdminHelpResponse();
      const textReply = buildTextReply(
        "Sorry, I don't recognize that superadmin help topic. Showing the superadmin help menu.",
        false,
      );
      await safeUpdate(interaction, {
        ...response,
        flags: textReply.flags,
        components: [...textReply.components, ...response.components],
      });
      return;
    }

    const helpEmbed = buildSuperAdminHelpEmbed(topic);
    const response = buildSuperAdminHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";

export async function isSuperAdmin(interaction: AnyRepliable): Promise<boolean> {
  const guild = interaction.guild;
  const userId = interaction.user.id;

  if (!guild) {
    await safeReply(interaction, buildTextReply("This command can only be used inside a server.", false));
    return false;
  }

  const ownerId = guild.ownerId;
  const isOwner = ownerId === userId;

  if (!isOwner) {
    const denial = {
      content: "Access denied. Command is restricted to the server owner.",
      flags: MessageFlags.Ephemeral,
    };

    await safeReply(interaction, denial as any);
  }

  return isOwner;
}
export function buildSuperAdminHelpResponse(
  activeTopicId?: SuperAdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Superadmin Commands Help")
    .setDescription(
      "Pick a `/superadmin` command to see what it does and how to run it (server owner only).",
    );

  const components = buildSuperAdminHelpButtons(activeTopicId);

  return {
    embeds: [embed],
    // eslint-disable-next-line local/dynamic-components-require-chunking
    components,
  };
}
