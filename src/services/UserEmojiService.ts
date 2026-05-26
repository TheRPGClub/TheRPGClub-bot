import sharp from "sharp";
import type { Client, GuildMember } from "discord.js";
import Member from "../classes/Member.js";
import {
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  MODERATOR_ROLE_ID,
  REGULARS_ROLE_ID,
} from "../config/roles.js";

const EMOJI_SIZE = 128;

function buildCircleMask(size: number): Buffer {
  const r = size / 2;
  const mask = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const alpha = dx * dx + dy * dy <= r * r ? 255 : 0;
      const i = (y * size + x) * 4;
      mask[i] = 255;
      mask[i + 1] = 255;
      mask[i + 2] = 255;
      mask[i + 3] = alpha;
    }
  }
  return mask;
}

const circleMaskBuffer = buildCircleMask(EMOJI_SIZE);

async function circularCropAvatar(url: string): Promise<Buffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  return sharp(inputBuffer)
    .resize(EMOJI_SIZE, EMOJI_SIZE, { fit: "cover" })
    .ensureAlpha()
    .composite([{
      input: circleMaskBuffer,
      raw: { width: EMOJI_SIZE, height: EMOJI_SIZE, channels: 4 },
      blend: "dest-in",
    }])
    .png()
    .toBuffer();
}

const EMOJI_NAME_PREFIX = "u_";
const CREATION_THROTTLE_MS = 600;

const QUALIFYING_ROLE_IDS = [
  REGULARS_ROLE_ID,
  ADMIN_ROLE_ID,
  MODERATOR_ROLE_ID,
  MEMBER_ROLE_ID,
].filter((id): id is string => id !== null);

function hasQualifyingRole(member: GuildMember): boolean {
  return QUALIFYING_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

type EmojiCacheEntry = { emojiId: string; emojiName: string };

// userId -> { emojiId, emojiName }
const emojiCache = new Map<string, EmojiCacheEntry>();
let initialized = false;

function sanitizeDisplayName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30)
    .padEnd(2, "x");
}

function buildEmojiName(member: GuildMember): string {
  const sanitized = sanitizeDisplayName(member.displayName);
  const base = `${EMOJI_NAME_PREFIX}${sanitized}`;
  const takenByOther = [...emojiCache.entries()].some(
    ([uid, e]) => e.emojiName === base && uid !== member.id,
  );
  if (!takenByOther) return base;
  const suffix = member.id.slice(-4);
  return `${EMOJI_NAME_PREFIX}${sanitized.slice(0, 26)}_${suffix}`;
}

export function getUserEmojiString(userId: string): string | null {
  const entry = emojiCache.get(userId);
  if (!entry) return null;
  return `<:${entry.emojiName}:${entry.emojiId}>`;
}

const NBSP = " ";

/**
 * Returns `emoji⠀displayName` when the user has a cached emoji, or just
 * `displayName` when they don't.  The gap is a non-breaking space
 * (U+2800) so Discord renders it as a non-collapsing visual space.
 */
export function renderUsernameWithEmoji(userId: string, displayName: string): string {
  const emoji = getUserEmojiString(userId);
  return emoji ? `${emoji}${NBSP}${displayName}` : displayName;
}

export async function startUserEmojiService(client: Client): Promise<void> {
  if (initialized) return;
  initialized = true;
  const forceRefresh = process.env["FORCE_EMOJI_REFRESH"] === "true";
  if (forceRefresh) {
    console.log("[UserEmojiService] FORCE_EMOJI_REFRESH detected -- all emojis will be re-uploaded.");
  }
  syncAllRegularsEmoji(client, forceRefresh).catch((err) => {
    console.error("[UserEmojiService] Initial sync failed:", err);
  });
}

