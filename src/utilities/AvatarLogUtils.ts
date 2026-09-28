import axios from "axios";
import type { GuildMember, User } from "discord.js";
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from "@discordjs/builders";
import { AttachmentBuilder } from "discord.js";
import Member, { type IAvatarHistoryRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "./DiscordLogUtils.js";
import { COLOR_INFO } from "../config/colors.js";
import { buildTitledContainer, buildContainerSend } from "../functions/ComponentsV2Utils.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../services/BackblazeB2Service.js";
import { logWarn } from "./LogUtils.js";

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

async function storeAvatarRecord(
  userId: string,
  avatarHash: string,
  discordUrl: string,
): Promise<boolean> {
  if (hasBackblazeB2Config()) {
    const storedUrl = await uploadAvatarToBackblaze(userId, avatarHash, discordUrl);
    if (storedUrl) {
      await Member.insertAvatarHistoryRecord(userId, avatarHash, storedUrl);
      return true;
    }
  }

  await Member.insertAvatarHistoryRecord(userId, avatarHash, discordUrl);
  return true;
}

export async function updateAvatarRecordFromUrl(
  user: User,
  avatarUrl: string,
  avatarHash: string,
): Promise<boolean> {
  return storeAvatarRecord(user.id, avatarHash, avatarUrl);
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

  const discordUrl = member.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
  return storeAvatarRecord(member.user.id, avatarHash, discordUrl);
}

const AVATAR_SCAN_CONCURRENCY = 4;

export interface IAvatarScanResult {
  recorded: number;
  skipped: number;
  failed: number;
}

// Runs a few members at a time so a full-guild backfill (Discord download plus Backblaze
// upload per member) finishes well inside the 15 minute interaction token lifetime.
export async function recordCurrentAvatars(
  members: readonly GuildMember[],
): Promise<IAvatarScanResult> {
  const result: IAvatarScanResult = { recorded: 0, skipped: 0, failed: 0 };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < members.length) {
      const member = members[next++];
      try {
        if (await recordCurrentAvatarIfNew(member)) result.recorded++;
        else result.skipped++;
      } catch {
        result.failed++;
      }
    }
  };
  const workerCount = Math.min(AVATAR_SCAN_CONCURRENCY, members.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return result;
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
