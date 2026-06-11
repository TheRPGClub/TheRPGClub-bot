import axios from "axios";
import { DateTime } from "luxon";
import {
  type CommandInteraction,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  ModalSubmitInteraction,
  type ForumChannel,
  channelMention,
} from "discord.js";
import {
  ActionRowBuilder as ModalActionRowBuilder,
  ModalBuilder,
  TextInputBuilder as ModalTextInputBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import { LIVE_EVENT_FORUM_ID } from "../../config/channels.js";
import {
  safeDeferReply,
  safeReply,
  sanitizeOptionalInput,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import { buildTextReply, buildComponentsV2Flags } from "../../functions/ComponentsV2Utils.js";
import { truncateLabel } from "../../config/textLimits.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";

const LIVE_STREAM_MODAL_PREFIX = "admin-live-stream-create";
const LIVE_STREAM_TOPIC_ID = "live-stream-topic";
const LIVE_STREAM_START_ID = "live-stream-start";
const LIVE_STREAM_END_ID = "live-stream-end";
const LIVE_STREAM_TIMEZONE_ID = "live-stream-timezone";
const LIVE_STREAM_IMAGE_URL_ID = "live-stream-image-url";
const DEFAULT_TIMEZONE = "America/New_York";

type LiveStreamModalInput = {
  topic: string;
  start: string;
  end: string;
  timeZone: string;
  imageUrl?: string;
};

type LiveStreamParsedInput = {
  topic: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  imageUrl?: string;
};

export function buildLiveStreamModalCustomId(userId: string): string {
  return `${LIVE_STREAM_MODAL_PREFIX}:${userId}`;
}

export function buildLiveStreamModal(customId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Create Live Event and Thread")
    .addActionRowComponents(
      new ModalActionRowBuilder<ModalTextInputBuilder>().addComponents(
        new ModalTextInputBuilder()
          .setCustomId(LIVE_STREAM_TOPIC_ID)
          .setLabel("Event Topic")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("Nintendo Direct"),
      ),
      new ModalActionRowBuilder<ModalTextInputBuilder>().addComponents(
        new ModalTextInputBuilder()
          .setCustomId(LIVE_STREAM_START_ID)
          .setLabel("Start (YYYY-MM-DD HH:mm)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(16)
          .setPlaceholder("2026-05-01 21:00"),
      ),
      new ModalActionRowBuilder<ModalTextInputBuilder>().addComponents(
        new ModalTextInputBuilder()
          .setCustomId(LIVE_STREAM_END_ID)
          .setLabel("End (YYYY-MM-DD HH:mm)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(16)
          .setPlaceholder("2026-05-01 23:00"),
      ),
      new ModalActionRowBuilder<ModalTextInputBuilder>().addComponents(
        new ModalTextInputBuilder()
          .setCustomId(LIVE_STREAM_TIMEZONE_ID)
          .setLabel("Time Zone (IANA)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64)
          .setValue(DEFAULT_TIMEZONE)
          .setPlaceholder("America/New_York"),
      ),
      new ModalActionRowBuilder<ModalTextInputBuilder>().addComponents(
        new ModalTextInputBuilder()
          .setCustomId(LIVE_STREAM_IMAGE_URL_ID)
          .setLabel("Optional Thread Image URL")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder("https://example.com/image.png"),
      ),
    );
}

export function parseLiveStreamModalInput(
  input: LiveStreamModalInput,
): { ok: true; value: LiveStreamParsedInput } | { ok: false; error: string } {
  const topic = sanitizeUserInput(input.topic, { maxLength: 100, preserveNewlines: false });
  if (!topic) {
    return { error: "Event Topic is required.", ok: false };
  }

  const startText = sanitizeUserInput(input.start, {
    blockSql: false,
    maxLength: 16,
    preserveNewlines: false,
  });
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startText)) {
    return { error: "Start must use `YYYY-MM-DD HH:mm` (24-hour) format.", ok: false };
  }

  const endText = sanitizeUserInput(input.end, {
    blockSql: false,
    maxLength: 16,
    preserveNewlines: false,
  });
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(endText)) {
    return { error: "End must use `YYYY-MM-DD HH:mm` (24-hour) format.", ok: false };
  }

  const timeZone = sanitizeUserInput(input.timeZone, {
    allowUnderscore: true,
    blockSql: false,
    maxLength: 64,
    preserveNewlines: false,
  });
  if (!timeZone || !DateTime.local().setZone(timeZone).isValid) {
    return {
      error: "Time Zone must be a valid IANA zone such as `America/New_York`.",
      ok: false,
    };
  }

  const start = DateTime.fromFormat(startText, "yyyy-MM-dd HH:mm", {
    zone: timeZone,
    setZone: true,
  });
  if (!start.isValid) {
    return {
      error: "Start does not form a valid timestamp in the selected Time Zone.",
      ok: false,
    };
  }

  const end = DateTime.fromFormat(endText, "yyyy-MM-dd HH:mm", {
    zone: timeZone,
    setZone: true,
  });
  if (!end.isValid) {
    return {
      error: "End does not form a valid timestamp in the selected Time Zone.",
      ok: false,
    };
  }

  if (end <= start) {
    return {
      error: "End must be after Start.",
      ok: false,
    };
  }

  const imageUrl = sanitizeOptionalInput(input.imageUrl, {
    blockSql: false,
    maxLength: 1000,
    preserveNewlines: false,
  });

  if (imageUrl) {
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return { error: "Optional Thread Image URL must be a valid URL.", ok: false };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { error: "Optional Thread Image URL must use http or https.", ok: false };
    }
  }

  const startsAt = start.toUTC().toJSDate();
  const endsAt = end.toUTC().toJSDate();
  return {
    ok: true,
    value: {
      endsAt,
      imageUrl,
      startsAt,
      timeZone,
      topic,
    },
  };
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15_000,
  });
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("Image URL must return an image content type.");
  }
  return Buffer.from(response.data);
}

