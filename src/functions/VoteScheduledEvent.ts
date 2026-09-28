import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Guild,
  type GuildScheduledEvent,
} from "discord.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";

// External events require an end time; give the vote reminder a 1-hour window.
const VOTE_EVENT_DURATION_MS = 60 * 60 * 1000;

export interface IVoteScheduledEventParams {
  /** The round being voted on. */
  roundNumber: number;
  /** The month that round's winners are played, e.g. "November 2026". */
  monthYear: string;
  startsAt: Date;
}

export function buildVoteScheduledEventName(params: IVoteScheduledEventParams): string {
  return `Round ${params.roundNumber} Vote (${params.monthYear})`;
}

/**
 * Creates the Discord scheduled event for a round's vote, shared by the round
 * setup wizard and the round_decided voting event. An existing vote event with
 * the same name, or any vote event already starting at the same moment (one
 * named the older way), is returned instead, so running both never duplicates.
 */
export async function ensureVoteScheduledEvent(
  guild: Guild,
  params: IVoteScheduledEventParams,
): Promise<{ event: GuildScheduledEvent; created: boolean }> {
  const name = buildVoteScheduledEventName(params);
  const startsAtMs = params.startsAt.getTime();
  const existing = (await guild.scheduledEvents.fetch()).find(
    (scheduled) =>
      scheduled.name === name ||
      (scheduled.scheduledStartTimestamp === startsAtMs && / Vote \(/.test(scheduled.name)),
  );
  if (existing) {
    return { event: existing, created: false };
  }

  const event = await guild.scheduledEvents.create({
    description: `Cast your GOTM and NR-GOTM votes for ${params.monthYear}.`,
    entityMetadata: {
      location: `https://discord.com/channels/${guild.id}/${ANNOUNCEMENT_CHANNEL_ID}`,
    },
    entityType: GuildScheduledEventEntityType.External,
    name,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    scheduledEndTime: new Date(startsAtMs + VOTE_EVENT_DURATION_MS),
    scheduledStartTime: params.startsAt,
  });
  return { event, created: true };
}
