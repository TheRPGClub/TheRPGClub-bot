import { ActivityType, Client } from "discord.js";
import type { AnyRepliable } from "./InteractionUtils.js";
import BotPresenceHistory, { type IPresenceHistoryEntry } from "../classes/BotPresenceHistory.js";
import { PREVIEW_PRESENCE } from "../config/previewMode.js";
import { logError, logInfo } from "../utilities/LogUtils.js";

export type { IPresenceHistoryEntry };

async function internalSetPresence(
  client: Client,
  activityName: string,
  userId: string | null = null,
  username: string | null = null,
  saveToDb: boolean = false,
): Promise<void> {
  client.user!.setPresence({
    activities: [
      {
        name: activityName,
        type: ActivityType.Playing,
      },
    ],
    status: "online",
  });

  // The preview shares production's BotPresenceHistory, and production re-asserts the
  // latest row hourly, so a preview write would change the production bot's status.
  if (!saveToDb || PREVIEW_PRESENCE) return;
  try {
    await BotPresenceHistory.savePresence(activityName, userId, username);
    logInfo("SetPresence", "Presence saved to database.");
  } catch (error) {
    logError("SetPresence.save", error);
  }
}

export async function getPresenceHistory(limit: number): Promise<IPresenceHistoryEntry[]> {
  try {
    return BotPresenceHistory.getPresenceHistory(limit);
  } catch (error) {
    logError("SetPresence.loadHistory", error);
    return [];
  }
}

export async function setPresence(
  interaction: AnyRepliable,
  activityName: string,
): Promise<void> {
  await internalSetPresence(
    interaction.client,
    activityName,
    interaction.user?.id ?? null,
    interaction.user?.tag ?? null,
    true,
  );
}

/**
 * Re-asserts the latest saved presence (or the preview's). Errors are logged and swallowed
 * for the hourly refresh; `throwOnFailure` (a website change's job) lets them escape, and
 * treats no saved presence as a failure too.
 */
export async function updateBotPresence(
  bot: Client,
  options: { throwOnFailure?: boolean } = {},
): Promise<void> {
  if (PREVIEW_PRESENCE) {
    await internalSetPresence(bot, PREVIEW_PRESENCE);
    return;
  }
  try {
    const activityName: string | null = await BotPresenceHistory.getLatestPresenceActivity();
    if (activityName) {
      await internalSetPresence(bot, activityName);
    } else if (options.throwOnFailure) {
      throw new Error("No presence is saved yet, so there is nothing to apply.");
    } else {
      logInfo("SetPresence", "No presence data found in database.");
    }
  } catch (error) {
    if (options.throwOnFailure) throw error;
    logError("SetPresence.read", error);
  }
}
