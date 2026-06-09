import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ForumChannel,
  type MessageCreateOptions,
} from "discord.js";
import {
  Discord,
  ModalComponent,
  SlashGroup,
} from "discordx";
import {
  getModalField,
  isInteractionSettled,
  safeDeferReply,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { getThreadsByGameId, setThreadGameLink, upsertThreadRecord } from "../../classes/Thread.js";
import { NOW_PLAYING_FORUM_ID } from "../../config/channels.js";
import { NOW_PLAYING_SIDEGAME_TAG_ID } from "../../config/tags.js";
import Game from "../../classes/Game.js";
import { updateGameProfileMessageById } from "./gamedb-profile.service.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

const GAMEDB_THREAD_MODAL_PREFIX = "gamedb-thread-modal";
const GAMEDB_THREAD_TITLE_INPUT_ID = "gamedb-thread-title";
const GAMEDB_THREAD_BODY_INPUT_ID = "gamedb-thread-body";
const MAX_THREAD_TITLE_LEN = 100;
const MAX_THREAD_BODY_LEN = 2000;

function buildDefaultNowPlayingThreadTitle(gameTitle: string): string {
  return gameTitle.slice(0, MAX_THREAD_TITLE_LEN);
}

function buildDefaultNowPlayingThreadBody(memberDisplayName: string): string {
  return `Now Playing thread created by ${memberDisplayName}.`;
}

function buildNowPlayingThreadModalCustomId(
  gameId: number,
  sourceChannelId: string,
  sourceMessageId: string,
): string {
  return `${GAMEDB_THREAD_MODAL_PREFIX}:${gameId}:${sourceChannelId}:${sourceMessageId}`;
}

export async function showNowPlayingThreadModal(
  interaction: ButtonInteraction,
  gameId: number,
  gameTitle: string,
): Promise<void> {
  const sourceChannelId = interaction.channelId;
  const sourceMessageId = interaction.message?.id;
  if (!sourceChannelId || !sourceMessageId) {
    await safeReply(interaction, buildTextReply(
      "Unable to open thread modal from this message.", true,
    )).catch(() => {});
    return;
  }

  const memberDisplayName =
    (interaction.member as any)?.displayName ?? interaction.user.username ?? "User";
  const defaultTitle = buildDefaultNowPlayingThreadTitle(gameTitle);
  const defaultBody = buildDefaultNowPlayingThreadBody(memberDisplayName);

  const modal = new ModalBuilder()
    .setCustomId(
       
      buildNowPlayingThreadModalCustomId(gameId, sourceChannelId, sourceMessageId),
    )
    .setTitle("Create Now Playing Thread")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
           
          .setCustomId(GAMEDB_THREAD_TITLE_INPUT_ID)
          .setLabel("Thread Title")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(MAX_THREAD_TITLE_LEN)
          .setValue(defaultTitle),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
           
          .setCustomId(GAMEDB_THREAD_BODY_INPUT_ID)
          .setLabel("Initial Post")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(MAX_THREAD_BODY_LEN)
          .setValue(defaultBody),
      ),
    );

  await interaction.showModal(modal).catch(async () => {
    await safeReply(interaction, buildTextReply(
      "Failed to open thread customization modal.", true,
    )).catch(() => {});
  });
}

