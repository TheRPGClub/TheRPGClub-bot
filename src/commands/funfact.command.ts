import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import { buildErrorReply } from "../functions/ComponentsV2Utils.js";
import {
  safeDeferReply,
  safeEditReply,
  safeFollowUpIfSettled,
} from "../functions/InteractionUtils.js";
import { drawFunFactReply } from "../services/CodexFunFactPosts.js";
import { logError } from "../utilities/LogUtils.js";

// /funfact (spec api#397, bot#1562): any member posts the next Fun Fact for everyone. It
// belongs to the club_codex Feature (config/featureGate.ts). The draw is made as the
// member, so the API's Feature Flag applies to them. The reply is deferred publicly, as
// a Fun Fact usually comes back; when none does, or the draw fails, the public placeholder
// is removed and the member is answered privately. Nothing here outlives the command, so
// there is nothing to resume after a restart.

@Discord()
export class FunFactCommand {
  @Slash({ name: "funfact", description: "Post a Fun Fact about the club for everyone" })
  async funfact(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);
    const reply = await drawFunFactReply({ actingUserId: interaction.user.id });
    if ("post" in reply) {
      await safeEditReply(interaction, reply.post);
      return;
    }
    try {
      await interaction.deleteReply();
    } catch (err: unknown) {
      logError("FunFactCommand.deleteReply", err);
    }
    await safeFollowUpIfSettled(
      interaction,
      "empty" in reply ? reply.empty : buildErrorReply(reply.error, true),
    );
  }
}
