import axios from "axios";
import { DateTime } from "luxon";
import {
  type CommandInteraction,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  ModalSubmitInteraction,
  type ForumChannel,
} from "discord.js";
import {
  ActionRowBuilder as ModalActionRowBuilder,
  ModalBuilder,
  TextInputBuilder as ModalTextInputBuilder,
} from "@discordjs/builders";
import { TextInputStyle as ApiTextInputStyle } from "discord-api-types/v10";
import { LIVE_EVENT_FORUM_ID } from "../../config/channels.js";
import { safeReply, sanitizeOptionalInput, sanitizeUserInput } from
  "../../functions/InteractionUtils.js";

const LIVE_STREAM_MODAL_PREFIX = "admin-live-stream-create";
const LIVE_STREAM_TOPIC_ID = "live-stream-topic";
const LIVE_STREAM_START_ID = "live-stream-start";
const LIVE_STREAM_END_TIME_ID = "live-stream-end-time";
const LIVE_STREAM_TIMEZONE_ID = "live-stream-timezone";
const LIVE_STREAM_IMAGE_URL_ID = "live-stream-image-url";
const DEFAULT_TIMEZONE = "America/New_York";

type LiveStreamModalInput = {
  topic: string;
  start: string;
  endTime: string;
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
          .setCustomId(LIVE_STREAM_END_TIME_ID)
          .setLabel("End Time (HH:mm)")
          .setStyle(ApiTextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
          .setPlaceholder("23:00"),
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

  const endTimeText = sanitizeUserInput(input.endTime, {
    blockSql: false,
    maxLength: 5,
    preserveNewlines: false,
  });
  if (!/^\d{2}:\d{2}$/.test(endTimeText)) {
    return { error: "End Time must use `HH:mm` (24-hour) format.", ok: false };
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

  const endTime = DateTime.fromFormat(endTimeText, "HH:mm", {
    zone: timeZone,
    setZone: true,
  });
  if (!endTime.isValid) {
    return {
      error: "End Time must be a valid `HH:mm` value.",
      ok: false,
    };
  }

  let end = start.set({ hour: endTime.hour, minute: endTime.minute, second: 0, millisecond: 0 });
  if (end <= start) {
    end = end.plus({ days: 1 });
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
  await interaction.showModal(buildLiveStreamModal(buildLiveStreamModalCustomId(interaction.user.id)));
}

export async function handleLiveStreamCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
  const customIdParts = interaction.customId.split(":");
  if (customIdParts.length !== 2 || customIdParts[0] !== LIVE_STREAM_MODAL_PREFIX) {
    await safeReply(interaction, {
      content: "This modal is invalid.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (customIdParts[1] !== interaction.user.id) {
    await safeReply(interaction, {
      content: "This modal is not for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsedInput = parseLiveStreamModalInput({
    endTime: interaction.fields.getTextInputValue(LIVE_STREAM_END_TIME_ID),
    imageUrl: interaction.fields.getTextInputValue(LIVE_STREAM_IMAGE_URL_ID),
    start: interaction.fields.getTextInputValue(LIVE_STREAM_START_ID),
    timeZone: interaction.fields.getTextInputValue(LIVE_STREAM_TIMEZONE_ID),
    topic: interaction.fields.getTextInputValue(LIVE_STREAM_TOPIC_ID),
  });

  if (!parsedInput.ok) {
    await safeReply(interaction, {
      content: parsedInput.error,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { topic, startsAt, endsAt, timeZone, imageUrl } = parsedInput.value;
  const forum = (await interaction.guild?.channels.fetch(LIVE_EVENT_FORUM_ID)) as ForumChannel | null;
  if (!forum) {
    await safeReply(interaction, {
      content: "Live Events forum channel was not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let imageBuffer: Buffer | null = null;
  if (imageUrl) {
    try {
      imageBuffer = await fetchImageBuffer(imageUrl);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, {
        content: `Image fetch failed: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  let threadUrl: string | null = null;
  let threadId: string | null = null;
  try {
    const thread = await forum.threads.create({
      message: {
        content: `Live event discussion for **${topic}**`,
        embeds: imageUrl ? [new EmbedBuilder().setImage(imageUrl)] : [],
      },
      name: topic.slice(0, 100),
    });
    threadUrl = thread.url;
    threadId = thread.id;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await safeReply(interaction, {
      content: `Thread creation failed: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
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
    await safeReply(interaction, {
      content:
        `Created live event resources.\n` +
        `Thread: <#${threadId}>\n` +
        `Event: ${eventUrl}\n` +
        `Scheduled: ${timeZone}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    await safeReply(interaction, {
      content:
        `Scheduled event creation failed: ${msg}\n` +
        `Thread was created successfully: <#${threadId}>`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
