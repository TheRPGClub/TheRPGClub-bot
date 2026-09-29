import type { Client } from "discordx";
import { IS_TEST_MODE } from "../config/testMode.js";
import { logInfo } from "../utilities/LogUtils.js";
import { startGameReleaseAnnouncementService } from "./GameReleaseAnnouncementService.js";
import { startPublicReminderService } from "./PublicReminderService.js";
import { startRssFeedService } from "./RssFeedService.js";
import { startThreadSyncService } from "./ThreadSyncService.js";
import { startVotingEventService } from "./VotingEventService.js";

export interface ISharedStateService {
  name: string;
  start: (client: Client) => void;
}

/**
 * Scheduled services that claim or write state shared with production through the API.
 *
 * A PR preview talks to the same API, so whichever bot ticks first would claim a vote
 * event, reminder, news item, or release announcement and post it in the wrong guild.
 */
export const SHARED_STATE_SERVICES: readonly ISharedStateService[] = [
  { name: "VotingEventService", start: startVotingEventService },
  { name: "PublicReminderService", start: startPublicReminderService },
  { name: "ThreadSyncService", start: startThreadSyncService },
  { name: "GameReleaseAnnouncementService", start: startGameReleaseAnnouncementService },
  { name: "RssFeedService", start: startRssFeedService },
];

/** Starts the shared-state services outside test mode. Returns the names it started. */
export function startSharedStateServices(
  client: Client,
  testMode: boolean = IS_TEST_MODE,
  services: readonly ISharedStateService[] = SHARED_STATE_SERVICES,
): string[] {
  if (testMode) {
    const names = services.map((service) => service.name).join(", ");
    logInfo("SharedStateServices", `Test mode: skipped ${names}`);
    return [];
  }
  for (const service of services) service.start(client);
  return services.map((service) => service.name);
}
