import type { TextBasedChannel } from "discord.js";
import type { Client } from "discordx";
import { DateTime } from "luxon";
import GameReleaseAnnouncement, {
  type IReleaseAnnouncementCandidate,
} from "../classes/GameReleaseAnnouncement.js";
import { NEW_GAME_ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { buildGameProfileMessagePayload } from "../commands/gamedb.command.js";
import { buildComponentsV2EditFlags } from "../functions/ComponentsV2Utils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";

// Coarse safety-net sweep. Each cycle runs several queries against the GameDB
// (now on Neon). At 60s this kept Neon's serverless compute permanently active
// (never scaling to zero), which accounts for most of our Neon compute-hour
// cost. Releases are date-scheduled, so hourly is more than enough. Immediate,
// on-demand announcing will move to an API endpoint in therpgclub-api so admins
// can trigger it manually instead of relying on a tight poll.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 25;
const RELEASE_SCHEDULING_ZONE = "UTC";

let gameReleaseTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

type SendableTextChannel = TextBasedChannel & {
  send: (options: any) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function buildAnnouncementPreface(candidate: IReleaseAnnouncementCandidate): string {
  const releaseTime = DateTime.fromJSDate(candidate.releaseDate).setZone(RELEASE_SCHEDULING_ZONE);
  const releaseUnix = Math.floor(releaseTime.toSeconds());
  return `## Upcoming Game Release\n<t:${releaseUnix}:F> (<t:${releaseUnix}:R>)`;
}

async function fetchGameNewsChannel(client: Client): Promise<SendableTextChannel | null> {
  const channel = await client.channels.fetch(NEW_GAME_ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }
  return isSendableTextChannel(channel) ? channel : null;
}

function getGuildId(channel: SendableTextChannel): string | undefined {
  if ("guildId" in channel && typeof channel.guildId === "string") {
    return channel.guildId;
  }
  return undefined;
}

async function checkAndSendReleaseAnnouncements(client: Client): Promise<void> {
  const now = DateTime.utc().toJSDate();
  await GameReleaseAnnouncement.syncReleaseAnnouncements();
  await GameReleaseAnnouncement.markNonCanonicalAnnouncements();
  await GameReleaseAnnouncement.markMissedAnnouncements(now);

  const due = await GameReleaseAnnouncement.listDueAnnouncements(now, BATCH_SIZE);
  if (!due.length) {
    return;
  }

  const channel = await fetchGameNewsChannel(client);
  if (!channel) {
    logWarn("GameReleaseAnnouncementService.announceRelease", `Game news channel ${NEW_GAME_ANNOUNCEMENT_CHANNEL_ID} is unavailable.`);
    return;
  }

  for (const candidate of due) {
    try {
      const payload = await buildGameProfileMessagePayload(candidate.gameId, {
        includeActions: false,
        guildId: getGuildId(channel),
        prefaceText: buildAnnouncementPreface(candidate),
      });
      if (!payload) {
        logWarn("GameReleaseAnnouncementService.announceRelease", `Missing GameDB profile for release ${candidate.releaseId}.`);
        continue;
      }
      await channel.send({
        files: payload.files,
        components: payload.components,
        flags: buildComponentsV2EditFlags(),
      });
      await GameReleaseAnnouncement.markAnnouncementSent(candidate.releaseId, new Date());
    } catch (err) {
      logError("GameReleaseAnnouncementService.releaseAnnouncement", err);
    }
  }
}

export function startGameReleaseAnnouncementService(client: Client): void {
  if (gameReleaseTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyChecking) {
      return;
    }
    currentlyChecking = true;
    try {
      await checkAndSendReleaseAnnouncements(client);
    } catch (err) {
      logError("GameReleaseAnnouncementService.announcementCycle", err);
    } finally {
      currentlyChecking = false;
    }
  };

  void run();
  gameReleaseTimer = setInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}
