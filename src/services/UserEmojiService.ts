import type { Client, GuildMember } from "discord.js";
import Member from "../classes/Member.js";
import {
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  MODERATOR_ROLE_ID,
  REGULARS_ROLE_ID,
} from "../config/roles.js";

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
      if (emojiId) {
        emojiCache.set(userId, { emojiId, emojiName: storedName });
        claimedNames.add(storedName);
        continue;
      }
      // Emoji missing from Discord but DB has a name -- recreate it
      const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
      try {
        const emoji = await app.emojis.create({ attachment: avatarUrl, name: storedName });
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
    const emoji = await app.emojis.create({ attachment: avatarUrl, name: emojiName });
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
      attachment: newAvatarUrl,
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
    const emoji = await app.emojis.create({ attachment: avatarUrl, name: newEmojiName });
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
