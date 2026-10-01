// Platform selection workflow for game completions

import type {
  CommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from "discord.js";
import { StringSelectMenuBuilder } from "discord.js";
import {
  replyIfNotOwner,
  safeDeferUpdate,
  safeFollowUpIfSettled,
  safeReply,
} from "../../functions/InteractionUtils.js";
import {
  notifyUnknownCompletionPlatform,
  saveCompletion,
} from "../../functions/CompletionHelpers.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import {
  COMPLETION_PLATFORM_SELECT_PREFIX,
  completionPlatformSessions,
  type CompletionPlatformContext,
} from "./completion.types.js";
import { truncateLabel } from "../../config/textLimits.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import { buildSelectRow } from "../../functions/uiComponents.js";
import GamePlatformRegionService from "../../classes/GamePlatformRegionService.js";
import {
  createResumableSessionRegistry,
  type PersistedSessionLocation,
} from "../../services/PersistedInteractionSessionStore.js";
import {
  completionPlatformContextFromJson,
  completionPlatformContextToJson,
} from "./completion-platform-context.codec.js";

const COMPLETION_PLATFORM_SESSION_ID_PREFIX = "comp-platform";
const COMPLETION_PLATFORM_EXPIRED_MESSAGE = "This completion prompt has expired.";
const COMPLETION_PLATFORM_NOT_OWNER_MESSAGE = "This completion prompt isn't for you.";
const completionPlatformRegistry = createResumableSessionRegistry<CompletionPlatformContext>({
  kind: "completion-platform",
  sessions: completionPlatformSessions,
  fromState: (state) => completionPlatformContextFromJson(state),
});

/** Returns the owner id built into a session id, or null when the id has none. */
function parseCompletionPlatformOwnerId(sessionId: string): string | null {
  const prefix = `${COMPLETION_PLATFORM_SESSION_ID_PREFIX}-`;
  if (!sessionId.startsWith(prefix)) return null;
  const [ownerId] = sessionId.slice(prefix.length).split("-");
  return ownerId && /^\d+$/.test(ownerId) ? ownerId : null;
}

/**
 * Creates a platform prompt session and returns its id. The context is also
 * persisted so the select still works after a bot restart.
 */
export function createCompletionPlatformSession(
  ctx: CompletionPlatformContext,
  userId: string,
  location: PersistedSessionLocation,
): string {
  // The timestamp keeps a re-prompt for the same game from sharing a persisted row
  // with an earlier prompt that is still being finished.
  const sessionId =
    `${COMPLETION_PLATFORM_SESSION_ID_PREFIX}-${userId}-${ctx.gameId}-${Date.now()}`;
  completionPlatformRegistry.create({
    sessionId,
    session: ctx,
    ownerId: userId,
    location,
    state: completionPlatformContextToJson(ctx),
  });
  return sessionId;
}

export async function promptCompletionPlatformSelection(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  ctx: Omit<CompletionPlatformContext, "platforms">,
): Promise<void> {
  const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
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
  const sessionId = createCompletionPlatformSession(
    { ...ctx, platforms: platformOptions },
    interaction.user.id,
    { channelId: interaction.channelId, guildId: interaction.guildId },
  );

  const baseOptions = platformOptions.map((platform) => ({
    label: truncateLabel(platform.name),
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
    components: [buildSelectRow(select)],
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleCompletionPlatformSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const segs = assertCustomIdSegments(interaction, 1);
  if (!segs) return;
  const [sessionId] = segs;
  const ownerId = parseCompletionPlatformOwnerId(sessionId) ?? interaction.user.id;
  if (await replyIfNotOwner(interaction, ownerId, COMPLETION_PLATFORM_NOT_OWNER_MESSAGE)) return;

  // Ack first: restoring the prompt after a restart reads the API, which can
  // outlast Discord's 3 second window. Replies below are ephemeral follow-ups so
  // they never overwrite the prompt.
  await safeDeferUpdate(interaction);
  let ctx: CompletionPlatformContext | undefined;
  try {
    ctx = await completionPlatformRegistry.resolve(sessionId, {
      ownerId,
      channelId: interaction.channelId,
    });
  } catch (err: unknown) {
    logError("CompletionPlatform.restoreSession", err);
    await safeFollowUpIfSettled(interaction, buildErrorReply(
      buildApiErrorMessage("Could not restore this completion prompt.", err),
      true,
    ));
    return;
  }

  if (!ctx) {
    await safeFollowUpIfSettled(
      interaction,
      buildTextReply(COMPLETION_PLATFORM_EXPIRED_MESSAGE, true),
    );
    return;
  }
  if (ctx.userId !== interaction.user.id) {
    await safeFollowUpIfSettled(
      interaction,
      buildTextReply(COMPLETION_PLATFORM_NOT_OWNER_MESSAGE, true),
    );
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
    await safeFollowUpIfSettled(interaction, buildTextReply("Invalid platform selection.", true));
    return;
  }
  // A second click while the first is still saving must not log it twice.
  if (!completionPlatformRegistry.claim(sessionId)) return;

  try {
    await saveSelectedPlatform(interaction, ctx, platformId, isOther);
  } finally {
    completionPlatformRegistry.finish(sessionId);
  }
}

async function saveSelectedPlatform(
  interaction: StringSelectMenuInteraction,
  ctx: CompletionPlatformContext,
  platformId: number | null,
  isOther: boolean,
): Promise<void> {
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
}

export async function resolveDefaultCompletionPlatformId(gameId: number): Promise<number | null> {
  const platforms = await GamePlatformRegionService.getPlatformsForGameWithStandard(
    gameId,
    STANDARD_PLATFORM_IDS,
  );
  return platforms[0]?.id ?? null;
}
