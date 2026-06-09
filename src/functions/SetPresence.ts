import { ActivityType, Client } from "discord.js";
import type { AnyRepliable } from "./InteractionUtils.js";
import { oraQuery, oraMutate } from "../db/SqlManager.js";
import { isPositiveInt } from "../utilities/ValidationUtils.js";

const PRESENCE_TABLE: string = "BOT_PRESENCE_HISTORY";

async function savePresenceToDatabase(
  activityName: string,
  userId: string | null,
  username: string | null,
): Promise<void> {
  try {
    await oraMutate(
      `INSERT INTO ${PRESENCE_TABLE} (ACTIVITY_NAME, SET_AT, SET_BY_USER_ID, SET_BY_USERNAME)
       VALUES (:activityName, SYSTIMESTAMP, :userId, :username)`,
      { activityName, userId, username },
    );
    console.log("Presence saved to database.");
  } catch (error) {
    console.error("Error saving presence to database:", error);
  }
}

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
    await savePresenceToDatabase(activityName, userId, username);
  }
}

async function readLatestPresenceFromDatabase(): Promise<string | null> {
  try {
    const rows = await oraQuery(
      `SELECT ACTIVITY_NAME
         FROM ${PRESENCE_TABLE}
        ORDER BY SET_AT DESC
        FETCH FIRST 1 ROWS ONLY`,
      {},
      (row: { ACTIVITY_NAME: string }) => row.ACTIVITY_NAME,
    );
    const activityName = rows[0] ?? null;
    if (typeof activityName === "string" && activityName.trim().length > 0) {
      return activityName;
    }
    return null;
  } catch (error) {
    console.error("Error reading presence from database:", error);
    return null;
  }
}

export interface IPresenceHistoryEntry {
  activityName: string;
  setAt: Date | null;
  setByUserId: string | null;
  setByUsername: string | null;
}

export async function getPresenceHistory(limit: number): Promise<IPresenceHistoryEntry[]> {
  const safeLimit: number = isPositiveInt(limit) ? Math.min(limit, 50) : 5;

  try {
    return oraQuery(
      `SELECT ACTIVITY_NAME,
              SET_AT,
              SET_BY_USER_ID,
              SET_BY_USERNAME
         FROM ${PRESENCE_TABLE}
        ORDER BY SET_AT DESC
        FETCH FIRST :limit ROWS ONLY`,
      { limit: safeLimit },
      (row: {
        ACTIVITY_NAME: string;
        SET_AT: Date;
        SET_BY_USER_ID: string | null;
        SET_BY_USERNAME: string | null;
      }) => ({
        activityName: row.ACTIVITY_NAME,
        setAt: row.SET_AT ?? null,
        setByUserId: row.SET_BY_USER_ID ?? null,
        setByUsername: row.SET_BY_USERNAME ?? null,
      }),
    );
  } catch (error) {
    console.error("Error loading presence history from database:", error);
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
  const activityName: string | null = await readLatestPresenceFromDatabase();
  if (activityName) {
    await internalSetPresence(bot, activityName);
  } else {
    console.log("No presence data found in database.");
  }
}
