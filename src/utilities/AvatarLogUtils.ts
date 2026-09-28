import axios from "axios";
import type { GuildMember, User } from "discord.js";
import {
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { AttachmentBuilder, userMention } from "discord.js";
import Member, { avatarHistoryApiPath, type IAvatarHistoryRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "./DiscordLogUtils.js";
import { COLOR_INFO } from "../config/colors.js";
import {
  buildContainerSend,
  buildTitledContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../services/BackblazeB2Service.js";
import { buildApiErrorMessage, formatApiError } from "./ApiErrorUtils.js";
import { logError, logWarn } from "./LogUtils.js";

async function downloadAvatarBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function resolveAvatarImage(
  record: IAvatarHistoryRecord | null | undefined,
  label: string,
  userId: string,
): { url: string | null; attachment: AttachmentBuilder | null } {
  if (!record) return { url: null, attachment: null };
  if (record.avatarUrl) {
    return { url: record.avatarUrl, attachment: null };
  }
  if (record.avatarBlob) {
    const name = `avatar-${label}-${userId}.png`;
    const attachment = new AttachmentBuilder(record.avatarBlob, { name });
    return { url: `attachment://${name}`, attachment };
  }
  return { url: null, attachment: null };
}

async function uploadAvatarToBackblaze(
  userId: string,
  avatarHash: string,
  discordUrl: string,
): Promise<string | null> {
  try {
    const { url } = await getOrReplaceBackblazeImage(
      `avatars/${userId}/${avatarHash}`,
      avatarHash,
      async () => {
        const buf = await downloadAvatarBuffer(discordUrl);
        if (!buf) throw new Error("Failed to download avatar from Discord");
        return buf;
      },
    );
    return url;
  } catch (err) {
    logWarn("AvatarLogUtils.uploadToBackblaze", (err as Error).message ?? String(err));
    return null;
  }
}

/** Thrown when the avatar history POST answers 404, so no row was saved. */
export class AvatarRecordNotSavedError extends Error {
  constructor(
    readonly userId: string,
    readonly requestBody: unknown,
  ) {
    super(`Avatar history POST for ${userId} returned 404; no row was saved.`);
    this.name = "AvatarRecordNotSavedError";
  }
}

async function storeAvatarRecord(
  userId: string,
  avatarHash: string,
  discordUrl: string,
): Promise<{ saved: boolean; avatarUrl: string }> {
  let avatarUrl = discordUrl;
  if (hasBackblazeB2Config()) {
    avatarUrl = (await uploadAvatarToBackblaze(userId, avatarHash, discordUrl)) ?? discordUrl;
  }
  const saved = await Member.insertAvatarHistoryRecord(userId, avatarHash, avatarUrl);
  return { saved, avatarUrl };
}

export async function updateAvatarRecordFromUrl(
  user: User,
  avatarUrl: string,
  avatarHash: string,
): Promise<boolean> {
  const { saved } = await storeAvatarRecord(user.id, avatarHash, avatarUrl);
  return saved;
}

// A latest row with the same hash but no URL is a legacy blob-only row. It still needs a
// URL record so the API can stop serving the Postgres blob (issue #1073).
export function needsAvatarRecord(
  latest: Pick<IAvatarHistoryRecord, "avatarHash" | "avatarUrl"> | undefined,
  avatarHash: string,
): boolean {
  if (!latest) return true;
  if (latest.avatarHash !== avatarHash) return true;
  return !latest.avatarUrl;
}

export async function recordCurrentAvatarIfNew(member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;
  const avatarHash = member.avatar ?? member.user.avatar;
  if (!avatarHash) return false;

  const latest = await Member.getAvatarHistory(member.user.id, 1, 0);
  if (!needsAvatarRecord(latest[0], avatarHash)) return false;

  await Member.upsertGuildMember(member);
  const discordUrl = member.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
  const { saved, avatarUrl } = await storeAvatarRecord(member.user.id, avatarHash, discordUrl);
  if (!saved) {
    throw new AvatarRecordNotSavedError(member.user.id, {
      data: { avatar_hash: avatarHash, avatar_url: avatarUrl },
    });
  }
  return true;
}

const AVATAR_SCAN_CONCURRENCY = 4;

export interface IAvatarScanFailure {
  userId: string;
  /** Request and response detail, formatted for a Discord reply. */
  detail: string;
}

export interface IAvatarScanResult {
  recorded: number;
  skipped: number;
  failures: IAvatarScanFailure[];
}

function describeAvatarScanFailure(err: unknown): string {
  if (err instanceof AvatarRecordNotSavedError) {
    const path = avatarHistoryApiPath(err.userId);
    return `Avatar record not saved\n${formatApiError("POST", path, err.requestBody, 404, null)}`;
  }
  return buildApiErrorMessage("Avatar record failed", err);
}

// Runs a few members at a time so a full-guild backfill (Discord download plus Backblaze
// upload per member) finishes well inside the 15 minute interaction token lifetime.
export async function recordCurrentAvatars(
  members: readonly GuildMember[],
): Promise<IAvatarScanResult> {
  const result: IAvatarScanResult = { recorded: 0, skipped: 0, failures: [] };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < members.length) {
      const member = members[next++];
      try {
        if (await recordCurrentAvatarIfNew(member)) result.recorded++;
        else result.skipped++;
      } catch (err) {
        logError(`AvatarLogUtils.recordCurrentAvatars user=${member.user.id}`, err);
        result.failures.push({ detail: describeAvatarScanFailure(err), userId: member.user.id });
      }
    }
  };
  const workerCount = Math.min(AVATAR_SCAN_CONCURRENCY, members.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
}

// A Components V2 message allows 4000 characters of text in total, so the scan reply spends
// 500 on the summary and at most 3 x 1000 on failure details, leaving room for the heading.
export const AVATAR_SCAN_SUMMARY_MAX_CHARS = 500;
const AVATAR_SCAN_FAILURE_DETAIL_MAX = 3;
const AVATAR_SCAN_FAILURE_MAX_CHARS = 1000;
const CODE_FENCE_CLOSE = "\n```";

// Truncating a long response body can cut inside its JSON code block; close it so the
// display still renders as intended.
function closeOpenCodeFence(text: string): string {
  const fenceCount = text.split("```").length - 1;
  return fenceCount % 2 === 1 ? `${text}${CODE_FENCE_CLOSE}` : text;
}

/** One text display per failed member (capped), plus a note for any left out. */
export function buildScanFailureDisplays(
  failures: readonly IAvatarScanFailure[],
): TextDisplayBuilder[] {
  const shown = failures.slice(0, AVATAR_SCAN_FAILURE_DETAIL_MAX);
  const displays = shown.map((failure) => {
    const text = closeOpenCodeFence(
      safeV2TextContent(
        `### Failed: ${userMention(failure.userId)} (${failure.userId})\n${failure.detail}`,
        AVATAR_SCAN_FAILURE_MAX_CHARS - CODE_FENCE_CLOSE.length,
      ),
    );
    return new TextDisplayBuilder().setContent(
      safeV2TextContent(text, AVATAR_SCAN_FAILURE_MAX_CHARS),
    );
  });
  const omitted = failures.length - shown.length;
  if (omitted > 0) {
    const plural = omitted !== 1 ? "s" : "";
    displays.push(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(
          `-# ${omitted} more failure${plural} not shown; see the bot logs.`,
          AVATAR_SCAN_FAILURE_MAX_CHARS,
        ),
      ),
    );
  }
  return displays;
}

export async function logAvatarChange(
  client: any,
  user: User,
  title: string,
): Promise<void> {
  const logChannel = await resolveLogChannel(client);
  if (!logChannel) return;

  const history = await Member.getAvatarHistory(user.id, 2);
  if (!history.length) return;

  const afterRecord = history[0];
  const beforeRecord = history[1] ?? null;
  const beforeImage = resolveAvatarImage(beforeRecord, "before", user.id);
  const afterImage = resolveAvatarImage(afterRecord, "after", user.id);

  if (!afterImage.url) return;

  const authorName = user.globalName ?? user.username;
  const beforeLabel = beforeImage.url ? "" : "Unknown";
  const afterLabel = afterImage.url ? "" : "Unknown";
  const body =
    `*${authorName}*\n` +
    `**Before:** ${beforeLabel}\n**After:** ${afterLabel}\n` +
    `-# ID: ${user.id} • ${formatTimestampWithDay(afterRecord.changedAt.getTime())}`;
  const container = buildTitledContainer(title, body, { color: COLOR_INFO });

  const galleryItems = [afterImage.url, beforeImage.url].filter(Boolean) as string[];
  if (galleryItems.length) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        ...galleryItems.map((url) => new MediaGalleryItemBuilder().setURL(url)),
      ),
    );
  }

  const files = [beforeImage.attachment, afterImage.attachment]
    .filter(Boolean) as AttachmentBuilder[];
  await (logChannel as any).send({
    ...buildContainerSend(container),
    files: files.length ? files : undefined,
  });
}
