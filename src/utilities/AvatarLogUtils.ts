import axios from "axios";
import { AttachmentBuilder } from "discord.js";
import type { GuildMember, User } from "discord.js";
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from "@discordjs/builders";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "./DiscordLogUtils.js";
import { COLOR_INFO } from "../config/colors.js";
import { buildTitledContainer, buildContainerSend } from "../functions/ComponentsV2Utils.js";

type AvatarHistoryRecord = Awaited<ReturnType<typeof Member.getAvatarHistory>>[number];

async function downloadAvatarBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function resolveAvatarImage(
  record: AvatarHistoryRecord | null | undefined,
  label: string,
  userId: string,
): { url: string | null; attachment: AttachmentBuilder | null } {
  if (!record) return { url: null, attachment: null };
  if (record.avatarBlob) {
    const name = `avatar-${label}-${userId}.png`;
    const attachment = new AttachmentBuilder(record.avatarBlob, { name });
    return { url: `attachment://${name}`, attachment };
  }
  if (record.avatarUrl) {
    return { url: record.avatarUrl, attachment: null };
  }
  return { url: null, attachment: null };
}

async function upsertAvatarRecord(
  user: User,
  avatarBlob: Buffer | null,
  opts?: { username?: string | null; globalName?: string | null },
): Promise<void> {
  const existing = await Member.getByUserId(user.id);
  const record: IMemberRecord = {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: opts?.username ?? user.username ?? existing?.username ?? null,
    globalName: opts?.globalName ?? user.globalName ?? existing?.globalName ?? null,
    avatarBlob,
    serverJoinedAt: existing?.serverJoinedAt ?? null,
    serverLeftAt: existing?.serverLeftAt ?? null,
    lastSeenAt: existing?.lastSeenAt ?? null,
    roleAdmin: existing?.roleAdmin ?? 0,
    roleModerator: existing?.roleModerator ?? 0,
    roleRegular: existing?.roleRegular ?? 0,
    roleMember: existing?.roleMember ?? 0,
    roleNewcomer: existing?.roleNewcomer ?? 0,
    messageCount: existing?.messageCount ?? null,
    completionatorUrl: existing?.completionatorUrl ?? null,
    psnUsername: existing?.psnUsername ?? null,
    xblUsername: existing?.xblUsername ?? null,
    nswFriendCode: existing?.nswFriendCode ?? null,
    steamUrl: existing?.steamUrl ?? null,
    profileImage: existing?.profileImage ?? null,
    profileImageAt: existing?.profileImageAt ?? null,
  };

  await Member.upsert(record);
}

export async function updateAvatarRecordFromUrl(
  user: User,
  avatarUrl: string,
): Promise<boolean> {
  const avatarBlob = await downloadAvatarBuffer(avatarUrl);
  if (!avatarBlob) return false;
  await upsertAvatarRecord(user, avatarBlob);
  return true;
}

export async function recordCurrentAvatarIfNew(member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;
  const avatarHash = member.avatar ?? member.user.avatar;
  if (!avatarHash) return false;

  const latest = await Member.getAvatarHistory(member.user.id, 1, 0);
  if (latest.length && latest[0].avatarHash === avatarHash) return false;

  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
  const avatarBlob = await downloadAvatarBuffer(avatarUrl);
  if (!avatarBlob) return false;

  await Member.insertAvatarHistoryRecord(member.user.id, avatarHash, avatarUrl, avatarBlob);
  return true;
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
    `*${authorName}* (<@${user.id}>)\n` +
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
