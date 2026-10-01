import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import {
  createResumableSessionRegistry,
  type PersistedSessionLocation,
  type ResumableSessionRegistry,
} from "../../services/PersistedInteractionSessionStore.js";
import {
  replyIfNotOwner,
  safeDeferUpdate,
  safeFollowUpIfSettled,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextContainer,
} from "../../functions/ComponentsV2Utils.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  nowPlayingCompletionPlatformSessions,
  nowPlayingCompletionWizardSessions,
} from "./nowPlayingContexts.js";
import type {
  NowPlayingCompletionPlatformSession,
  NowPlayingCompletionWizardSession,
} from "./nowPlayingTypes.js";

// The completion wizard opened from Now Playing keeps one session per member, and the
// platform picker it falls back to keeps another. Both are persisted to the API's wizard
// session table so their buttons and selects keep working after a bot restart (#1226).

const WIZARD_SESSION_PREFIX = "np-comp-ui";
const PLATFORM_SESSION_PREFIX = "np-comp-platform";
export const NOW_PLAYING_COMPLETION_EXPIRED_MESSAGE = "This completion prompt has expired.";
export const NOW_PLAYING_COMPLETION_NOT_OWNER_MESSAGE = "This completion prompt isn't for you.";

type CompletionInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isCompletionType(value: unknown): value is CompletionType {
  return COMPLETION_TYPES.includes(value as CompletionType);
}

export function wizardSessionFromJson(raw: unknown): NowPlayingCompletionWizardSession | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.userId !== "string" || !data.userId) return null;
  if (data.gameId !== null && !isPositiveInt(data.gameId)) return null;
  if (!isCompletionType(data.completionType)) return null;
  if (!isBoolean(data.removeFromNowPlaying) || !isBoolean(data.announce)) return null;
  if (!isBoolean(data.returnToList)) return null;
  return {
    userId: data.userId,
    gameId: data.gameId,
    completionType: data.completionType,
    removeFromNowPlaying: data.removeFromNowPlaying,
    announce: data.announce,
    returnToList: data.returnToList,
  };
}

type PlatformSessionJson = Omit<NowPlayingCompletionPlatformSession, "completedAt"> & {
  completedAt: string | null;
};

export function platformSessionToJson(
  session: NowPlayingCompletionPlatformSession,
): PlatformSessionJson {
  return {
    ...session,
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
  };
}

function parsePlatforms(value: unknown): NowPlayingCompletionPlatformSession["platforms"] | null {
  if (!Array.isArray(value)) return null;
  const platforms: NowPlayingCompletionPlatformSession["platforms"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { id, name } = entry as Record<string, unknown>;
    if (!isPositiveInt(id) || typeof name !== "string") return null;
    platforms.push({ id, name });
  }
  return platforms;
}

export function platformSessionFromJson(
  raw: unknown,
): NowPlayingCompletionPlatformSession | null {
  const wizard = wizardSessionFromJson(raw);
  if (!wizard || wizard.gameId === null) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.sessionId !== "string" || !data.sessionId) return null;
  const platforms = parsePlatforms(data.platforms);
  if (!platforms) return null;

  let completedAt: Date | null = null;
  if (typeof data.completedAt === "string") {
    completedAt = new Date(data.completedAt);
    if (Number.isNaN(completedAt.getTime())) return null;
  }
  const hours = data.finalPlaytimeHours;
  return {
    ...wizard,
    gameId: wizard.gameId,
    sessionId: data.sessionId,
    completedAt,
    finalPlaytimeHours: typeof hours === "number" && Number.isFinite(hours) ? hours : null,
    note: typeof data.note === "string" ? data.note : null,
    platforms,
  };
}

const wizardRegistry = createResumableSessionRegistry<NowPlayingCompletionWizardSession>({
  kind: "np-complete",
  sessions: nowPlayingCompletionWizardSessions,
  fromState: (state) => wizardSessionFromJson(state),
});

const platformRegistry = createResumableSessionRegistry<NowPlayingCompletionPlatformSession>({
  kind: "np-complete-platform",
  sessions: nowPlayingCompletionPlatformSessions,
  fromState: (state) => platformSessionFromJson(state),
});

function toLocation(interaction: CompletionInteraction): PersistedSessionLocation {
  return { channelId: interaction.channelId, guildId: interaction.guildId };
}

/** Returns the owner id built into a session id, or null when the id has none. */
function parseOwnerId(sessionId: string, prefix: string): string | null {
  const ownerId = sessionId.startsWith(`${prefix}-`) ? sessionId.slice(prefix.length + 1) : "";
  return /^\d+$/.test(ownerId) ? ownerId : null;
}

/**
 * Opens (or restarts) the member's completion wizard. The id is per member, so a new
 * wizard replaces the previous one, in memory and in the persisted row.
 */
export function createNowPlayingCompletionWizardSession(
  interaction: CompletionInteraction,
  userId: string,
  returnToList: boolean = false,
): string {
  const sessionId = `${WIZARD_SESSION_PREFIX}-${userId}`;
  const session: NowPlayingCompletionWizardSession = {
    userId,
    gameId: null,
    completionType: (COMPLETION_TYPES[0] ?? "Main Story") as CompletionType,
    removeFromNowPlaying: true,
    announce: true,
    returnToList,
  };
  wizardRegistry.create({
    sessionId,
    session,
    ownerId: userId,
    location: toLocation(interaction),
    state: session,
  });
  return sessionId;
}

