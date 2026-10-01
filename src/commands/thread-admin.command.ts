import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  type GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { removeThreadGameLink, setThreadGameLink } from "../classes/Thread.js";
import { REGULARS_ROLE_ID } from "../config/roles.js";
import {
  ACCESS_DENIED_REGULARS,
  safeDeferReply,
  safeReply,
} from "../functions/InteractionUtils.js";
import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";

/** The `/thread` group; `/thread create` lives in create-thread.command.ts. */
export const THREAD_GROUP_NAME = "thread";

/** Forum posts are public threads, so this covers every thread a game can link to. */
const LINKABLE_THREAD_TYPES = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

@Discord()
@SlashGroup({ description: "Thread commands", name: THREAD_GROUP_NAME })
@SlashGroup(THREAD_GROUP_NAME)
export class ThreadAdminCommands {
  @Slash({ description: "Link a thread to a GameDB game id", name: "link" })
  async link(
    @SlashOption({
      name: "thread",
      description: "Thread to link",
      required: true,
      type: ApplicationCommandOptionType.Channel,
      channelTypes: LINKABLE_THREAD_TYPES,
    })
    thread: GuildBasedChannel,
    @SlashOption({
      name: "gamedb_game_id",
      description: "GameDB game id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    gamedbGameId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!(await this.canEditLinks(interaction))) return;
    const threadId = thread.id;

    try {
      await setThreadGameLink(threadId, gamedbGameId);
    } catch (error: unknown) {
      const label = `Could not link thread ${threadId} to GameDB game ${gamedbGameId}`;
      await safeReply(interaction, buildErrorReply(buildApiErrorMessage(label, error), true));
      return;
    }
    await safeReply(interaction, buildTextReply(
      `Linked thread <#${threadId}> to GameDB game ${gamedbGameId}.`,
      true,
    ));
  }

  @Slash({ description: "Unlink a thread from a GameDB game id", name: "unlink" })
  async unlink(
    @SlashOption({
      name: "thread",
      description: "Thread to unlink",
      required: true,
      type: ApplicationCommandOptionType.Channel,
      channelTypes: LINKABLE_THREAD_TYPES,
    })
    thread: GuildBasedChannel,
    @SlashOption({
      name: "gamedb_game_id",
      description: "Specific GameDB game id to unlink (omit to remove all)",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    gamedbGameId: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!(await this.canEditLinks(interaction))) return;
    const threadId = thread.id;

    const target = gamedbGameId === undefined
      ? "all GameDB links"
      : `GameDB game ${gamedbGameId}`;
    let removed: number;
    try {
      removed = await removeThreadGameLink(threadId, gamedbGameId);
    } catch (error: unknown) {
      const label = `Could not unlink ${target} from thread ${threadId}`;
      await safeReply(interaction, buildErrorReply(buildApiErrorMessage(label, error), true));
      return;
    }
    const suffix = removed === 0 ? " (no matching links were found)." : ".";
    await safeReply(interaction, buildTextReply(
      `Unlinked ${target} from thread <#${threadId}>${suffix}`,
      true,
    ));
  }

  /** Replies with the reason and returns false when the caller lacks the Regulars role. */
  private async canEditLinks(interaction: CommandInteraction): Promise<boolean> {
    if (this.hasRegularsRole(interaction)) return true;
    await safeReply(interaction, buildTextReply(ACCESS_DENIED_REGULARS, true));
    return false;
  }

  private hasRegularsRole(interaction: CommandInteraction): boolean {
    const member = interaction.member;
    if (!member) return false;

    const roleData = (member as any).roles;
    if (Array.isArray(roleData)) {
      return roleData.includes(REGULARS_ROLE_ID);
    }

    const roleCache = roleData?.cache;
    return Boolean(roleCache?.has(REGULARS_ROLE_ID));
  }
}
