import { AttachmentBuilder, MessageFlags, MessageFlagsBitField } from "discord.js";
import { IS_TEST_MODE } from "../config/testMode.js";
import { TEST_LOG_CHANNEL_ID } from "../config/channels.js";
import { jsonCodeBlock } from "../utilities/CodeBlockUtils.js";
import { logError } from "../utilities/LogUtils.js";
import type { AnyRepliable } from "./InteractionUtils.js";

/** Discord's hard cap on a message's content length. */
const MIRROR_MESSAGE_LIMIT = 2000;

/** File name of the full payload when it does not fit in the message content. */
export const MIRROR_ATTACHMENT_NAME = "mirror.json";

type MirrorComponent = {
  type?: number;
  customId?: string;
  label?: string;
  placeholder?: string;
  content?: string;
  options?: { label?: string; value?: string }[];
  components?: MirrorComponent[];
};

type MirrorKind = "reply" | "update";

type MirrorPayload = {
  kind: MirrorKind;
  source: string;
  user: string | null;
  channelId: string | null;
  content?: string;
  embeds?: unknown[];
  components?: MirrorComponent[];
};

/** Unwraps discord.js builders so both builder and raw payloads serialize alike. */
function toPlain(value: unknown): any {
  if (value === null || value === undefined) return value;
  const candidate = value as { toJSON?: () => unknown };
  if (typeof candidate.toJSON === "function") {
    try {
      return candidate.toJSON();
    } catch {
      return value;
    }
  }
  return value;
}

function hasEphemeralFlag(flags: unknown): boolean {
  if (flags === undefined || flags === null) return false;
  try {
    return new MessageFlagsBitField(flags as never).has(MessageFlags.Ephemeral);
  } catch {
    return false;
  }
}

/** True when the payload's flags carry the ephemeral bit. */
export function isEphemeralPayload(options: unknown): boolean {
  if (!options || typeof options !== "object") return false;
  return hasEphemeralFlag((options as { flags?: unknown }).flags);
}

/**
 * True when the message the interaction acts on is itself ephemeral. Update
 * payloads never carry the flag, so the source message is the only signal.
 */
export function isEphemeralInteractionMessage(interaction: AnyRepliable): boolean {
  const message = (interaction as { message?: { flags?: unknown } }).message;
  if (!message) return false;
  return hasEphemeralFlag(message.flags);
}

/** Interactions whose deferred reply is ephemeral; the defer is the only signal. */
const ephemeralDefers = new WeakSet<object>();

/**
 * Records that the interaction's deferred reply is ephemeral. The payload that
 * later fills it rarely repeats the flag, and a command interaction has no
 * source message, so without this the reply would never be mirrored.
 */
export function markEphemeralDefer(interaction: AnyRepliable, options: unknown): void {
  if (isEphemeralPayload(options)) ephemeralDefers.add(interaction);
}

export function hasEphemeralDefer(interaction: AnyRepliable): boolean {
  return ephemeralDefers.has(interaction);
}

/**
 * Pure gate, taking the mode explicitly so both branches can be exercised
 * without reloading the module graph.
 */
export function shouldMirrorFor(testMode: boolean, options: unknown): boolean {
  return testMode && isEphemeralPayload(options);
}

/** Pure gate for the update path, where ephemerality comes from the message. */
export function shouldMirrorUpdateFor(testMode: boolean, interaction: AnyRepliable): boolean {
  return testMode &&
    (isEphemeralInteractionMessage(interaction) || hasEphemeralDefer(interaction));
}

function serializeComponent(raw: unknown): MirrorComponent {
  const node = toPlain(raw) ?? {};
  const entry: MirrorComponent = {};
  if (typeof node.type === "number") entry.type = node.type;
  if (typeof node.custom_id === "string") entry.customId = node.custom_id;
  if (typeof node.label === "string") entry.label = node.label;
  if (typeof node.placeholder === "string") entry.placeholder = node.placeholder;
  if (typeof node.content === "string") entry.content = node.content;
  if (Array.isArray(node.options)) {
    entry.options = node.options.map((option: unknown) => {
      const plain = toPlain(option) ?? {};
      return { label: plain.label, value: plain.value };
    });
  }
  if (Array.isArray(node.components)) {
    entry.components = node.components.map(serializeComponent);
  }
  if (node.accessory) {
    entry.components = [
      ...(entry.components ?? []),
      serializeComponent(node.accessory),
    ];
  }
  return entry;
}

