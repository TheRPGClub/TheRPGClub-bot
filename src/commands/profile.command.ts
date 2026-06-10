import {
  type CommandInteraction,
  ApplicationCommandOptionType,
  type User,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  userMention,
} from "discord.js";
import {
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { ContainerBuilder } from "@discordjs/builders";
import axios from "axios";
import Member, {
  type IMemberRecord,
  type IMemberSearchFilters,
} from "../classes/Member.js";
import {
  deferWithPrivateFlag,
  ephemeralFlag,
  extractErrorMessage,
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
  buildTitledContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { buildUserHeaderContainer } from "../functions/uiComponents.js";
import {
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
} from "../functions/DateFormatUtils.js";
import { DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";
import { chunk } from "../utilities/ArrayUtils.js";

export { formatDiscordTimestamp, formatPlaytimeHours, formatTableDate };

export const COMPLETION_TYPES = [
  "Main Story",
  "Main Story + Side Content",
  "Completionist",
] as const;

export type CompletionType = (typeof COMPLETION_TYPES)[number];

export { COMPLETION_PAGE_SIZE } from "../config/pagination.js";

export type ProfileViewPayload = {
  payload?: {
    components: ContainerBuilder[];
  };
  notFoundMessage?: string;
  errorMessage?: string;
};

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function clampLimit(limit: number | undefined, max: number): number {
  if (!limit || Number.isNaN(limit)) return Math.min(50, max);
  return Math.min(Math.max(limit, 1), max);
}

export function parseCompletionDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "today") {
    return new Date();
  }
  if (normalized === "unknown" || normalized === "skip") {
    return null;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new Error(
        "Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'.",
      );
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      "Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'.",
    );
  }
  return parsed;
}

function summarizeFilters(filters: IMemberSearchFilters): string {
  const parts: string[] = [];
  if (filters.userId) parts.push(`userId~${filters.userId}`);
  if (filters.username) parts.push(`username~${filters.username}`);
  if (filters.globalName) parts.push(`globalName~${filters.globalName}`);
  if (filters.completionatorUrl) parts.push(`completionator~${filters.completionatorUrl}`);
  if (filters.steamUrl) parts.push(`steam~${filters.steamUrl}`);
  if (filters.psnUsername) parts.push(`psn~${filters.psnUsername}`);
  if (filters.xblUsername) parts.push(`xbl~${filters.xblUsername}`);
  if (filters.nswFriendCode) parts.push(`switch~${filters.nswFriendCode}`);
  if (filters.roleAdmin !== undefined) parts.push(`admin=${filters.roleAdmin ? 1 : 0}`);
  if (filters.roleModerator !== undefined)
    parts.push(`moderator=${filters.roleModerator ? 1 : 0}`);
  if (filters.roleRegular !== undefined) parts.push(`regular=${filters.roleRegular ? 1 : 0}`);
  if (filters.roleMember !== undefined) parts.push(`member=${filters.roleMember ? 1 : 0}`);
  if (filters.roleNewcomer !== undefined) parts.push(`newcomer=${filters.roleNewcomer ? 1 : 0}`);
  if (filters.isBot !== undefined) parts.push(`bot=${filters.isBot ? 1 : 0}`);
  if (filters.joinedAfter) parts.push(`joined>=${filters.joinedAfter.toISOString()}`);
  if (filters.joinedBefore) parts.push(`joined<=${filters.joinedBefore.toISOString()}`);
  if (filters.lastSeenAfter) parts.push(`seen>=${filters.lastSeenAfter.toISOString()}`);
  if (filters.lastSeenBefore) parts.push(`seen<=${filters.lastSeenBefore.toISOString()}`);
  parts.push(`includeDeparted=${filters.includeDeparted ? "yes" : "no"}`);
  return parts.join(" | ") || "none";
}

