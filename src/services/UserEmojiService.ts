import sharp from "sharp";
import type { Client, Guild, GuildMember } from "discord.js";
import Member from "../classes/Member.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { fetchAllGuildMembers } from "../functions/GuildMemberFetch.js";
import { sleep } from "../utilities/DelayUtils.js";
import { startTrackedInterval } from "../utilities/IntervalUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { setInvalidEmojiHandler } from "../functions/InvalidEmojiRetry.js";
import {
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  MODERATOR_ROLE_ID,
  NEWCOMERS_ROLE_ID,
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
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Application emojis belong to the bot application, not a guild, so a test mode bot running
 * as the same application shares them with production. Letting it create, delete, or rename
 * them (or clear DB emoji names) swaps the IDs out from under the production cache, so test
 * mode only reads them.
 */
const EMOJI_WRITES_ENABLED = !IS_TEST_MODE;

const QUALIFYING_ROLE_IDS = [
  REGULARS_ROLE_ID,
  ADMIN_ROLE_ID,
  MODERATOR_ROLE_ID,
  MEMBER_ROLE_ID,
  NEWCOMERS_ROLE_ID,
].filter((id): id is string => id !== null);

function getHomeGuild(client: Client): Guild | undefined {
  return client.guilds.cache.get(HOME_GUILD_ID);
}

function hasQualifyingRole(member: GuildMember): boolean {
  return QUALIFYING_ROLE_IDS.some((id) => member.roles.cache.has(id));
}

type EmojiCacheEntry = { emojiId: string; emojiName: string };
// rejectedId: the id Discord refused; not re-adopted on the first look after the rejection.
type PendingEntry = EmojiCacheEntry & { rejectedId?: string };

// userId -> { emojiId, emojiName }
const emojiCache = new Map<string, EmojiCacheEntry>();
// Entries evicted because Discord rejected or no longer lists their emoji, awaiting resync.
const pendingResync = new Map<string, PendingEntry>();
let initialized = false;
let serviceClient: Client | null = null;
let initialSyncDone = false;
let reconcileInFlight: Promise<void> | null = null;

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

export function getUserEmojiData(userId: string): { name: string; id: string } | null {
  const entry = emojiCache.get(userId);
  if (!entry) return null;
  return { name: entry.emojiName, id: entry.emojiId };
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
  serviceClient = client;
  setInvalidEmojiHandler(reportInvalidUserEmojis);
  const initialSync = EMOJI_WRITES_ENABLED
    ? syncAllUserEmoji(client, process.env["FORCE_EMOJI_REFRESH"] === "true")
    : loadUserEmojiCacheReadOnly(client);
  initialSync
    .catch((err) => {
      logError("UserEmojiService.initialSync", err);
    })
    .finally(() => {
      initialSyncDone = true;
      startTrackedInterval(() => {
        scheduleReconcile(client);
      }, RECONCILE_INTERVAL_MS);
    });
}

/** Test mode: fills the cache from the DB names and the live emojis, changing neither. */
async function loadUserEmojiCacheReadOnly(client: Client): Promise<void> {
  const app = client.application;
  if (!app) {
    logError("UserEmojiService", "client.application not available");
    return;
  }
  const dbEntries = await Member.getAllWithEmojiName();
  const liveIdsByName = await fetchLiveEmojiIdsByName(app);
  for (const { userId, emojiName } of dbEntries) {
    const emojiId = liveIdsByName.get(emojiName);
    if (emojiId) emojiCache.set(userId, { emojiId, emojiName });
  }
  logInfo("UserEmojiService", `Test mode: loaded ${emojiCache.size} emoji read-only.`);
}

async function fetchLiveEmojiIdsByName(
  app: NonNullable<Client["application"]>,
): Promise<Map<string, string>> {
  const existing = await app.emojis.fetch();
  const idsByName = new Map<string, string>();
  for (const [, emoji] of existing) {
    if (!emoji.name?.startsWith(EMOJI_NAME_PREFIX) || !emoji.id) continue;
    idsByName.set(emoji.name, emoji.id);
  }
  return idsByName;
}

/**
 * Called when Discord rejects a component emoji. Evicts every user whose cached emoji has
 * one of those ids, so the next render has no emoji, then resyncs them in the background.
 */
export function reportInvalidUserEmojis(emojiIds: readonly string[]): void {
  const rejected = new Set(emojiIds);
  for (const [userId, entry] of emojiCache) {
    if (!rejected.has(entry.emojiId)) continue;
    emojiCache.delete(userId);
    pendingResync.set(userId, { ...entry, rejectedId: entry.emojiId });
    logInfo("UserEmojiService", `Evicted stale emoji ${entry.emojiName} (${entry.emojiId})`);
  }
  if (pendingResync.size && serviceClient && initialSyncDone) {
    scheduleReconcile(serviceClient);
  }
}

function scheduleReconcile(client: Client): void {
  if (reconcileInFlight) return;
  reconcileInFlight = reconcileUserEmojiCache(client)
    .catch((err) => {
      logError("UserEmojiService.reconcile", err);
    })
    .finally(() => {
      reconcileInFlight = null;
    });
}

/**
 * Checks the cache against the application's live emojis. An entry whose emoji is gone
 * adopts the live emoji with the same name (another process recreated it) or, outside test
 * mode, has its emoji recreated from the member's avatar.
 */
async function reconcileUserEmojiCache(client: Client): Promise<void> {
  const app = client.application;
  if (!app) return;
  // Entries written while the fetch is in flight (an avatar or name change) are newer than
  // the listing, so only entries unchanged since before the fetch are checked against it.
  const snapshot = new Map(emojiCache);
  const liveIdsByName = await fetchLiveEmojiIdsByName(app);
  const liveIds = new Set(liveIdsByName.values());
  for (const [userId, entry] of snapshot) {
    if (liveIds.has(entry.emojiId) || emojiCache.get(userId) !== entry) continue;
    emojiCache.delete(userId);
    pendingResync.set(userId, entry);
  }

  for (const [userId, entry] of [...pendingResync]) {
    pendingResync.delete(userId);
    if (emojiCache.has(userId)) continue;
    const liveId = liveIdsByName.get(entry.emojiName);
    if (liveId && liveId === entry.rejectedId) {
      // Still listed under the id Discord just refused; look again next cycle.
      pendingResync.set(userId, { emojiId: entry.emojiId, emojiName: entry.emojiName });
      continue;
    }
    if (liveId) {
      emojiCache.set(userId, { emojiId: liveId, emojiName: entry.emojiName });
      logInfo("UserEmojiService", `Adopted live emoji ${entry.emojiName} (${liveId})`);
      continue;
    }
    if (!EMOJI_WRITES_ENABLED) continue;
    const member = await getHomeGuild(client)?.members.fetch(userId).catch(() => null);
    if (member && await uploadUserEmoji(app, member, entry.emojiName)) {
      logInfo("UserEmojiService", `Recreated missing emoji ${entry.emojiName}`);
      await sleep(CREATION_THROTTLE_MS);
    }
  }
}

/** Uploads the member's circular avatar as `emojiName` and caches it. Returns success. */
async function uploadUserEmoji(
  app: NonNullable<Client["application"]>,
  member: GuildMember,
  emojiName: string,
): Promise<boolean> {
  const avatarUrl = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
  try {
    const emoji = await app.emojis.create({
      attachment: await circularCropAvatar(avatarUrl),
      name: emojiName,
    });
    if (!emoji.id) return false;
    emojiCache.set(member.id, { emojiId: emoji.id, emojiName });
    return true;
  } catch (err) {
    logError("UserEmojiService.createEmoji", err);
    return false;
  }
}

async function syncAllUserEmoji(client: Client, forceRefresh = false): Promise<void> {
  if (forceRefresh) {
    logInfo("UserEmojiService", "FORCE_EMOJI_REFRESH detected -- all emojis will be re-uploaded.");
  }
  const app = client.application;
  if (!app) {
    logError("UserEmojiService", "client.application not available");
    return;
  }

  // Load DB-stored emoji names as the source of truth for userId -> emojiName
  const dbEntries = await Member.getAllWithEmojiName();
  const dbUserToName = new Map(dbEntries.map((e) => [e.userId, e.emojiName]));
  const dbNameToUser = new Map(dbEntries.map((e) => [e.emojiName, e.userId]));

  // Load existing Discord emojis: emojiName -> emojiId
  const discordEmojis = await fetchLiveEmojiIdsByName(app);

  const guild = getHomeGuild(client);
  if (!guild) {
    logError("UserEmojiService", `home guild ${HOME_GUILD_ID} not in the guild cache`);
    return;
  }

  const members = await fetchAllGuildMembers(guild);
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
        let deleted = true;
        try {
          await app.emojis.delete(emojiId);
        } catch (err) {
          logError("UserEmojiService.deleteEmojiForRefresh", err);
          deleted = false;
        }
        if (!deleted) continue;
      }
      if (await uploadUserEmoji(app, member, storedName)) {
        claimedNames.add(storedName);
        created++;
        await sleep(CREATION_THROTTLE_MS);
      }
    }
  }

  // Create emojis for members with no DB entry yet
  for (const [, member] of regulars) {
    if (emojiCache.has(member.id)) continue;
    const success = await createEmojiForMember(app, member);
    if (success) {
      created++;
      await sleep(CREATION_THROTTLE_MS);
    }
  }

  // Delete unclaimed u_ emojis and clear their DB entries
  for (const [emojiName, emojiId] of discordEmojis) {
    if (claimedNames.has(emojiName)) continue;
    try {
      await app.emojis.delete(emojiId);
      logInfo("UserEmojiService", `Deleted orphaned emoji: ${emojiName}`);
    } catch (err) {
      logError("UserEmojiService.deleteOrphanEmoji", err);
    }
    const orphanUserId = dbNameToUser.get(emojiName);
    if (orphanUserId) {
      await Member.updateEmojiName(orphanUserId, null).catch((err) => {
        logError("UserEmojiService.clearEmojiName", err);
      });
    }
  }

  logInfo("UserEmojiService", `Sync complete. Created ${created} emoji. Cache: ${emojiCache.size}`);
}