async function runNowPlayingThreadWizard(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  gameId: number,
  gameTitle: string,
  options?: {
    threadTitle?: string;
    initialPost?: string;
    sourceChannelId?: string;
    sourceMessageId?: string;
  },
): Promise<void> {
  const isModalInteraction =
    "isModalSubmit" in interaction &&
    typeof interaction.isModalSubmit === "function" &&
    interaction.isModalSubmit();
  const sendStatus = async (content: string): Promise<void> => {
    if (isModalInteraction && isInteractionSettled(interaction)) {
      await safeReply(interaction, buildTextReply(content, false)).catch(() => {});
      return;
    }
    await safeReply(interaction, { ...buildTextReply(content, false), __forceFollowUp: true });
  };

  const existingThreads = await getThreadsByGameId(gameId);
  if (existingThreads.length) {
    await sendStatus("A thread is already linked to this game.");
    return;
  }

  const forum = (await interaction.guild?.channels.fetch(
    NOW_PLAYING_FORUM_ID,
  )) as ForumChannel | null;
  if (!forum) {
    await sendStatus("Now Playing forum channel was not found.");
    return;
  }

  const threadTitle =
    options?.threadTitle ?? buildDefaultNowPlayingThreadTitle(gameTitle);

  const memberDisplayName =
    (interaction.member as any)?.displayName ?? interaction.user.username ?? "User";
  const initialPost =
    options?.initialPost ?? buildDefaultNowPlayingThreadBody(memberDisplayName);
  const game = await Game.getGameById(gameId);
  const files = game?.imageData
    ? [new AttachmentBuilder(game.imageData, { name: `gamedb_${gameId}.png` })]
    : [];
  const messagePayload: MessageCreateOptions = {
    content: initialPost,
    allowedMentions: { parse: [] as const },
  };
  if (files.length) {
    messagePayload.files = files;
  }

  try {
    const thread = await forum.threads.create({
      name: threadTitle,
      message: messagePayload,
      appliedTags: [NOW_PLAYING_SIDEGAME_TAG_ID],
    });
    await upsertThreadRecord({
      threadId: thread.id,
      forumChannelId: thread.parentId ?? NOW_PLAYING_FORUM_ID,
      threadName: thread.name ?? threadTitle,
      isArchived: Boolean(thread.archived),
      createdAt: thread.createdAt ?? new Date(),
      lastSeenAt: null,
      skipLinking: "Y",
    });
    await setThreadGameLink(thread.id, gameId);
    await sendStatus(`Created and linked <#${thread.id}>.`);
    const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
    const completions = await Game.getGameCompletions(gameId);
    const mentionIds = new Set<string>([interaction.user.id]);
    nowPlayingMembers.forEach((member) => mentionIds.add(member.userId));
    completions.forEach((member) => mentionIds.add(member.userId));

    if (mentionIds.size) {
      const mentions = Array.from(mentionIds).map((id) => `<@${id}>`);
      const lines: string[] = [];
      let buffer = "";
      for (const mention of mentions) {
        const next = buffer ? `${buffer} ${mention}` : mention;
        if (next.length > 1900) {
          lines.push(buffer);
          buffer = mention;
        } else {
          buffer = next;
        }
      }
      if (buffer) lines.push(buffer);

      for (const line of lines) {
        await thread.send({ content: line });
      }
    }

    const sourceChannelId = options?.sourceChannelId ?? interaction.channelId ?? "";
    const sourceMessageId = options?.sourceMessageId ?? interaction.message?.id ?? "";
    if (sourceChannelId && sourceMessageId) {
      await updateGameProfileMessageById(
        interaction,
        sourceChannelId,
        sourceMessageId,
        gameId,
      );
    }
  } catch (err: any) {
    await sendStatus(`Failed to create thread: ${err?.message ?? String(err)}`);
  }
}

@Discord()
@SlashGroup("gamedb")
export class GameDbThreadCommand {
   
  @ModalComponent({ id: /^gamedb-thread-modal:\d+:\d+:\d+$/ })
  async handleGameDbThreadModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const gameId = Number(parts[1]);
    const sourceChannelId = parts[2] ?? "";
    const sourceMessageId = parts[3] ?? "";

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (!isPositiveInt(gameId) || !sourceChannelId || !sourceMessageId) {
      await safeReply(interaction, buildTextReply("Invalid thread request payload.", false))
        .catch(() => {});
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await safeReply(interaction, buildTextReply("That game was not found in GameDB.", false))
        .catch(() => {});
      return;
    }

    const memberDisplayName =
      (interaction.member as any)?.displayName ?? interaction.user.username ?? "User";
    const defaultTitle = buildDefaultNowPlayingThreadTitle(game.title);
    const defaultBody = buildDefaultNowPlayingThreadBody(memberDisplayName);

    const titleInput = getModalField(interaction, GAMEDB_THREAD_TITLE_INPUT_ID);
    const bodyInput = getModalField(interaction, GAMEDB_THREAD_BODY_INPUT_ID);
    const threadTitle = titleInput || defaultTitle;
    const threadBody = bodyInput || defaultBody;

    if (!threadTitle || threadTitle.length > MAX_THREAD_TITLE_LEN) {
      await safeReply(interaction, buildTextReply(
        `Thread title must be between 1 and ${MAX_THREAD_TITLE_LEN} characters.`, false,
      )).catch(() => {});
      return;
    }
    if (!threadBody || threadBody.length > MAX_THREAD_BODY_LEN) {
      await safeReply(interaction, buildTextReply(
        `Initial post must be between 1 and ${MAX_THREAD_BODY_LEN} characters.`, false,
      )).catch(() => {});
      return;
    }

    await runNowPlayingThreadWizard(
      interaction,
      gameId,
      game.title,
      {
        threadTitle,
        initialPost: threadBody,
        sourceChannelId,
        sourceMessageId,
      },
    );
  }
}
