import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import {
  replaceWithPrivateReply,
  safeDeferReply,
  safeEditReply,
  safeReply,
} from "../functions/InteractionUtils.js";
import {
  answerFunFact,
  drawFunFactReply,
  funFactDrawWaitMs,
} from "../services/CodexFunFactPosts.js";

// /funfact (spec api#397, bot#1562): any member posts the next Fun Fact for everyone. It
// belongs to the club_codex Feature (config/featureGate.ts). The draw is made as the
// member, so the API's Feature Flag applies to them. A quick draw is answered at once, so
// an empty queue or a failed draw is only ever private; a slow one is deferred publicly,
// and swapped for a private reply when no Fun Fact comes. Nothing here outlives the
// command, so there is nothing to resume after a restart.

@Discord()
export class FunFactCommand {
  @Slash({ name: "funfact", description: "Post a Fun Fact about the club for everyone" })
  async funfact(interaction: CommandInteraction): Promise<void> {
    const draw = drawFunFactReply({ actingUserId: interaction.user.id });
    await answerFunFact(draw, {
      reply: async (payload) => { await safeReply(interaction, payload); },
      deferPublicly: () => safeDeferReply(interaction),
      editReply: async (payload) => { await safeEditReply(interaction, payload); },
      replaceWithPrivate: (payload) => replaceWithPrivateReply(interaction, payload),
      wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); }),
    }, funFactDrawWaitMs(interaction.createdTimestamp, Date.now()));
  }
}
