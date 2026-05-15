import type { Client, GuildMember } from "discord.js";
import { REGULARS_ROLE_ID } from "../config/roles.js";

const EMOJI_NAME_PREFIX = "u_";
const CREATION_THROTTLE_MS = 600;

type EmojiCacheEntry = { emojiId: string };

// userId -> { emojiId }
const emojiCache = new Map<string, EmojiCacheEntry>();
let initialized = false;

function toEmojiName(userId: string): string {
  return `${EMOJI_NAME_PREFIX}${userId}`;
}

function toUserId(emojiName: string): string {
  return emojiName.slice(EMOJI_NAME_PREFIX.length);
}

export function getUserEmojiString(userId: string): string | null {
  const entry = emojiCache.get(userId);
  if (!entry) return null;
  return `<:${toEmojiName(userId)}:${entry.emojiId}>`;
}

export async function startUserEmojiService(client: Client): Promise<void> {
  if (initialized) return;
  initialized = true;
  syncAllRegularsEmoji(client).catch((err) => {
    console.error("[UserEmojiService] Initial sync failed:", err);
  });
}

async function syncAllRegularsEmoji(client: Client): Promise<void> {
  const app = client.application;
  if (!app) {
    console.error("[UserEmojiService] client.application not available.");
    return;
  }

  const existing = await app.emojis.fetch();
  for (const [, emoji] of existing) {
    if (!emoji.name?.startsWith(EMOJI_NAME_PREFIX) || !emoji.id) continue;
    emojiCache.set(toUserId(emoji.name), { emojiId: emoji.id });
  }

  const guild = client.guilds.cache.first();
  if (!guild) {
    console.error("[UserEmojiService] No guild found.");
    return;
  }

  const members = await guild.members.fetch();
  const regulars = members.filter((m) => m.roles.cache.has(REGULARS_ROLE_ID) && !m.user.bot);

  let created = 0;
  for (const [userId, member] of regulars) {
    if (emojiCache.has(userId)) continue;
    const success = await createEmojiForMember(app, member);
    if (success) {
      created++;
      await new Promise((resolve) => setTimeout(resolve, CREATION_THROTTLE_MS));
    }
  }

  console.log(
    `[UserEmojiService] Sync complete. Created ${created} emoji. Cache: ${emojiCache.size}`,
  );
}

async function createEmojiForMember(
  app: NonNullable<Client["application"]>,
  member: GuildMember,
): Promise<boolean> {
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
  try {
    const emoji = await app.emojis.create({ attachment: avatarUrl, name: toEmojiName(member.id) });
    if (emoji.id) {
      emojiCache.set(member.id, { emojiId: emoji.id });
      return true;
    }
  } catch (err) {
    console.error(`[UserEmojiService] Failed to create emoji for ${member.id}:`, err);
  }
  return false;
}

export async function syncUserEmojiFromAvatarChange(
  client: Client,
  userId: string,
  newAvatarUrl: string,
): Promise<void> {
  const app = client.application;
  if (!app) return;

  const existing = emojiCache.get(userId);
  if (existing) {
    try {
      await app.emojis.delete(existing.emojiId);
    } catch (err) {
      console.error(`[UserEmojiService] Failed to delete old emoji for ${userId}:`, err);
    }
    emojiCache.delete(userId);
  }

  try {
    const emoji = await app.emojis.create({
      attachment: newAvatarUrl,
      name: toEmojiName(userId),
    });
    if (emoji.id) {
      emojiCache.set(userId, { emojiId: emoji.id });
    }
  } catch (err) {
    console.error(`[UserEmojiService] Failed to recreate emoji for ${userId}:`, err);
  }
}

export async function ensureUserEmojiForMember(
  client: Client,
  member: GuildMember,
): Promise<void> {
  if (emojiCache.has(member.id)) return;
  const app = client.application;
  if (!app) return;
  await createEmojiForMember(app, member);
}