async function syncAllRegularsEmoji(client: Client, forceRefresh = false): Promise<void> {
  const app = client.application;
  if (!app) {
    console.error("[UserEmojiService] client.application not available.");
    return;
  }

  // Load DB-stored emoji names as the source of truth for userId -> emojiName
  const dbEntries = await Member.getAllWithEmojiName();
  const dbUserToName = new Map(dbEntries.map((e) => [e.userId, e.emojiName]));
  const dbNameToUser = new Map(dbEntries.map((e) => [e.emojiName, e.userId]));

  // Load existing Discord emojis
  const existing = await app.emojis.fetch();
  const discordEmojis = new Map<string, string>(); // emojiName -> emojiId
  for (const [, emoji] of existing) {
    if (!emoji.name?.startsWith(EMOJI_NAME_PREFIX) || !emoji.id) continue;
    discordEmojis.set(emoji.name, emoji.id);
  }

  const guild = client.guilds.cache.first();
  if (!guild) {
    console.error("[UserEmojiService] No guild found.");
    return;
  }

  const members = await guild.members.fetch();
  const regulars = members.filter((m) => !m.user.bot && hasQualifyingRole(m));
  const claimedNames = new Set<string>();

  // Claim or create emojis for qualifying members
  let created = 0;
  for (const [userId, member] of regulars) {
    const storedName = dbUserToName.get(userId);

    if (storedName) {
      const emojiId = discordEmojis.get(storedName);
      if (emojiId && !forceRefresh) {
        emojiCache.set(userId, { emojiId, emojiName: storedName });
        claimedNames.add(storedName);
        continue;
      }
      // Delete the existing emoji so it can be re-uploaded (force refresh or missing from Discord)
      if (emojiId) {
        try {
          await app.emojis.delete(emojiId);
        } catch (err) {
          console.error(`[UserEmojiService] Failed to delete emoji for refresh (${member.displayName}):`, err);
        }
      }
      const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
      try {
        const emoji = await app.emojis.create({
          attachment: await circularCropAvatar(avatarUrl),
          name: storedName,
        });
        if (emoji.id) {
          emojiCache.set(userId, { emojiId: emoji.id, emojiName: storedName });
          claimedNames.add(storedName);
          created++;
          await new Promise((resolve) => setTimeout(resolve, CREATION_THROTTLE_MS));
        }
      } catch (err) {
        console.error(`[UserEmojiService] Failed to recreate emoji for ${member.displayName}:`, err);
      }
    }
  }

  // Create emojis for members with no DB entry yet
  for (const [, member] of regulars) {
    if (emojiCache.has(member.id)) continue;
    const success = await createEmojiForMember(app, member);
    if (success) {
      created++;
      await new Promise((resolve) => setTimeout(resolve, CREATION_THROTTLE_MS));
    }
  }

  // Delete unclaimed u_ emojis and clear their DB entries
  for (const [emojiName, emojiId] of discordEmojis) {
    if (claimedNames.has(emojiName)) continue;
    try {
      await app.emojis.delete(emojiId);
      console.log(`[UserEmojiService] Deleted orphaned emoji: ${emojiName}`);
    } catch (err) {
      console.error(`[UserEmojiService] Failed to delete orphan ${emojiName}:`, err);
    }
    const orphanUserId = dbNameToUser.get(emojiName);
    if (orphanUserId) {
      await Member.updateEmojiName(orphanUserId, null).catch((err) => {
        console.error(`[UserEmojiService] Failed to clear emoji name for ${orphanUserId}:`, err);
      });
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
  const emojiName = buildEmojiName(member);
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
  try {
    const emoji = await app.emojis.create({
      attachment: await circularCropAvatar(avatarUrl),
      name: emojiName,
    });
    if (emoji.id) {
      emojiCache.set(member.id, { emojiId: emoji.id, emojiName });
      await Member.updateEmojiName(member.id, emojiName).catch((err) => {
        console.error(`[UserEmojiService] Failed to save emoji name for ${member.id}:`, err);
      });
      return true;
    }
  } catch (err) {
    console.error(`[UserEmojiService] Failed to create emoji for ${member.displayName}:`, err);
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
  if (!existing) return;

  try {
    await app.emojis.delete(existing.emojiId);
  } catch (err) {
    console.error(`[UserEmojiService] Failed to delete old emoji for ${userId}:`, err);
  }
  emojiCache.delete(userId);

  try {
    const emoji = await app.emojis.create({
      attachment: await circularCropAvatar(newAvatarUrl),
      name: existing.emojiName,
    });
    if (emoji.id) {
      emojiCache.set(userId, { emojiId: emoji.id, emojiName: existing.emojiName });
    }
  } catch (err) {
    console.error(`[UserEmojiService] Failed to recreate emoji for ${userId}:`, err);
  }
}

export async function syncUserEmojiFromDisplayNameChange(
  client: Client,
  member: GuildMember,
): Promise<void> {
  const app = client.application;
  if (!app) return;

  const existing = emojiCache.get(member.id);
  const newEmojiName = buildEmojiName(member);

  if (existing?.emojiName === newEmojiName) return;

  if (existing) {
    try {
      await app.emojis.delete(existing.emojiId);
    } catch (err) {
      console.error(`[UserEmojiService] Failed to delete old emoji for ${member.id}:`, err);
    }
    emojiCache.delete(member.id);
  }

  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
  try {
    const emoji = await app.emojis.create({
      attachment: await circularCropAvatar(avatarUrl),
      name: newEmojiName,
    });
    if (emoji.id) {
      emojiCache.set(member.id, { emojiId: emoji.id, emojiName: newEmojiName });
      await Member.updateEmojiName(member.id, newEmojiName).catch((err) => {
        console.error(`[UserEmojiService] Failed to save emoji name for ${member.id}:`, err);
      });
    }
  } catch (err) {
    console.error(`[UserEmojiService] Failed to recreate emoji for ${member.id}:`, err);
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
