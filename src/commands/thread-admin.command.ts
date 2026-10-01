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
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { buildErrorReply, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { isSnowflake } from "../utilities/ValidationUtils.js";

/** The `/thread` group; `/thread create` lives in create-thread.command.ts. */
export const THREAD_GROUP_NAME = "thread";

/** Forum posts are public threads, so this covers every thread a game can link to. */
const LINKABLE_THREAD_TYPES = [
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
];

const THREAD_ID_FALLBACK_DESCRIPTION =
  "Id of an archived or deleted thread the thread picker cannot show";

/** Picks the thread id from the typed option or the id fallback; exactly one must be set. */
export function resolveThreadOption(
  pickedThreadId: string | undefined,
  rawThreadId: string | undefined,
): { threadId: string } | { error: string } {
  const typedId = sanitizeUserInput(rawThreadId ?? "", { preserveNewlines: false });
  if (pickedThreadId && typedId) {
    return { error: "Use either thread or thread_id, not both." };
  }
  if (pickedThreadId) return { threadId: pickedThreadId };
  if (!typedId) return { error: "Pick a thread, or give a thread_id for an archived one." };
  if (!isSnowflake(typedId)) return { error: `\`${typedId}\` is not a thread ID.` };
  return { threadId: typedId };
}

@Discord()
@SlashGroup({ description: "Thread commands", name: THREAD_GROUP_NAME })
@SlashGroup(THREAD_GROUP_NAME)
export class ThreadAdminCommands {
  @Slash({ description: "Link a thread to a GameDB game id", name: "link" })
  async link(
    @SlashOption({
      name: "gamedb_game_id",
      description: "GameDB game id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    gamedbGameId: number,
    @SlashOption({
      name: "thread",
      description: "Thread to link",
      required: false,
      type: ApplicationCommandOptionType.Channel,
      channelTypes: LINKABLE_THREAD_TYPES,
    })
    thread: GuildBasedChannel | undefined,
    @SlashOption({
      name: "thread_id",
      description: THREAD_ID_FALLBACK_DESCRIPTION,
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    rawThreadId: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const threadId = await this.resolveEditableThreadId(interaction, thread, rawThreadId);
    if (!threadId) return;

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
      required: false,
      type: ApplicationCommandOptionType.Channel,
      channelTypes: LINKABLE_THREAD_TYPES,
    })
    thread: GuildBasedChannel | undefined,
    @SlashOption({
      name: "thread_id",
      description: THREAD_ID_FALLBACK_DESCRIPTION,
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    rawThreadId: string | undefined,
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
    const threadId = await this.resolveEditableThreadId(interaction, thread, rawThreadId);
    if (!threadId) return;

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

  /**
   * Returns the thread id to edit, or replies with the reason and returns null when the
   * caller lacks the Regulars role or the thread options are missing or invalid.
   */
  private async resolveEditableThreadId(
    interaction: CommandInteraction,
    thread: GuildBasedChannel | undefined,
    rawThreadId: string | undefined,
  ): Promise<string | null> {
    if (!this.hasRegularsRole(interaction)) {
      await safeReply(interaction, buildTextReply(ACCESS_DENIED_REGULARS, true));
      return null;
    }
    const resolved = resolveThreadOption(thread?.id, rawThreadId);
    if ("error" in resolved) {
      await safeReply(interaction, buildTextReply(resolved.error, true));
      return null;
    }
    return resolved.threadId;
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