export async function openLiveStreamCreateModal(interaction: CommandInteraction): Promise<void> {
  await interaction.showModal(
    buildLiveStreamModal(
      buildLiveStreamModalCustomId(interaction.user.id),
    ),
  );
}

export async function handleLiveStreamCreateModal(interaction: ModalSubmitInteraction):
  Promise<void> {
  const segs = assertCustomIdSegments(interaction, 1);
  if (!segs) return;
  const [userId] = segs;

  if (userId !== interaction.user.id) {
    await safeReply(interaction, buildTextReply("This modal is not for you.", true));
    return;
  }

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

  const parsedInput = parseLiveStreamModalInput({
    end: interaction.fields.getTextInputValue(LIVE_STREAM_END_ID),
    imageUrl: interaction.fields.getTextInputValue(LIVE_STREAM_IMAGE_URL_ID),
    start: interaction.fields.getTextInputValue(LIVE_STREAM_START_ID),
    timeZone: interaction.fields.getTextInputValue(LIVE_STREAM_TIMEZONE_ID),
    topic: interaction.fields.getTextInputValue(LIVE_STREAM_TOPIC_ID),
  });

  if (!parsedInput.ok) {
    await safeReply(interaction, buildTextReply(parsedInput.error, true));
    return;
  }

  const { topic, startsAt, endsAt, timeZone, imageUrl } = parsedInput.value;
  const forum =
    (await interaction.guild?.channels.fetch(LIVE_EVENT_FORUM_ID)) as ForumChannel | null;
  if (!forum) {
    await safeReply(interaction, buildTextReply("Live Events forum channel was not found.", true));
    return;
  }

  let imageBuffer: Buffer | null = null;
  if (imageUrl) {
    try {
      imageBuffer = await fetchImageBuffer(imageUrl);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, buildTextReply(`Image fetch failed: ${msg}`, true));
      return;
    }
  }

  let threadUrl: string | null = null;
  let threadId: string | null = null;
  try {
    const threadMessage: Record<string, unknown> = {
      content: `Live event discussion for **${topic}**`,
    };
    if (imageUrl) {
      const gallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl),
      );
      threadMessage.components = [gallery];
      threadMessage.flags = buildComponentsV2Flags(false);
    }
    const thread = await forum.threads.create({
      message: threadMessage as any,
      name: truncateLabel(topic),
    });
    threadUrl = thread.url;
    threadId = thread.id;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await safeReply(interaction, buildTextReply(`Thread creation failed: ${msg}`, true));
    return;
  }

  try {
    const event = await interaction.guild?.scheduledEvents.create({
      entityMetadata: { location: threadUrl },
      entityType: GuildScheduledEventEntityType.External,
      image: imageBuffer ?? undefined,
      name: topic,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      scheduledEndTime: endsAt,
      scheduledStartTime: startsAt,
    });

    if (!event) {
      throw new Error("Discord did not return a created scheduled event.");
    }

    const eventUrl = `https://discord.com/events/${interaction.guildId}/${event.id}`;
    await safeReply(interaction, buildTextReply(
      `Created live event resources.\n` +
      `Thread: ${channelMention(threadId)}\n` +
      `Event: ${eventUrl}\n` +
      `Scheduled: ${timeZone}`,
      true,
    ));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await safeReply(interaction, buildTextReply(
      `Scheduled event creation failed: ${msg}\n` +
      `Thread was created successfully: ${channelMention(threadId)}`,
      true,
    ));
  }
}
