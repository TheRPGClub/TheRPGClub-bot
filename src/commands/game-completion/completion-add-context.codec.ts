import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import type { CompletionAddContext } from "./completion.types.js";

// JSON shape of a CompletionAddContext persisted for restart recovery (#1165).
type CompletionAddContextJson = Omit<CompletionAddContext, "completedAt"> & {
  completedAt: string | null;
};

export function completionAddContextToJson(ctx: CompletionAddContext): CompletionAddContextJson {
  return { ...ctx, completedAt: ctx.completedAt ? ctx.completedAt.toISOString() : null };
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function completionAddContextFromJson(raw: unknown): CompletionAddContext | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.userId !== "string" || !data.userId) return null;
  if (!COMPLETION_TYPES.includes(data.completionType as CompletionType)) return null;
  if (data.source !== "existing" && data.source !== "igdb") return null;

  let completedAt: Date | null = null;
  if (typeof data.completedAt === "string") {
    completedAt = new Date(data.completedAt);
    if (Number.isNaN(completedAt.getTime())) return null;
  }

  const platformId = optionalNumber(data.selectedPlatformId);
  return {
    userId: data.userId,
    completionType: data.completionType as CompletionType,
    completedAt,
    finalPlaytimeHours: optionalNumber(data.finalPlaytimeHours) ?? null,
    selectedPlatformId: platformId != null && !isPositiveInt(platformId) ? null : platformId,
    note: typeof data.note === "string" ? data.note : null,
    source: data.source,
    query: typeof data.query === "string" ? data.query : undefined,
    announce: typeof data.announce === "boolean" ? data.announce : undefined,
  };
}
