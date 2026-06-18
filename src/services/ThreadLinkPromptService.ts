import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  MessageFlags,
  ThreadChannel,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import {
  setThreadGameLink,
  setThreadSkipLinking,
  getThreadLinkInfo,
} from "../classes/Thread.js";
import Game from "../classes/Game.js";
import { igdbService } from "./IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "./IGDB/IgdbSelectService.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { NOW_PLAYING_SIDEGAME_TAG_ID } from "../config/tags.js";
import { safeReply, safeDeferReply } from "../functions/InteractionUtils.js";
import {
  buildTextReply,
  buildComponentsV2Flags,
  buildTextContainer,
  buildTitledContainer,
} from "../functions/ComponentsV2Utils.js";
import { shouldPrompt, markPrompted, getGameReleaseYear } from "./ThreadLinkPromptCache.js";
import { COLOR_BLUE_INFO } from "../config/colors.js";
import { truncateDescription } from "../config/textLimits.js";
import { assertCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";
import { buildActionButton, buildButtonRow } from "../functions/uiComponents.js";
import GameSearchService from "../classes/GameSearchService.js";

function hasIgdbConfig(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

function buildPromptContainer(thread: ThreadChannel) {
  return buildTitledContainer(
    "Link this thread to a game?",
    "This Now Playing thread doesn't have a linked GameDB entry yet. " +
      "Linking helps show the right cover art, metadata, and GOTM/NR-GOTM info.\n\n" +
      "Choose an option below.",
    { color: COLOR_BLUE_INFO, footer: thread.name ?? thread.id },
  );
}

function buildButtons(threadId: string): ActionRowBuilder<ButtonBuilder> {
  return buildButtonRow(
    buildActionButton({ customId: `thread-link:${threadId}`, label: "Link a game", style: ButtonStyle.Primary }),
    buildActionButton({ customId: `thread-skip:${threadId}`, label: "Skip Linking Game", style: ButtonStyle.Secondary }),
  );
}

async function promptThread(thread: ThreadChannel): Promise<void> {
  if (!hasIgdbConfig()) return;
  const isBotCreated = thread.ownerId && thread.ownerId === thread.client.user?.id;
  const isSidegameTag = thread.appliedTags?.includes(NOW_PLAYING_SIDEGAME_TAG_ID) ?? false;
  if (thread.parentId === NOW_PLAYING_FORUM_ID && isBotCreated && isSidegameTag) {
    return;
  }
  const info = await getThreadLinkInfo(thread.id).catch(() => ({
    skipLinking: false,
    gamedbGameIds: [],
  }));
  if (info.skipLinking) return;
  if (info.gamedbGameIds.length) return;
  if (!shouldPrompt(thread.id)) return;
  markPrompted(thread.id);

  try {
    await thread.send({
      components: [buildPromptContainer(thread), buildButtons(thread.id)],
      flags: buildComponentsV2Flags(false),
    });
  } catch (err) {
    logError("ThreadLinkPromptService.postPrompt", err);
  }
}

@Discord()
export class ThreadLinkButtonHandlers {
  @ButtonComponent({ id: /^thread-link:.+$/ })
  async handleLinkButton(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [threadId] = segs;
    if (!interaction.guild || !interaction.channel) return;

    if (!hasIgdbConfig()) {
      await safeReply(interaction, buildTextReply(
        "IGDB service is not configured. " +
        "Please set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in the environment.",
        true,
      ));
      return;
    }

    const threadName = (interaction.channel as any)?.name ?? "Unknown Thread";
    const title = threadName.split("(")[0].trim() || threadName;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    safeIgnore(interaction.message.edit({ components: [] }));

    try {
      const localMatches = (await GameSearchService.searchGames(title)).filter((g) =>
        g.title.toLowerCase() === title.toLowerCase(),
      );
      let gameId: number | null = localMatches[0]?.id ?? null;
      let chosenName: string | null = localMatches[0]?.title ?? null;

      const finalizeSelection = async (
        igdbId: number,
        nameHint?: string,
      ): Promise<number | null> => {
        const game = await Game.createGame(igdbId);
        chosenName = nameHint ?? game.title;
        return game.id;
      };

      const finishLink = async (): Promise<void> => {
        if (!gameId) return;
        await setThreadGameLink(threadId, gameId!);
        await safeReply(interaction, buildTextReply(
          `Linked this thread to GameDB #${gameId}${chosenName ? ` (${chosenName})` : ""}.\n` +
          "Threads can have multiple links; use /thread unlink to remove one or all.",
          true,
        ));

        try {
          await interaction.message.delete().catch(async () => {
            safeIgnore(interaction.message.edit({ components: [] }));
          });
        } catch {
          // ignore
        }
      };

      if (!gameId) {
        const searchRes = await igdbService.searchGames(title);
        const results = searchRes.results;
        if (!results.length) {
          await safeReply(interaction, buildTextReply(
            `No GameDB/IGDB results found for "${title}". Tagging @admin to review.`,
            true,
          ));
          return;
        }

        const selectFirst = async (igdbId: number, name: string): Promise<void> => {
          const finalId = await finalizeSelection(igdbId, name);
          if (!finalId) return;
          gameId = finalId;
        };

        if (results.length === 1) {
          await selectFirst(results[0].id, results[0].name);
        } else {
          const opts: IgdbSelectOption[] = results.map((game) => {
            const year = getGameReleaseYear(game.first_release_date);
            return {
              id: game.id,
              label: `${game.name} (${year})`,
              description: truncateDescription((game.summary || "No summary")),
            };
          });

          const { components } = createIgdbSession(
            interaction.user.id,
            opts,
            async (sel, igdbId) => {
              const finalId = await finalizeSelection(igdbId);
              if (!finalId) return;
              gameId = finalId;
              // The prompt was sent with IS_COMPONENTS_V2, so the edit must use a V2
              // container; a legacy `content` field is rejected (Discord error 50035).
              await sel.editReply({
                components: [buildTextContainer(`Linked to GameDB #${finalId}.`)],
              });
              await finishLink();
            },
          );

          await safeReply(interaction, {
            components: [buildTextContainer(`Select the correct game for "${title}".`), ...components],
            flags: buildComponentsV2Flags(true),
          });

          return;
        }
      }

      await finishLink();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, buildTextReply(`Failed to link game: ${msg}`, false));
    }
  }

  @ButtonComponent({ id: /^thread-skip:.+$/ })
  async handleSkipButton(interaction: ButtonInteraction): Promise<void> {
    const segs = assertCustomIdSegments(interaction, 1);
    if (!segs) return;
    const [threadId] = segs;
    try {
      await setThreadSkipLinking(threadId, true);
      await safeReply(interaction, buildTextReply(
        "Okay, I'll skip linking a game for this thread going forward.",
        true,
      ));
      safeIgnore(interaction.message.edit({ components: [] }));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, buildTextReply(`Failed to update skip flag: ${msg}`, true));
    }
  }
}

export function startThreadLinkPromptService(client: Client): void {
  if (!hasIgdbConfig()) {
    logWarn("ThreadLinkPromptService.start", "IGDB_CLIENT_ID/SECRET not set; skipping thread link prompts.");
  }

  client.on("threadCreate", async (thread) => {
    if (thread.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(thread);
  });

  client.on("messageCreate", async (message) => {
    const channel = message.channel;
    if (!("isThread" in channel) || !channel.isThread()) return;
    if (channel.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(channel);
  });

  logInfo("ThreadLinkPromptService", "Service started");
}