function buildProfileContentContainer(
  record: NonNullable<Awaited<ReturnType<typeof Member.getByUserId>>>,
  nickHistory: string[],
): ContainerBuilder {
  const blocks: string[] = [];

  if (record.isBot) {
    blocks.push("**Bot**\nYes");
  }

  if (nickHistory.length > 0) {
    blocks.push(`**AKA**\n${nickHistory.join(", ")}`);
  }

  const roles = [
    record.roleAdmin ? "Admin" : null,
    record.roleModerator ? "Moderator" : null,
    record.roleRegular ? "Regular" : null,
    record.roleMember ? "Member" : null,
    record.roleNewcomer ? "Newcomer" : null,
  ]
    .filter(Boolean)
    .join(", ") || "None";
  blocks.push(`**Roles**\n${roles}`);

  blocks.push(`**Last Seen**\n${formatDiscordTimestamp(record.lastSeenAt)}`);
  blocks.push(`**Joined Server**\n${formatDiscordTimestamp(record.serverJoinedAt)}`);

  if (record.completionatorUrl) {
    blocks.push(`**Game Collection Tracker**\n${record.completionatorUrl}`);
  }
  if (record.steamUrl) {
    blocks.push(`**Steam**\n${record.steamUrl}`);
  }
  if (record.psnUsername) {
    blocks.push(`**PSN**\n${record.psnUsername}`);
  }
  if (record.xblUsername) {
    blocks.push(`**Xbox**\n${record.xblUsername}`);
  }
  if (record.nswFriendCode) {
    blocks.push(`**Switch**\n${record.nswFriendCode}`);
  }

  return buildTextContainer(
    safeV2TextContent(blocks.join(`\n${" ".repeat(120)}\n`), 3500),
  );
}

function avatarBuffersDifferent(a: Buffer | null, b: Buffer | null): boolean {
  if (!a && !b) return false;
  if (!!a !== !!b) return true;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  return !a.equals(b);
}

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function buildBaseMemberRecord(user: User): IMemberRecord {
  return {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: user.username ?? null,
    globalName: (user as any).globalName ?? null,
    avatarBlob: null,
    serverJoinedAt: null,
    serverLeftAt: null,
    lastSeenAt: null,
    roleAdmin: 0,
    roleModerator: 0,
    roleRegular: 0,
    roleMember: 0,
    roleNewcomer: 0,
    messageCount: null,
    completionatorUrl: null,
    psnUsername: null,
    xblUsername: null,
    nswFriendCode: null,
    steamUrl: null,
    profileImage: null,
    profileImageAt: null,
  };
}

export async function buildProfileViewPayload(
  target: User,
): Promise<ProfileViewPayload> {
  try {
    let record = await Member.getByUserId(target.id);
    const nickHistoryEntries = await Member.getRecentNickHistory(target.id, 6);
    const avatarUrl = target.displayAvatarURL({
      extension: "png",
      size: 512,
      forceStatic: true,
    });

    if (avatarUrl) {
      const newAvatar = await downloadAvatar(avatarUrl);
      const baseRecord: IMemberRecord = record ?? buildBaseMemberRecord(target);

      if (newAvatar && avatarBuffersDifferent(baseRecord.avatarBlob, newAvatar)) {
        record = {
          ...baseRecord,
          avatarBlob: newAvatar,
          username: target.username ?? baseRecord.username,
          globalName: (target as any).globalName ?? baseRecord.globalName,
          isBot: target.bot ? 1 : 0,
        };
        await Member.upsert(record);
      } else if (!record) {
        record = baseRecord;
      }
    }

    if (!record) {
      return { notFoundMessage: `No profile data found for ${userMention(target.id)}.` };
    }

    const nickHistory: string[] = [];
    for (const entry of nickHistoryEntries) {
      const candidateRaw = entry.oldNick ?? entry.newNick;
      const candidate = candidateRaw?.trim();
      if (!candidate) continue;
      if (candidate === record.globalName || candidate === record.username) continue;
      if (nickHistory.includes(candidate)) continue;
      nickHistory.push(candidate);
      if (nickHistory.length >= 5) break;
    }

    const displayName = record.globalName ?? record.username ?? target.username ?? "Unknown";
    const headerContainer = buildUserHeaderContainer(target.id, displayName, "Member Profile");
    const contentContainer = buildProfileContentContainer(record, nickHistory);

    return {
      payload: {
        components: [headerContainer, contentContainer],
      },
    };
  } catch (err: any) {
    const msg = extractErrorMessage(err);
    return { errorMessage: `Error loading profile: ${msg}` };
  }
}

