import type { TextBasedChannel } from "discord.js";
import type { Client } from "discordx";
import { DateTime } from "luxon";
import GameReleaseAnnouncement, {
  type IReleaseAnnouncementCandidate,
} from "../classes/GameReleaseAnnouncement.js";
import { NEW_GAME_ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { buildGameProfileMessagePayload } from "../commands/gamedb.command.js";
import { buildComponentsV2EditFlags } from "../functions/ComponentsV2Utils.js";
import { formatReleaseDate, toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { startTrackedInterval } from "../utilities/IntervalUtils.js";
import { logError, logWarn } from "../utilities/LogUtils.js";

// Hourly check for due announcements: one read of the API's due feed. The
// API keeps each game's announcement schedule current itself on every
// Release write (Gamedb::ReleaseAnnouncementSchedule), so the bot no longer
// sweeps every game to rebuild it. At 60s this check kept Neon's serverless
// compute permanently active; releases are date-scheduled, so hourly is
// more than enough.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BATCH_SIZE = 25;

let gameReleaseTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

type SendableTextChannel = TextBasedChannel & {
  send: (options: any) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
}

// The day is plain text read in UTC: a Discord date stamp renders in the viewer's zone, so a
// 5 March Release would read as 4 March in the Americas. Only the relative hint is a stamp.
export function buildAnnouncementPreface(candidate: IReleaseAnnouncementCandidate): string {
  const releaseDay = formatReleaseDate(candidate.releaseDate, "day");
  const releaseUnix = toUnixTimestamp(candidate.releaseDate);
  return `## Upcoming Game Release\n${releaseDay} (<t:${releaseUnix}:R>)`;
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
      await GameReleaseAnnouncement.markAnnouncementSent(candidate.announcementId, new Date());
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
  gameReleaseTimer = startTrackedInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}
