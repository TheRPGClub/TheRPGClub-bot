import axios from "axios";
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type ForumChannel,
  type Guild,
} from "discord.js";
import { MediaGalleryBuilder, MediaGalleryItemBuilder } from "@discordjs/builders";
import { buildComponentsV2Flags } from "../functions/ComponentsV2Utils.js";
import { truncateLabel } from "../config/textLimits.js";

// The live event create flow, shared by /mod create-live-event and the website's
// live_event_create bot job: a forum thread in the Live Events forum, then a Discord
// scheduled event whose location is that thread.

const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/** Downloads an image URL for the scheduled event's cover. Throws when it is not an image. */
export async function fetchLiveEventImage(imageUrl: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
    timeout: IMAGE_FETCH_TIMEOUT_MS,
  });
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Image URL returned content type "${contentType}" (HTTP ${response.status}), ` +
        "not an image.",
    );
  }
  return Buffer.from(response.data);
}

export interface ILiveEventThreadInput {
  topic: string;
  imageUrl: string | null;
}

/** Opens the live event's discussion thread in the forum, with the image when given. */
export async function createLiveEventThread(
  forum: ForumChannel,
  input: ILiveEventThreadInput,
): Promise<{ id: string; url: string }> {
  const threadMessage: Record<string, unknown> = {
    content: `Live event discussion for **${input.topic}**`,
  };
  if (input.imageUrl) {
    const gallery = new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(input.imageUrl),
    );
    threadMessage.components = [gallery];
    threadMessage.flags = buildComponentsV2Flags(false);
  }
  const thread = await forum.threads.create({
    message: threadMessage as any,
    name: truncateLabel(input.topic),
  });
  return { id: thread.id, url: thread.url };
}

export interface ILiveEventScheduleInput {
  topic: string;
  startsAt: Date;
  endsAt: Date;
  /** The thread's URL, shown as the external event's location. */
  location: string;
  image: Buffer | null;
}

/** Creates the external Discord scheduled event. Returns its id. */
export async function createLiveEventScheduledEvent(
  guild: Guild,
  input: ILiveEventScheduleInput,
): Promise<string> {
  const event = await guild.scheduledEvents.create({
    entityMetadata: { location: input.location },
    entityType: GuildScheduledEventEntityType.External,
    image: input.image ?? undefined,
    name: input.topic,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    scheduledEndTime: input.endsAt,
    scheduledStartTime: input.startsAt,
  });
  if (!event) {
    throw new Error("Discord did not return a created scheduled event.");
  }
  return event.id;
}

/** A forum thread's link, as discord.js ThreadChannel#url gives it. */
export function buildLiveEventThreadUrl(guildId: string, threadId: string): string {
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

/** A scheduled event's link. */
export function buildLiveEventUrl(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}
