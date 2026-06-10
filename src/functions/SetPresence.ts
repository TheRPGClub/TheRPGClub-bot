import { ActivityType, Client } from "discord.js";
import type { AnyRepliable } from "./InteractionUtils.js";
import BotPresenceHistory, { type IPresenceHistoryEntry } from "../classes/BotPresenceHistory.js";
import { logError } from "../utilities/LogUtils.js";

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

  if (saveToDb) {
    try {
      await BotPresenceHistory.savePresence(activityName, userId, username);
      console.log("Presence saved to database.");
    } catch (error) {
      logError("SetPresence.save", error);
    }
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

export async function updateBotPresence(bot: Client): Promise<void> {
  try {
    const activityName: string | null = await BotPresenceHistory.getLatestPresenceActivity();
    if (activityName) {
      await internalSetPresence(bot, activityName);
    } else {
      console.log("No presence data found in database.");
    }
  } catch (error) {
    logError("SetPresence.read", error);
  }
}
