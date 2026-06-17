import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type CommandInteraction,
} from "discord.js";
import { Discord, Guild, Slash, SlashChoice, SlashOption } from "discordx";
import Game from "../classes/Game.js";
import { type NominationKind, listNominationsForRound } from "../classes/Nomination.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import { composeVoteImage, type VoteImageType } from "../services/collageGenerator.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";

const GENERATION_LOCK_TTL_MS = 2 * 60 * 1000;

type GenerationLock = {
  acquiredAtMs: number;
};

const inProgressByKey = new Map<string, GenerationLock>();

function getLockKey(guildId: string, roundNumber: number, voteType: VoteImageType): string {
  return `${guildId}:${roundNumber}:${voteType}`;
}

function tryAcquireLock(guildId: string, roundNumber: number, voteType: VoteImageType): boolean {
  const key = getLockKey(guildId, roundNumber, voteType);
  const now = Date.now();
  const existing = inProgressByKey.get(key);
  if (existing && now - existing.acquiredAtMs < GENERATION_LOCK_TTL_MS) {
    return false;
  }
  inProgressByKey.set(key, { acquiredAtMs: now });
  return true;
}

function releaseLock(guildId: string, roundNumber: number, voteType: VoteImageType): void {
  inProgressByKey.delete(getLockKey(guildId, roundNumber, voteType));
}

function toVoteKind(value: string): 
  { nominationKind: NominationKind; label: VoteImageType } | null {
  if (value === "gotm") {
    return { nominationKind: "gotm", label: "GOTM" };
  }
  if (value === "nr-gotm") {
    return { nominationKind: "nr-gotm", label: "NR-GOTM" };
  }
  return null;
}

@Discord()
@Guild((client) => client.guilds.cache.map((guild) => guild.id))
export class GenerateVoteImageCommand {
  @Slash({ description: "Generate a combined vote image from round nominations", name: "generate-vote-image" })
  async generateVoteImage(
    @SlashChoice({ name: "GOTM", value: "gotm" }, { name: "NR-GOTM", value: "nr-gotm" })
    @SlashOption({
      description: "Vote type",
      name: "vote_type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    voteType: string,
    @SlashOption({
      description: "Round number (defaults to current round)",
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, {});

    const adminOk = await isAdmin(interaction);
    if (!adminOk) {
      return;
    }

    if (!interaction.guildId) {
      await safeReply(interaction, buildTextReply(
        "This command is only available in a server.",
        true,
      ));
      return;
    }

    const voteKind = toVoteKind(voteType);
    if (!voteKind) {
      await safeReply(interaction, buildTextReply("Please choose either GOTM or NR-GOTM.", true));
      return;
    }

    const defaultRound = round ?? (await getUpcomingNominationWindow()).targetRound;
    if (!isPositiveInt(defaultRound)) {
      await safeReply(interaction, buildTextReply(
        "No upcoming nomination round could be resolved from BOT_VOTING_INFO.",
        true,
      ));
      return;
    }

    const roundNumber = Number(defaultRound);
    if (!tryAcquireLock(interaction.guildId, roundNumber, voteKind.label)) {
      await safeReply(interaction, buildTextReply(
        `Generation already in progress for [${voteKind.label}] Round ${roundNumber}. Try again shortly.`,
        true,
      ));
      return;
    }

    const startedAt = Date.now();
    logInfo("vote_image_lock_acquired", {
      guildId: interaction.guildId,
      round: roundNumber,
      voteType: voteKind.label,
    });

    try {
      logInfo("vote_image_generation_started", {
        guildId: interaction.guildId,
        round: roundNumber,
        voteType: voteKind.label,
      });

      const nominations = await listNominationsForRound(voteKind.nominationKind, roundNumber);
      if (!nominations.length) {
        await safeReply(interaction, buildTextReply(
          `No nominations found for [${voteKind.label}] Round ${roundNumber}.`,
          true,
        ));
        return;
      }

      const orderedNominations = 
        [...nominations].sort((a, b) => a.gameTitle.localeCompare(b.gameTitle));
      const games = await Game.getGamesByIds(orderedNominations.map((nom) => nom.gamedbGameId));
      const gameById = new Map(games.map((game) => [game.id, game] as const));

      const missingBlobNomination = orderedNominations.find((nomination) => {
        const game = gameById.get(nomination.gamedbGameId);
        return !game?.imageData;
      });
      if (missingBlobNomination) {
        await safeReply(interaction, buildTextReply(
          "One or more nominations are missing cover art blobs.",
          true,
        ));
        return;
      }

      const imageBuffer = await composeVoteImage({
        roundNumber,
        voteType: voteKind.label,
        covers: orderedNominations.map((nomination) => {
          const game = gameById.get(nomination.gamedbGameId);
          if (!game?.imageData) {
            throw new Error("cover_blob_missing");
          }
          return {
            gameId: game.id,
            title: nomination.gameTitle,
            imageData: game.imageData,
          };
        }),
      });

      const filename = `vote_${voteKind.label.toLowerCase()}_round_${roundNumber}.png`;
      const attachment = new AttachmentBuilder(imageBuffer, { name: filename });
      const summary = `Generated [${voteKind.label}] Round ${roundNumber} from ${orderedNominations.length} nominations.`;
      try {
        await safeReply(interaction, { ...buildTextReply(summary, false), files: [attachment] });
      } catch (uploadErr) {
        logError("vote_image_upload_failed", {
          guildId: interaction.guildId,
          round: roundNumber,
          voteType: voteKind.label,
          errorCode: "UPLOAD_FAILED",
          error: uploadErr,
        });
        await safeReply(interaction, buildTextReply(
          "Image generation failed. Please try again.",
          true,
        ));
        return;
      }

      logInfo("vote_image_generation_succeeded", {
        guildId: interaction.guildId,
        round: roundNumber,
        voteType: voteKind.label,
        count: orderedNominations.length,
        durationMs: Date.now() - startedAt,
        errorCode: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const lower = errorMessage.toLowerCase();
      if (
        lower.includes("unsupported image format") ||
        lower.includes("input buffer contains unsupported image format")
      ) {
        await safeReply(interaction, buildTextReply(
          "Failed to decode one or more cover images.",
          true,
        ));
      } else if (errorMessage === "cover_blob_missing") {
        await safeReply(interaction, buildTextReply(
          "One or more nominations are missing cover art blobs.",
          true,
        ));
      } else {
        await safeReply(interaction, buildTextReply(
          "Image generation failed. Please try again.",
          true,
        ));
      }

      logError("vote_image_generation_failed", {
        guildId: interaction.guildId,
        round: roundNumber,
        voteType: voteKind.label,
        count: null,
        durationMs: Date.now() - startedAt,
        errorCode: "GENERATION_FAILED",
        error: errorMessage,
      });
    } finally {
      releaseLock(interaction.guildId, roundNumber, voteKind.label);
      logInfo("vote_image_lock_released", {
        guildId: interaction.guildId,
        round: roundNumber,
        voteType: voteKind.label,
      });
    }
  }
}
