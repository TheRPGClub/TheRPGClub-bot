import {
  type CommandInteraction,
  ApplicationCommandOptionType,
  type User,
  PermissionsBitField,
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
import {
  apiGet,
  apiGetRaw,
  apiPost,
  apiPatch,
  apiDelete,
} from "../services/RpgClubApiClient.js";
import {
  deferWithPrivateFlag,
  ephemeralFlag,
  extractErrorMessage,
  withErrorReply,
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
import { buildUserHeaderContainer, buildSelectRow } from "../functions/uiComponents.js";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import {
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
} from "../functions/DateFormatUtils.js";
import { truncateLabel } from "../config/textLimits.js";
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

type ApiUserSocial = {
  id: number;
  social_platform_id: number;
  handle: string | null;
  url: string | null;
  social_platform: { label: string };
};

type ApiSocialPlatform = {
  id: number;
  label: string;
};

type ApiUserListItem = {
  user_id: string;
  username: string | null;
  global_name: string | null;
  is_bot: boolean;
};

let socialPlatformCache: ApiSocialPlatform[] | null = null;

async function getSocialPlatforms(): Promise<ApiSocialPlatform[]> {
  if (socialPlatformCache) return socialPlatformCache;
  const resp = await apiGet<{ data: ApiSocialPlatform[] }>("/api/v1/social_platforms");
  socialPlatformCache = resp?.data ?? [];
  return socialPlatformCache;
}

const SOCIAL_MATCHERS: Record<string, (label: string) => boolean> = {
  completionator: (l) => l.toLowerCase().includes("completionator"),
  psn: (l) => l.toLowerCase().includes("psn") || l.toLowerCase().includes("playstation"),
  xbl: (l) => l.toLowerCase().includes("xbox"),
  nsw: (l) => l.toLowerCase().includes("nintendo") || l.toLowerCase().includes("switch"),
  steam: (l) => l.toLowerCase().includes("steam"),
};

function findPlatformId(
  platforms: ApiSocialPlatform[],
  key: keyof typeof SOCIAL_MATCHERS,
): number | null {
  const matcher = SOCIAL_MATCHERS[key];
  return platforms.find((p) => matcher(p.label))?.id ?? null;
}

async function upsertUserSocial(
  userId: string,
  existing: ApiUserSocial[],
  platformId: number,
  value: string,
  useUrl: boolean,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const current = existing.find((s) => s.social_platform_id === platformId);
  const body = useUrl
    ? { data: { social_platform_id: platformId, url: value } }
    : { data: { social_platform_id: platformId, handle: value } };
  try {
    if (current) {
      await apiPatch(`/api/v1/user_socials/${current.id}`, body);
    } else {
      await apiPost(`/api/v1/users/${userId}/socials`, body);
    }
    return { ok: true };
  } catch (err: unknown) {
    const op = current ? `PATCH user_socials/${current.id}` : `POST users/${userId}/socials`;
    let detail = err instanceof Error ? err.message : String(err);
    if (
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      typeof (err as any).response?.data !== "undefined"
    ) {
      detail += ` | body: ${JSON.stringify((err as any).response.data).slice(0, 300)}`;
    }
    return { ok: false, detail: `${op}: ${detail}` };
  }
}

async function deleteUserSocial(
  existing: ApiUserSocial[],
  platformId: number,
): Promise<void> {
  const current = existing.find((s) => s.social_platform_id === platformId);
  if (current) {
    await apiDelete(`/api/v1/user_socials/${current.id}`);
  }
}

type ApiUserMembership = {
  admin: boolean;
  moderator: boolean;
  regular: boolean;
  member: boolean;
  newcomer: boolean;
  active: boolean;
};

type ApiUserProfile = {
  user_id: string;
  username: string | null;
  global_name: string | null;
  is_bot: boolean;
  membership: ApiUserMembership | null;
  socials: ApiUserSocial[];
};

type ApiNickHistoryEntry = {
  old_nick: string | null;
  new_nick: string | null;
};

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

function buildProfileContentContainer(
  user: ApiUserProfile,
  nickHistory: string[],
): ContainerBuilder {
  const blocks: string[] = [];

  if (user.is_bot) {
    blocks.push("**Bot**\nYes");
  }

  if (nickHistory.length > 0) {
    blocks.push(`**AKA**
${nickHistory.join(", ")}`);
  }

  const m = user.membership;
  const roles = [
    m?.admin ? "Admin" : null,
    m?.moderator ? "Moderator" : null,
    m?.regular ? "Regular" : null,
    m?.member ? "Member" : null,
    m?.newcomer ? "Newcomer" : null,
  ]
    .filter(Boolean)
    .join(", ") || "None";
  blocks.push(`**Roles**
${roles}`);

  for (const social of user.socials) {
    const value = social.handle ?? social.url;
    if (value) {
      blocks.push(`**${social.social_platform.label}**
${value}`);
    }
  }

  return buildTextContainer(
    safeV2TextContent(blocks.join(`
${" ".repeat(120)}
`), 3500),
  );
}

export async function buildProfileViewPayload(
  target: User,
): Promise<ProfileViewPayload> {
  try {
    const [profileResp, nickHistResp] = await Promise.all([
      apiGet<{ data: ApiUserProfile }>(`/api/v1/users/${target.id}`),
      apiGet<{ data: ApiNickHistoryEntry[] }>(
        `/api/v1/users/${target.id}/nick_history`,
        { params: { per: 6 } },
      ),
    ]);

    if (!profileResp) {
      return { notFoundMessage: `No profile data found for ${userMention(target.id)}.` };
    }

    const user = profileResp.data;
    const nickHistEntries = nickHistResp?.data ?? [];

    const nickHistory: string[] = [];
    for (const entry of nickHistEntries) {
      const candidateRaw = entry.old_nick ?? entry.new_nick;
      const candidate = candidateRaw?.trim();
      if (!candidate) continue;
      if (candidate === user.global_name || candidate === user.username) continue;
      if (nickHistory.includes(candidate)) continue;
      nickHistory.push(candidate);
      if (nickHistory.length >= 5) break;
    }

    const displayName = user.global_name ?? user.username ?? target.username ?? "Unknown";
    const headerContainer = buildUserHeaderContainer(target.id, displayName, "Member Profile");
    const contentContainer = buildProfileContentContainer(user, nickHistory);

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
      description: "Search by username or display name.",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    const q = query ? sanitizeUserInput(query, { preserveNewlines: false }) : undefined;

    const resp = await apiGet<{ data: ApiUserListItem[]; meta: { count: number } }>(
      "/api/v1/users",
      { params: { q, limit: 50 } },
    );

    const results = resp?.data ?? [];
    if (!results.length) {
      await safeReply(interaction, buildTextReply("No members matched that search.", ephemeral));
      return;
    }

    const lines = results.map((u, idx) => {
      const name = u.global_name ?? u.username ?? u.user_id;
      const botTag = u.is_bot ? " [Bot]" : "";
      return `${idx + 1}. **${renderUsernameWithEmoji(u.user_id, name)}**${botTag}`;
    });

    const description = (q ? `Search: ${q}\n\n` : "") + lines.join("\n");

    const selectOptions = results.map((u, idx) => ({
      label: truncateLabel(u.global_name ?? u.username ?? `Member ${idx + 1}`),
      value: u.user_id,
    }));

    const selectChunks = chunk(selectOptions, 25);
    const components = selectChunks.slice(0, 5).map((chunkPart, idx) =>
      buildSelectRow(
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
        ? "Showing the first 125 selectable results (Discord limits). Refine search to narrow further."
        : description.length > 4000
            ? "Showing truncated results (Discord length limits). Refine search for more detail."
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

    await withErrorReply(interaction, async () => {
      const userExists = await apiGet<{ data: unknown }>(`/api/v1/users/${target.id}`);
      if (!userExists) {
        await safeReply(
          interaction,
          buildTextReply(
            `${userMention(target.id)} doesn't have a profile in the database yet. ` +
            "They need to be seen by the bot first (send a message, have an admin sync them, etc.).",
            true,
          ),
        );
        return;
      }

      const platforms = await getSocialPlatforms();
      if (!platforms.length) {
        await safeReply(
          interaction,
          buildTextReply("Could not load social platforms from the API. Try again later.", true),
        );
        return;
      }

      const socialsRaw = await apiGetRaw<{ data: ApiUserSocial[] }>(
        `/api/v1/users/${target.id}/socials`,
      );
      if (socialsRaw.errorMessage) {
        await safeReply(
          interaction,
          buildTextReply(
            `Could not fetch existing socials (HTTP ${socialsRaw.status}): ${socialsRaw.errorMessage}`,
            true,
          ),
        );
        return;
      }
      const existing =
        (socialsRaw.rawData as { data: ApiUserSocial[] } | null)?.data ?? [];

      type FieldSpec = {
        key: keyof typeof SOCIAL_MATCHERS;
        value: string | undefined;
        useUrl: boolean;
        label: string;
      };

      const fields: FieldSpec[] = [
        { key: "completionator", value: completionator, useUrl: true, label: "Completionator" },
        { key: "psn", value: psn, useUrl: false, label: "PSN" },
        { key: "xbl", value: xbl, useUrl: false, label: "Xbox" },
        { key: "nsw", value: nsw, useUrl: false, label: "Switch" },
        { key: "steam", value: steam, useUrl: true, label: "Steam" },
      ];

      const changedFields: string[] = [];
      const skippedFields: string[] = [];
      const failedFields: string[] = [];
      for (const field of fields) {
        if (field.value === undefined) continue;
        const platformId = findPlatformId(platforms, field.key);
        if (!platformId) {
          skippedFields.push(field.label);
          continue;
        }
        if (field.value) {
          const result = await upsertUserSocial(
            target.id, existing, platformId, field.value, field.useUrl,
          );
          if (result.ok) {
            changedFields.push(field.label);
          } else {
            failedFields.push(`${field.label} (${result.detail})`);
          }
        } else {
          await deleteUserSocial(existing, platformId);
          changedFields.push(field.label);
        }
      }

      const parts: string[] = [];
      if (changedFields.length) parts.push(`Updated: ${changedFields.join(", ")}`);
      if (skippedFields.length) parts.push(`Skipped (platform not found): ${skippedFields.join(", ")}`);
      if (failedFields.length) parts.push(`Failed: ${failedFields.join("; ")}`);

      await safeReply(
        interaction,
        buildTextReply(
          parts.length
            ? `Profile result for ${userMention(target.id)} -- ${parts.join(" | ")}.`
            : `No fields were updated for ${userMention(target.id)}.`,
          true,
        ),
      );
    }, "Error updating profile");
  }

}