async function createEmojiForMember(
  app: NonNullable<Client["application"]>,
  member: GuildMember,
): Promise<boolean> {
  const emojiName = buildEmojiName(member);
  if (!await uploadUserEmoji(app, member, emojiName)) return false;
  await Member.updateEmojiName(member.id, emojiName).catch((err) => {
    logError("UserEmojiService.saveEmojiName", err);
  });
  return true;
}

export async function syncUserEmojiFromAvatarChange(
  client: Client,
  userId: string,
  newAvatarUrl: string,
): Promise<void> {
  const app = client.application;
  if (!app || !EMOJI_WRITES_ENABLED) return;

  const existing = emojiCache.get(userId);
  if (!existing) return;

  try {
    await app.emojis.delete(existing.emojiId);
  } catch (err) {
    logError("UserEmojiService.deleteOldEmoji", err);
    // If delete fails the old emoji still holds the name -- skip create to avoid ALREADY_TAKEN.
    return;
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
    logError("UserEmojiService.recreateEmoji", err);
  }
}

export async function syncUserEmojiFromDisplayNameChange(
  client: Client,
  member: GuildMember,
): Promise<void> {
  const app = client.application;
  if (!app || !EMOJI_WRITES_ENABLED) return;

  const existing = emojiCache.get(member.id);
  const newEmojiName = buildEmojiName(member);

  if (existing?.emojiName === newEmojiName) return;

  if (existing) {
    try {
      await app.emojis.delete(existing.emojiId);
    } catch (err) {
      logError("UserEmojiService.deleteOldEmoji", err);
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
        logError("UserEmojiService.saveEmojiName", err);
      });
    }
  } catch (err) {
    logError("UserEmojiService.recreateEmoji", err);
  }
}

export async function ensureUserEmojiForMember(
  client: Client,
  member: GuildMember,
): Promise<void> {
  if (emojiCache.has(member.id) || !EMOJI_WRITES_ENABLED) return;
  const app = client.application;
  if (!app) return;
  await createEmojiForMember(app, member);
}
