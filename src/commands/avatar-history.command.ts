import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonComponent, Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import {
  buildPrevNextRow,
  parseDirAndPage,
  shouldRenderPrevNextButtons,
} from "../functions/PaginationUtils.js";
import Member from "../classes/Member.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
} from "../functions/ComponentsV2Utils.js";
import { renderUsernameWithEmoji } from "../services/UserEmojiService.js";
import { buildUserHeaderContainer } from "../functions/uiComponents.js";

const AVATAR_HISTORY_PAGE_SIZE = 10;

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

  const displayName = target.displayName ?? target.username ?? "User";
  const files: AttachmentBuilder[] = [];

  const headerContainer = buildUserHeaderContainer(target.id, displayName, "Avatar History");

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
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;

    if (showAll === true) {
      await safeDeferReply(interaction, {
        flags: buildComponentsV2Flags(ephemeral),
      });
      const members = await Member.getAllMembersAvatarHistoryCounts();
      if (!members.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("No avatar history found for any members."),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(ephemeral),
        });
        return;
      }

      const lines = members.map((record) => {
        const displayName = record.globalName ?? record.username ?? record.userId;
        const suffix = record.count === 1 ? "avatar" : "avatars";
        return `**${renderUsernameWithEmoji(record.userId, displayName)}**: ${record.count} ${suffix}`;
      });

      const container = new ContainerBuilder();
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("# Avatar History - Everyone"),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );

      await safeReply(interaction, {
        components: [container],
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
    const paginationRow = shouldRenderPrevNextButtons(safePage <= 0, safePage >= totalPages - 1)
      ? buildPrevNextRow(
          `avatar-history-page:${interaction.user.id}:${target.id}`,
          safePage,
          totalPages,
        )
      : null;

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
      await safeReply(interaction, {
        content: "This avatar history list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
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
    const paginationRow = shouldRenderPrevNextButtons(safePage <= 0, safePage >= totalPages - 1)
      ? buildPrevNextRow(
          `avatar-history-page:${ownerId}:${targetId}`,
          safePage,
          totalPages,
        )
      : null;

    await safeUpdate(interaction, {
      components: paginationRow ? [...containers, paginationRow] : containers,
      files: files.length ? files : [],
      flags: buildComponentsV2EditFlags(),
    });
  }
}