/** Names the interaction well enough to match a mirrored reply back to a command. */
export function describeInteraction(interaction: AnyRepliable): string {
  const withCommand = interaction as { commandName?: string; customId?: string };
  if (withCommand.commandName) return `/${withCommand.commandName}`;
  if (withCommand.customId) return `component:${withCommand.customId}`;
  return "interaction";
}

/** Flattens an outgoing reply into the fields a reader needs to verify it. */
export function serializeMirrorPayload(
  interaction: AnyRepliable,
  options: unknown,
  kind: MirrorKind = "reply",
): MirrorPayload {
  const payload: MirrorPayload = {
    kind,
    source: describeInteraction(interaction),
    user: interaction.user?.id ?? null,
    channelId: interaction.channelId ?? null,
  };

  if (typeof options === "string") {
    payload.content = options;
    return payload;
  }
  if (!options || typeof options !== "object") return payload;

  const record = options as Record<string, unknown>;
  if (typeof record.content === "string") payload.content = record.content;
  if (Array.isArray(record.embeds)) payload.embeds = record.embeds.map(toPlain);
  if (Array.isArray(record.components)) {
    payload.components = record.components.map(serializeComponent);
  }
  return payload;
}

export type MirrorMessage = { content: string; files?: AttachmentBuilder[] };

/**
 * Renders the mirrored payload as a fenced JSON block. A payload too long for
 * Discord's content cap goes whole into a JSON attachment instead, and the
 * content keeps only who and what it answers plus the attachment's name, so the
 * conductor sees every component rather than whatever survived a cut.
 */
export function buildMirrorMessage(payload: MirrorPayload): MirrorMessage {
  const body = JSON.stringify(payload, null, 2);
  const content = jsonCodeBlock(body);
  if (content.length <= MIRROR_MESSAGE_LIMIT) return { content };
  const { kind, source, user, channelId } = payload;
  const summary = { kind, source, user, channelId, attachment: MIRROR_ATTACHMENT_NAME };
  return {
    content: jsonCodeBlock(JSON.stringify(summary, null, 2)),
    files: [new AttachmentBuilder(Buffer.from(body, "utf8"), { name: MIRROR_ATTACHMENT_NAME })],
  };
}

/**
 * Posts one serialized payload to the test-log channel. Swallows its own
 * failures so a mirror problem never affects the user's interaction.
 */
async function sendMirror(
  interaction: AnyRepliable,
  options: unknown,
  kind: MirrorKind,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(TEST_LOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;
    const sendable = channel as { send?: (message: MirrorMessage) => Promise<unknown> };
    if (typeof sendable.send !== "function") return;
    const payload = serializeMirrorPayload(interaction, options, kind);
    await sendable.send(buildMirrorMessage(payload));
  } catch (err: unknown) {
    logError("EphemeralMirror.sendMirror", {
      kind,
      message: (err as { message?: string })?.message,
    });
  }
}

/**
 * Best-effort copy of an ephemeral reply to the test-log channel. Runs only in
 * test mode, gated on the outgoing payload's ephemeral flag.
 */
export async function mirrorEphemeralReply(
  interaction: AnyRepliable,
  options: unknown,
): Promise<void> {
  if (!shouldMirrorFor(IS_TEST_MODE, options)) return;
  await sendMirror(interaction, options, "reply");
}

/**
 * Best-effort copy of a reply that fills an ephemeral deferred reply. The gate
 * is the defer, since the filling payload usually carries no ephemeral flag.
 */
export async function mirrorEphemeralDeferredReply(
  interaction: AnyRepliable,
  options: unknown,
): Promise<void> {
  if (!IS_TEST_MODE || !hasEphemeralDefer(interaction)) return;
  await sendMirror(interaction, options, "reply");
}

/**
 * Best-effort copy of a component update to the test-log channel. Update
 * payloads inherit ephemerality from the message they edit, so the gate reads
 * the source message rather than the payload flags.
 */
export async function mirrorEphemeralUpdate(
  interaction: AnyRepliable,
  options: unknown,
): Promise<void> {
  if (!shouldMirrorUpdateFor(IS_TEST_MODE, interaction)) return;
  await sendMirror(interaction, options, "update");
}
