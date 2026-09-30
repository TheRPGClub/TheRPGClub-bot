import { MessageFlags, type CommandInteraction } from "discord.js";
import { Discord, Guild, Slash } from "discordx";
import { resolveCommandMention } from "../functions/CommandMentionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { safeDeferReply, safeReply, withErrorReply } from "../functions/InteractionUtils.js";

/**
 * Old top-level names for the commands now grouped under /gotm and /admin (#1242). Each
 * one only points at its new home. They stay for one release so muscle memory has a
 * landing spot, then this file is deleted. Discord cannot hide a registered command, so
 * the descriptions say where each one moved.
 */
async function replyMoved(interaction: CommandInteraction, newPath: string): Promise<void> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await withErrorReply(interaction, async () => {
    const mention = await resolveCommandMention(interaction, newPath);
    await safeReply(
      interaction,
      buildTextReply(`This command moved. Use ${mention} instead.`, true),
    );
  });
}

@Discord()
export class GotmLegacyAliases {
  @Slash({ description: "Moved to /gotm nominate", name: "nominate" })
  async nominate(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm nominate");
  }

  @Slash({ description: "Moved to /gotm withdraw", name: "nominate-delete" })
  async nominateDelete(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm withdraw");
  }

  @Slash({ description: "Moved to /gotm nominations", name: "noms" })
  async noms(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm nominations");
  }

  @Slash({ description: "Moved to /gotm vote", name: "vote" })
  async vote(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm vote");
  }

  @Slash({ description: "Moved to /gotm current", name: "round" })
  async round(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm current");
  }

  @Slash({ description: "Moved to /gotm history", name: "round-history" })
  async roundHistory(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "gotm history");
  }
}

/**
 * The old /generate-vote-image was registered per guild, not globally. The alias keeps
 * that registration so it replaces the guild command in place instead of sitting beside
 * a stale copy. Removing it later leaves that guild command behind, since discordx only
 * syncs guilds that still have commands, so the removal also clears it once.
 */
@Discord()
@Guild((client) => client.guilds.cache.map((guild) => guild.id))
export class GenerateVoteImageLegacyAlias {
  @Slash({ description: "Moved to /admin generate-vote-image", name: "generate-vote-image" })
  async generateVoteImage(interaction: CommandInteraction): Promise<void> {
    await replyMoved(interaction, "admin generate-vote-image");
  }
}
