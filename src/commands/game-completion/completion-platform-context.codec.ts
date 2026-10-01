import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import type { CompletionPlatformContext } from "./completion.types.js";

// JSON shape of a CompletionPlatformContext persisted for restart recovery (#1226).
type CompletionPlatformContextJson = Omit<CompletionPlatformContext, "completedAt"> & {
  completedAt: string | null;
};

export function completionPlatformContextToJson(
  ctx: CompletionPlatformContext,
): CompletionPlatformContextJson {
  return { ...ctx, completedAt: ctx.completedAt ? ctx.completedAt.toISOString() : null };
}

function parsePlatforms(value: unknown): CompletionPlatformContext["platforms"] | null {
  if (!Array.isArray(value)) return null;
  const platforms: CompletionPlatformContext["platforms"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { id, name } = entry as Record<string, unknown>;
    if (!isPositiveInt(id) || typeof name !== "string") return null;
    platforms.push({ id, name });
  }
  return platforms;
}

export function completionPlatformContextFromJson(
  raw: unknown,
): CompletionPlatformContext | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.userId !== "string" || !data.userId) return null;
  if (!isPositiveInt(data.gameId) || typeof data.gameTitle !== "string") return null;
  if (!COMPLETION_TYPES.includes(data.completionType as CompletionType)) return null;
  const platforms = parsePlatforms(data.platforms);
  if (!platforms) return null;

  let completedAt: Date | null = null;
  if (typeof data.completedAt === "string") {
    completedAt = new Date(data.completedAt);
    if (Number.isNaN(completedAt.getTime())) return null;
  }

  const playtime = data.finalPlaytimeHours;
  return {
    userId: data.userId,
    gameId: data.gameId,
    gameTitle: data.gameTitle,
    completionType: data.completionType as CompletionType,
    completedAt,
    finalPlaytimeHours: typeof playtime === "number" && Number.isFinite(playtime)
      ? playtime
      : null,
    note: typeof data.note === "string" ? data.note : null,
    announce: typeof data.announce === "boolean" ? data.announce : undefined,
    removeFromNowPlaying: data.removeFromNowPlaying === true,
    platforms,
  };
}
