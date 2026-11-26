import { ApplicationCommandOptionType, type CommandInteraction } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import {
  replaceWithPrivateReply,
  safeDeferReply,
  safeEditReply,
  safeReply,
} from "../functions/InteractionUtils.js";
import { answerPublicOrPrivate, publicAnswerWaitMs } from "../functions/PublicAnswer.js";
import { buildPatchNotesAnswer } from "../services/PatchNotesCommand.js";

// /patch-notes [number] (spec api#510, bot#1594): the latest published Patch, or the
// numbered one, for everyone, as the same message as its #patch-notes post plus the
// versions line. It belongs to the patch_notes Feature (config/featureGate.ts). An unknown
// number is answered privately. Nothing here outlives the command, so there is nothing to
// resume after a restart.

@Discord()
export class PatchNotesCommand {
  @Slash({ name: "patch-notes", description: "Show the latest Patch, or a numbered one" })
  async patchNotes(
    @SlashOption({
      description: "The Patch's number (the latest when left out)",
      name: "number",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
    })
    number: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const answer = buildPatchNotesAnswer(number ?? null);
    await answerPublicOrPrivate(answer, {
      reply: async (payload) => { await safeReply(interaction, payload); },
      deferPublicly: () => safeDeferReply(interaction),
      editReply: async (payload) => { await safeEditReply(interaction, payload); },
      replaceWithPrivate: (payload) => replaceWithPrivateReply(interaction, payload),
      wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref(); }),
    }, publicAnswerWaitMs(interaction.createdTimestamp, Date.now()));
  }
}
