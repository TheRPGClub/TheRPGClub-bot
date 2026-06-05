import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonInteraction,
  CommandInteraction,
  Guild,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import {
  buildOptionalPrevNextRow,
  parseDirAndPage,
} from "../functions/PaginationUtils.js";
import Member from "../classes/Member.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import { getUserEmojiData, renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { buildTitleHeaderContainer, buildUserHeaderContainer } from "../functions/uiComponents.js";
import { safeDeferUpdate } from "../functions/InteractionUtils.js";
import { recordCurrentAvatarIfNew } from "../utilities/AvatarLogUtils.js";
import { isAdmin } from "./admin/admin-auth.utils.js";

const AVATAR_HISTORY_PAGE_SIZE = 10;
const ALL_VIEW_PAGE_SIZE = 15;

function formatTimestamp(date: Date): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return `<t:${seconds}:F>`;
}

type AvatarHistoryV2Page = {
  containers: ContainerBuilder[];
  files: AttachmentBuilder[];
  totalPages: number;
  safePage: number;
  totalCount: number;
};

async function buildAvatarHistoryV2Page(
  target: User,
  page: number,
): Promise<AvatarHistoryV2Page | null> {
  const totalCount = await Member.countAvatarHistory(target.id);
  if (!totalCount) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / AVATAR_HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * AVATAR_HISTORY_PAGE_SIZE;
  const history = await Member.getAvatarHistory(target.id, AVATAR_HISTORY_PAGE_SIZE, offset);
  if (!history.length) return null;

  const files: AttachmentBuilder[] = [];
  const gallery = new MediaGalleryBuilder();
  let hasItems = false;

  history.forEach((entry, idx) => {
    const number = offset + idx + 1;
    const description = `#${number} of ${totalCount} - ${formatTimestamp(entry.changedAt)}`;
    if (entry.avatarUrl) {
      gallery.addItems(
        new MediaGalleryItemBuilder().setURL(entry.avatarUrl).setDescription(description),
      );
      hasItems = true;
    } else if (entry.avatarBlob) {
      const fileName = `avatar_${entry.eventId}_${number}.png`;
      files.push(new AttachmentBuilder(entry.avatarBlob, { name: fileName }));
      gallery.addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${fileName}`)
          .setDescription(description),
      );
      hasItems = true;
    }
  });

  const displayName = target.displayName ?? target.username ?? "User";
  const headerContainer = buildUserHeaderContainer(target.id, displayName, "Avatar History");
  const galleryContainer = new ContainerBuilder();
  if (hasItems) {
    galleryContainer.addMediaGalleryComponents(gallery);
  } else {
    galleryContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No avatar images available for this page."),
    );
  }

  return {
    containers: [headerContainer, galleryContainer],
    files,
    totalPages,
    safePage,
    totalCount,
  };
}

type AllViewPage = {
  headerContainer: ContainerBuilder;
  contentContainer: ContainerBuilder;
  selectRow: ActionRowBuilder<StringSelectMenuBuilder>;
  totalPages: number;
  safePage: number;
};

async function buildAvatarHistoryAllPage(
  guild: Guild | null,
  page: number,
  ownerId: string,
): Promise<AllViewPage | null> {
  const allRecords = await Member.getAllMembersAvatarHistoryCounts();
  let members = allRecords;
  if (guild) {
    const checks = await Promise.all(
      allRecords.map(async (record) => {
        if (guild.members.cache.has(record.userId)) return record;
        const fetched = await guild.members.fetch(record.userId).catch(() => null);
        return fetched ? record : null;
      }),
    );
    members = checks.filter((r): r is NonNullable<typeof r> => r !== null);
  }
  if (!members.length) return null;

  const sorted = [...members].sort((a, b) => {
    const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
    const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / ALL_VIEW_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * ALL_VIEW_PAGE_SIZE;
  const pageMembers = sorted.slice(offset, offset + ALL_VIEW_PAGE_SIZE);

  const lines = pageMembers.map((record, idx) => {
    const displayName = record.globalName ?? record.username ?? record.userId;
    const suffix = record.count === 1 ? "avatar" : "avatars";
    return `${offset + idx + 1}. **${renderUsernameWithEmoji(record.userId, displayName)}**: ${record.count} ${suffix}`;
  });

  const headerContainer = buildTitleHeaderContainer("Avatar History");

  const contentContainer = new ContainerBuilder();
  contentContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  contentContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# _${sorted.length} users with avatar history stored._`,
    ),
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`avatar-history-all-select:${ownerId}`)
    .setPlaceholder("View a member's avatar history");
  pageMembers.forEach((record) => {
    const displayName = record.globalName ?? record.username ?? record.userId;
    const suffix = record.count === 1 ? "avatar" : "avatars";
    const option = new StringSelectMenuOptionBuilder()
      .setValue(record.userId)
      .setLabel(displayName)
      .setDescription(`${record.count} ${suffix}`);
    const emojiData = getUserEmojiData(record.userId);
    if (emojiData) option.setEmoji(emojiData);
    selectMenu.addOptions(option);
  });
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  return { headerContainer, contentContainer, selectRow, totalPages, safePage };
}

@Discord()
export class AvatarHistoryCommand {
  @Slash({ description: "View a user's avatar history", name: "avatar-history" })
  async avatarHistory(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    @SlashOption({
      description: "List all members with avatar history and their stored count.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    @SlashOption({
      description: "Scan all cached members and record current avatars for new entries (admin only).",
      name: "scan",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    scan: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;

    if (scan === true) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
      if (!(await isAdmin(interaction))) return;
      if (!interaction.guild) {
        await safeReply(interaction, {
          components: [
            new ContainerBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent("This command can only be used in a server."),
            ),
          ],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      const guildMembers = interaction.guild.members.cache.filter((m) => !m.user.bot);
      let recorded = 0;
      let skipped = 0;
      let failed = 0;
      for (const guildMember of guildMembers.values()) {
        try {
          const wasRecorded = await recordCurrentAvatarIfNew(guildMember);
          if (wasRecorded) recorded++;
          else skipped++;
        } catch {
          failed++;
        }
      }
      const lines = [
        `Scanned **${guildMembers.size}** members.`,
        `- **${recorded}** new avatar${recorded !== 1 ? "s" : ""} recorded`,
        `- **${skipped}** already up to date or no avatar`,
        ...(failed > 0 ? [`- **${failed}** failed`] : []),
      ];
      const scanContainer = new ContainerBuilder();
      scanContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("# Avatar History Scan"),
      );
      scanContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
      await safeReply(interaction, {
        components: [scanContainer],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (showAll === true) {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });
      const pageResult = await buildAvatarHistoryAllPage(
        interaction.guild,
        0,
        interaction.user.id,
      );
      if (!pageResult) {
        await safeReply(interaction, {
          components: [
            new ContainerBuilder().addTextDisplayComponents(
              new TextDisplayBuilder().setContent("No avatar history found for any members."),
            ),
          ],
          flags: buildComponentsV2Flags(ephemeral),
        });
        return;
      }
      const { headerContainer, contentContainer, selectRow, totalPages, safePage } = pageResult;
      const paginationRow = buildOptionalPrevNextRow(
        `avatar-history-all-page:${interaction.user.id}`,
        safePage,
        totalPages,
      );
      const components = paginationRow
        ? [headerContainer, contentContainer, selectRow, paginationRow]
        : [headerContainer, contentContainer, selectRow];
      await safeReply(interaction, {
        components,
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    const target = member ?? interaction.user;
    const pageResult = await buildAvatarHistoryV2Page(target, 0);
    if (!pageResult) {
      const noResultContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`No avatar history found for <@${target.id}>.`),
      );
      await safeReply(interaction, {
        components: [noResultContainer],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const { containers, files, totalPages, safePage } = pageResult;
    const paginationRow = buildOptionalPrevNextRow(
      `avatar-history-page:${interaction.user.id}:${target.id}`,
      safePage,
      totalPages,
    );

    await safeReply(interaction, {
      components: paginationRow ? [...containers, paginationRow] : containers,
      files: files.length ? files : undefined,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ButtonComponent({ id: /^avatar-history-page:\d+:\d+:\d+:(prev|next)$/ })
  async handlePage(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, targetId, pageRaw, dir] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply(
        "This avatar history list isn't for you.",
        true,
      ));
      return;
    }

    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    const target = await interaction.client.users.fetch(targetId).catch(() => interaction.user);
    const pageResult = await buildAvatarHistoryV2Page(target, parsed.nextPage);
    if (!pageResult) {
      await safeUpdate(interaction, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No avatar history found."),
          ),
        ],
        files: [],
        flags: buildComponentsV2EditFlags(),
      });
      return;
    }

    const { containers, files, totalPages, safePage } = pageResult;
    const paginationRow = buildOptionalPrevNextRow(
      `avatar-history-page:${ownerId}:${targetId}`,
      safePage,
      totalPages,
    );

    await safeUpdate(interaction, {
      components: paginationRow ? [...containers, paginationRow] : containers,
      files: files.length ? files : [],
      flags: buildComponentsV2EditFlags(),
    });
  }

  @ButtonComponent({ id: /^avatar-history-all-page:\d+:\d+:(prev|next)$/ })
  async handleAllPage(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, pageRaw, dir] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply(
        "This avatar history list isn't for you.",
        true,
      ));
      return;
    }
    const parsed = parseDirAndPage(pageRaw, dir);
    if (!parsed) return;
    const pageResult = await buildAvatarHistoryAllPage(interaction.guild, parsed.nextPage, ownerId);
    if (!pageResult) {
      await safeUpdate(interaction, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No avatar history found."),
          ),
        ],
        flags: buildComponentsV2EditFlags(),
      });
      return;
    }
    const { headerContainer, contentContainer, selectRow, totalPages, safePage } = pageResult;
    const paginationRow = buildOptionalPrevNextRow(
      `avatar-history-all-page:${ownerId}`,
      safePage,
      totalPages,
    );
    const components = paginationRow
      ? [headerContainer, contentContainer, selectRow, paginationRow]
      : [headerContainer, contentContainer, selectRow];
    await safeUpdate(interaction, { components, flags: buildComponentsV2EditFlags() });
  }

  @SelectMenuComponent({ id: /^avatar-history-all-select:\d+$/ })
  async handleAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, buildTextReply(
        "This avatar history list isn't for you.",
        true,
      ));
      return;
    }
    const targetId = interaction.values[0];
    if (!targetId) return;
    await safeDeferUpdate(interaction);
    const target = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!target) return;
    const pageResult = await buildAvatarHistoryV2Page(target, 0);
    if (!pageResult) {
      await safeUpdate(interaction, {
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`No avatar history found for <@${targetId}>.`),
          ),
        ],
        flags: buildComponentsV2EditFlags(),
      });
      return;
    }
    const { containers, files, totalPages, safePage } = pageResult;
    const paginationRow = buildOptionalPrevNextRow(
      `avatar-history-page:${ownerId}:${targetId}`,
      safePage,
      totalPages,
    );
    await safeUpdate(interaction, {
      components: paginationRow ? [...containers, paginationRow] : containers,
      files: files.length ? files : [],
      flags: buildComponentsV2EditFlags(),
    });
  }
}