export function getNowPlayingCompletionWizardSession(
  sessionId: string,
): NowPlayingCompletionWizardSession | undefined {
  return wizardRegistry.get(sessionId);
}

/** Saves a wizard step's change so a restart resumes from it. */
export function persistNowPlayingCompletionWizardSession(
  interaction: CompletionInteraction,
  sessionId: string,
  session: NowPlayingCompletionWizardSession,
): void {
  wizardRegistry.persist({
    sessionId,
    ownerId: session.userId,
    location: toLocation(interaction),
    state: session,
  });
}

/**
 * Ends the wizard and deletes its persisted row. After a restart the platform picker
 * can finish a wizard that was never restored, so it is loaded first to learn its row.
 */
export async function finishNowPlayingCompletionWizardSession(
  interaction: CompletionInteraction,
  sessionId: string,
  ownerId: string,
): Promise<void> {
  if (!wizardRegistry.get(sessionId)) {
    await wizardRegistry.resolve(sessionId, { ownerId, channelId: interaction.channelId })
      .catch((err: unknown) => logError("NowPlayingCompletion.finishWizard", err));
  }
  wizardRegistry.finish(sessionId);
}

export function createNowPlayingCompletionPlatformSession(
  interaction: CompletionInteraction,
  session: NowPlayingCompletionPlatformSession,
): string {
  const platformSessionId = `${PLATFORM_SESSION_PREFIX}-${session.userId}`;
  platformRegistry.create({
    sessionId: platformSessionId,
    session,
    ownerId: session.userId,
    location: toLocation(interaction),
    state: platformSessionToJson(session),
  });
  return platformSessionId;
}

/** True for the first pick on a live platform prompt only, so a double pick saves once. */
export function claimNowPlayingCompletionPlatformSession(platformSessionId: string): boolean {
  return platformRegistry.claim(platformSessionId);
}

export function finishNowPlayingCompletionPlatformSession(platformSessionId: string): void {
  platformRegistry.finish(platformSessionId);
}

/**
 * Finds a session in memory, or restores it after a restart. Replies with the expired,
 * not-owner, or restore-failed message and returns undefined when there is none to use.
 * `deferRestore` acknowledges a component before the API read, which can outlast
 * Discord's 3 second window; leave it off where the handler must still open a modal.
 */
async function resolveOwnedSession<S extends { userId: string }>(
  interaction: CompletionInteraction,
  registry: ResumableSessionRegistry<S>,
  sessionId: string,
  prefix: string,
  deferRestore: boolean,
): Promise<S | undefined> {
  const ownerId = parseOwnerId(sessionId, prefix) ?? interaction.user.id;
  const cached = registry.get(sessionId);
  if (!cached) {
    if (await replyIfNotOwner(interaction, ownerId, NOW_PLAYING_COMPLETION_NOT_OWNER_MESSAGE)) {
      return undefined;
    }
    if (deferRestore && interaction.isMessageComponent()) {
      await safeDeferUpdate(interaction);
    }
  }

  let session: S | undefined;
  try {
    session = cached ?? await registry.resolve(sessionId, {
      ownerId,
      channelId: interaction.channelId,
    });
  } catch (err: unknown) {
    logError("NowPlayingCompletion.restoreSession", err);
    await safeFollowUpIfSettled(interaction, buildErrorReply(
      buildApiErrorMessage("Could not restore this completion prompt.", err),
      true,
    ));
    return undefined;
  }

  if (!session) {
    await safeFollowUpIfSettled(interaction, {
      components: [buildTextContainer(NOW_PLAYING_COMPLETION_EXPIRED_MESSAGE)],
      flags: buildComponentsV2Flags(true),
    });
    return undefined;
  }
  if (cached && await replyIfNotOwner(
    interaction,
    session.userId,
    NOW_PLAYING_COMPLETION_NOT_OWNER_MESSAGE,
  )) {
    return undefined;
  }
  return session;
}

export function resolveNowPlayingCompletionWizardSession(
  interaction: CompletionInteraction,
  sessionId: string,
  options: { deferRestore: boolean } = { deferRestore: true },
): Promise<NowPlayingCompletionWizardSession | undefined> {
  return resolveOwnedSession(
    interaction,
    wizardRegistry,
    sessionId,
    WIZARD_SESSION_PREFIX,
    options.deferRestore,
  );
}

export function resolveNowPlayingCompletionPlatformSession(
  interaction: StringSelectMenuInteraction,
  platformSessionId: string,
): Promise<NowPlayingCompletionPlatformSession | undefined> {
  return resolveOwnedSession(
    interaction,
    platformRegistry,
    platformSessionId,
    PLATFORM_SESSION_PREFIX,
    true,
  );
}

/** Plain reply used where the original code replied before acknowledging. */
export async function replyNowPlayingCompletionText(
  interaction: CompletionInteraction,
  text: string,
): Promise<void> {
  await safeFollowUpIfSettled(interaction, {
    components: [buildTextContainer(text)],
    flags: buildComponentsV2Flags(true),
  });
}