@SlashGroup({ description: "Profile commands", name: "profile" })
@Discord()
export class ProfileCommand {
  @Slash({ description: "Show a member profile", name: "view" })
  @SlashGroup("profile")
  async profileView(
    @SlashOption({
      description: "Member to view; leave blank to view your own profile.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    const result = await buildProfileViewPayload(target);

    if (result.errorMessage) {
      const errContainer = buildTextContainer(safeV2TextContent(result.errorMessage, 1000));
      await safeReply(interaction, {
        components: [errContainer],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    if (!result.payload) {
      const notFoundContainer = buildTextContainer(
      safeV2TextContent(
        result.notFoundMessage ?? `No profile data found for ${userMention(target.id)}.`,
        1000,
          ),
        );
      await safeReply(interaction, {
        components: [notFoundContainer],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    await safeReply(interaction, {
      ...result.payload,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @SelectMenuComponent({ id: /^profile-search-select-\d+$/ })
  async handleProfileSearchSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const userId = interaction.values?.[0];
    if (!userId) {
      const errContainer = buildTextContainer("Could not determine which member to load.");
      await safeReply(interaction, {
        components: [errContainer],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    try {
      const user = await interaction.client.users.fetch(userId);
      const result = await buildProfileViewPayload(user);

      if (result.errorMessage) {
        const errContainer = buildTextContainer(safeV2TextContent(result.errorMessage, 1000));
        await safeReply(interaction, {
          components: [errContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      if (!result.payload) {
        const notFoundContainer = buildTextContainer(
        safeV2TextContent(
          result.notFoundMessage ?? `No profile data found for ${userMention(userId)}.`,
          1000,
            ),
          );
        await safeReply(interaction, {
          components: [notFoundContainer],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      await safeReply(interaction, {
        ...result.payload,
        flags: buildComponentsV2Flags(true),
      });
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      const errContainer = buildTextContainer(
      safeV2TextContent(`Could not load that profile: ${msg}`, 1000),
        );
      await safeReply(interaction, {
        components: [errContainer],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @Slash({ description: "Search member profiles", name: "search" })
  @SlashGroup("profile")
  async profileSearch(
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    @SlashOption({
      description: "Filter by user id.",
      name: "userid",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    userId: string | undefined,
    @SlashOption({
      description: "Filter by username (contains).",
      name: "username",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    username: string | undefined,
    @SlashOption({
      description: "Filter by global display name (contains).",
      name: "globalname",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    globalName: string | undefined,
    @SlashOption({
      description: "Filter by Game Collection Tracker URL (contains).",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "Filter by Steam URL (contains).",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    @SlashOption({
      description: "Filter by PlayStation Network username (contains).",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Filter by Xbox Live username (contains).",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Filter by Nintendo Switch friend code (contains).",
      name: "switch",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Filter by Admin role flag (1 or 0).",
      name: "admin",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleAdmin: boolean | undefined,
    @SlashOption({
      description: "Filter by Moderator role flag (1 or 0).",
      name: "moderator",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleModerator: boolean | undefined,
    @SlashOption({
      description: "Filter by Regular role flag (1 or 0).",
      name: "regular",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleRegular: boolean | undefined,
    @SlashOption({
      description: "Filter by Member role flag (1 or 0).",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleMember: boolean | undefined,
    @SlashOption({
      description: "Filter by Newcomer role flag (1 or 0).",
      name: "newcomer",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleNewcomer: boolean | undefined,
    @SlashOption({
      description: "Filter by bot flag (1 or 0).",
      name: "bot",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isBot: boolean | undefined,
    @SlashOption({
      description: "Joined server on/after (ISO date/time).",
      name: "joinedafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedAfter: string | undefined,
    @SlashOption({
      description: "Joined server on/before (ISO date/time).",
      name: "joinedbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedBefore: string | undefined,
    @SlashOption({
      description: "Last seen on/after (ISO date/time).",
      name: "lastseenafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenAfter: string | undefined,
    @SlashOption({
      description: "Last seen on/before (ISO date/time).",
      name: "lastseenbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenBefore: string | undefined,
    @SlashOption({
      description: "Max results to return (1-50).",
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    limit: number | undefined,
    @SlashOption({
      description: "Include departed members (SERVER_LEFT_AT not null).",
      name: "include-departed-members",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    includeDeparted: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    userId = userId ? sanitizeUserInput(userId, { preserveNewlines: false }) : undefined;
    username = username ? sanitizeUserInput(username, { preserveNewlines: false }) : undefined;
    globalName = globalName
      ? sanitizeUserInput(globalName, { preserveNewlines: false })
      : undefined;
    completionator = completionator
      ? sanitizeUserInput(completionator, { preserveNewlines: false })
      : undefined;
    steam = steam ? sanitizeUserInput(steam, { preserveNewlines: false }) : undefined;
    psn = psn ? sanitizeUserInput(psn, { preserveNewlines: false }) : undefined;
    xbl = xbl ? sanitizeUserInput(xbl, { preserveNewlines: false }) : undefined;
    nsw = nsw ? sanitizeUserInput(nsw, { preserveNewlines: false }) : undefined;
    joinedAfter = joinedAfter
      ? sanitizeUserInput(joinedAfter, { preserveNewlines: false })
      : undefined;
    joinedBefore = joinedBefore
      ? sanitizeUserInput(joinedBefore, { preserveNewlines: false })
      : undefined;
    lastSeenAfter = lastSeenAfter
      ? sanitizeUserInput(lastSeenAfter, { preserveNewlines: false })
      : undefined;
    lastSeenBefore = lastSeenBefore
      ? sanitizeUserInput(lastSeenBefore, { preserveNewlines: false })
      : undefined;

    const joinedAfterDate = parseDateInput(joinedAfter);
    const joinedBeforeDate = parseDateInput(joinedBefore);
    const lastSeenAfterDate = parseDateInput(lastSeenAfter);
    const lastSeenBeforeDate = parseDateInput(lastSeenBefore);

    if (joinedAfter && !joinedAfterDate) {
      await safeReply(interaction, buildTextReply("Invalid joinedafter date/time. Please use an ISO format.", ephemeral));
      return;
    }

    if (joinedBefore && !joinedBeforeDate) {
      await safeReply(interaction, buildTextReply("Invalid joinedbefore date/time. Please use an ISO format.", ephemeral));
      return;
    }

    if (lastSeenAfter && !lastSeenAfterDate) {
      await safeReply(interaction, buildTextReply("Invalid lastseenafter date/time. Please use an ISO format.", ephemeral));
      return;
    }

    if (lastSeenBefore && !lastSeenBeforeDate) {
      await safeReply(interaction, buildTextReply("Invalid lastseenbefore date/time. Please use an ISO format.", ephemeral));
      return;
    }

    const filters: IMemberSearchFilters = {
      userId,
      username,
      globalName,
      completionatorUrl: completionator,
      steamUrl: steam,
      psnUsername: psn,
      xblUsername: xbl,
      nswFriendCode: nsw,
      roleAdmin,
      roleModerator,
      roleRegular,
      roleMember,
      roleNewcomer,
      isBot,
      joinedAfter: joinedAfterDate ?? undefined,
      joinedBefore: joinedBeforeDate ?? undefined,
      lastSeenAfter: lastSeenAfterDate ?? undefined,
      lastSeenBefore: lastSeenBeforeDate ?? undefined,
      limit: clampLimit(limit, 100),
      includeDeparted: includeDeparted ?? false,
    };

    const results = await Member.search(filters);
    if (!results.length) {
      await safeReply(interaction, buildTextReply("No members matched those filters.", ephemeral));
      return;
    }

    const filterSummary = summarizeFilters(filters);
    const lines = results.map((record, idx) => {
      const name = record.globalName ?? record.username;
      const label = name ? `(${name})` : "";
      const botTag = record.isBot ? " [Bot]" : "";
      return `${idx + 1}. ${userMention(record.userId)} ${label}${botTag}`;
    });

    const description = `Filters: ${filterSummary}\n\n${lines.join("\n")}`;

    const selectOptions = results.map((record, idx) => {
      const label = (record.globalName ?? record.username ?? `Member ${idx + 1}`).slice(0, DISCORD_SELECT_LABEL_MAX);
      const descriptionText = `ID: ${record.userId}${record.isBot ? " | Bot" : ""}`;
      return {
        label,
        value: record.userId,
        description: descriptionText.slice(0, DISCORD_SELECT_LABEL_MAX),
      };
    });

    const selectChunks = chunk(selectOptions, 25);
    const components = selectChunks.slice(0, 5).map((chunkPart, idx) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`profile-search-select-${idx}`)
          .setPlaceholder("Select a member to view their profile")
          .addOptions(chunkPart)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );

    const notice =
      selectChunks.length > 5
        ? "Showing the first 125 selectable results (Discord limits). Refine filters to narrow further."
        : description.length > 4000
            ? "Showing truncated results (Discord length limits). Refine filters for more detail."
            : undefined;
    const footer = notice
      ? `Choose a member below to view a profile.\n${notice}`
      : "Choose a member below to view a profile.";
    const container = buildTitledContainer(
      `Profile search (${results.length})`,
      description.slice(0, 3500),
      { footer },
    );

    await safeReply(interaction, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @Slash({ description: "Edit profile links (self, or any user if admin)", name: "edit" })
  @SlashGroup("profile")
  async profileEdit(
    @SlashOption({
      description: "Member to edit; admin only.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Game Collection Tracker URL.",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "PlayStation Network username.",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Xbox Live username.",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Nintendo Switch friend code.",
      name: "nsw",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Steam profile URL.",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const isAdmin =
      interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
    const isSelf = target.id === interaction.user.id;
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeralFlag(ephemeral) });

    completionator = completionator
      ? sanitizeUserInput(completionator, { preserveNewlines: false })
      : undefined;
    psn = psn ? sanitizeUserInput(psn, { preserveNewlines: false }) : undefined;
    xbl = xbl ? sanitizeUserInput(xbl, { preserveNewlines: false }) : undefined;
    nsw = nsw ? sanitizeUserInput(nsw, { preserveNewlines: false }) : undefined;
    steam = steam ? sanitizeUserInput(steam, { preserveNewlines: false }) : undefined;

    if (!isSelf && !isAdmin) {
      await safeReply(interaction, buildTextReply("You can only edit your own profile.", true));
      return;
    }

    if (
      completionator === undefined &&
      psn === undefined &&
      xbl === undefined &&
      nsw === undefined &&
      steam === undefined
    ) {
      await safeReply(interaction, buildTextReply("Provide at least one field to update.", true));
      return;
    }

    try {
      const existing = (await Member.getByUserId(target.id)) ?? buildBaseMemberRecord(target);

      const updated: IMemberRecord = {
        ...existing,
        username: existing.username ?? target.username ?? null,
        globalName: existing.globalName ?? (target as any).globalName ?? null,
        completionatorUrl:
          completionator !== undefined ? completionator || null : existing.completionatorUrl,
        psnUsername: psn !== undefined ? psn || null : existing.psnUsername,
        xblUsername: xbl !== undefined ? xbl || null : existing.xblUsername,
        nswFriendCode: nsw !== undefined ? nsw || null : existing.nswFriendCode,
        steamUrl: steam !== undefined ? steam || null : existing.steamUrl,
      };

      await Member.upsert(updated);

      const changedFields: string[] = [];
      if (completionator !== undefined) changedFields.push("Completionator");
      if (psn !== undefined) changedFields.push("PSN");
      if (xbl !== undefined) changedFields.push("Xbox");
      if (nsw !== undefined) changedFields.push("Switch");
      if (steam !== undefined) changedFields.push("Steam");

      await safeReply(interaction, buildTextReply(`Updated profile for ${userMention(target.id)} (${changedFields.join(", ")}).`, true));
    } catch (err: any) {
      const msg = extractErrorMessage(err);
      await safeReply(interaction, buildTextReply(`Error updating profile: ${msg}`, true));
    }
  }

}
