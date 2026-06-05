// Platform selection workflow for game completions

import type {
  CommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from "discord.js";
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { safeDeferUpdate, safeReply } from "../../functions/InteractionUtils.js";
import {
  notifyUnknownCompletionPlatform,
  saveCompletion,
} from "../../functions/CompletionHelpers.js";
import { buildComponentsV2Flags, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import Game from "../../classes/Game.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import {
  COMPLETION_PLATFORM_SELECT_PREFIX,
  completionPlatformSessions,
  type CompletionPlatformContext,
} from "./completion.types.js";

export function createCompletionPlatformSession(
  ctx: CompletionPlatformContext,
  userId: string,
): string {
  const sessionId = `comp-platform-${userId}-${ctx.gameId}`;
  completionPlatformSessions.set(sessionId, ctx);
  return sessionId;
}

export async function promptCompletionPlatformSelection(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  ctx: Omit<CompletionPlatformContext, "platforms">,
): Promise<void> {
  const platforms = await Game.getPlatformsForGameWithStandard(
    ctx.gameId,
    STANDARD_PLATFORM_IDS,
  );
  if (!platforms.length) {
    await safeReply(
      interaction,
      buildTextReply("No platform release data is available for this game.", true),
    );
    return;
  }

  const platformOptions = [...platforms]
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .map((platform) => ({
      id: platform.id,
      name: platform.name,
    }));
  const sessionId = createCompletionPlatformSession({
    ...ctx,
    platforms: platformOptions,
  }, interaction.user.id);

  const baseOptions = platformOptions.map((platform) => ({
    label: platform.name.slice(0, 100),
    value: String(platform.id),
  }));
  const options = [
    ...baseOptions.slice(0, 24),
    { label: "Other", value: "other" },
  ];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${COMPLETION_PLATFORM_SELECT_PREFIX}:${sessionId}`)
    .setPlaceholder("Select the platform")
    .addOptions(options);
  await safeReply(interaction, {
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleCompletionPlatformSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, sessionId] = interaction.customId.split(":");
  const ctx = completionPlatformSessions.get(sessionId);

  if (!ctx) {
    await safeReply(
      interaction,
      buildTextReply("This completion prompt has expired.", true),
    ).catch(() => {});
    return;
  }

  if (interaction.user.id !== ctx.userId) {
    await safeReply(
      interaction,
      buildTextReply("This completion prompt isn't for you.", true),
    ).catch(() => {});
    return;
  }

  const selected = interaction.values?.[0];
  const isOther = selected === "other";
  let platformId: number | null = null;
  if (!isOther) {
    const parsedId = Number(selected);
    if (Number.isInteger(parsedId)) {
      platformId = parsedId;
    }
  }
  const valid = isOther || (
    platformId !== null &&
    ctx.platforms.some((platform) => platform.id === platformId)
  );
  if (!valid) {
    await safeReply(
      interaction,
      buildTextReply("Invalid platform selection.", true),
    ).catch(() => {});
    return;
  }

  await safeDeferUpdate(interaction).catch(() => {});
  completionPlatformSessions.delete(sessionId);

  if (isOther) {
    await notifyUnknownCompletionPlatform(interaction, ctx.gameTitle, ctx.gameId);
  }

  await saveCompletion(
    interaction,
    ctx.userId,
    ctx.gameId,
    platformId,
    ctx.completionType,
    ctx.completedAt,
    ctx.finalPlaytimeHours,
    ctx.note,
    ctx.gameTitle,
    ctx.announce,
    false,
    ctx.removeFromNowPlaying,
  );

  await safeReply(interaction, { components: [] }).catch(() => {});
}

export async function resolveDefaultCompletionPlatformId(gameId: number): Promise<number | null> {
  const platforms = await Game.getPlatformsForGameWithStandard(
    gameId,
    STANDARD_PLATFORM_IDS,
  );
  return platforms[0]?.id ?? null;
}
