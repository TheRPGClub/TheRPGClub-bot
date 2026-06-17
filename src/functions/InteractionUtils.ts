import { MessageFlags, MessageFlagsBitField } from "discord.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import type {
  Client,
  CommandInteraction,
  Guild,
  GuildMember,
  GuildMemberRoleManager,
  InteractionDeferReplyOptions,
  ModalSubmitInteraction,
  PermissionResolvable,
  RepliableInteraction,
  User,
} from "discord.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { DEV_ROLE_ID } from "../config/roles.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
  hasComponentsV2Flag,
  safeV2TextContent,
} from "./ComponentsV2Utils.js";

export type AnyRepliable = RepliableInteraction | CommandInteraction;

/** Augments AnyRepliable with RPG-bot-internal ack flags set at runtime. */
type AugmentedInteraction = AnyRepliable & {
  __rpgAcked?: boolean;
  __rpgDeferred?: boolean;
};

export function memberHasPermission(
  interaction: AnyRepliable,
  flag: PermissionResolvable,
): boolean {
  const member = interaction.member;
  // permissionsIn exists on cached GuildMember but not on the raw API member shape.
  const canCheck =
    member && typeof (member as GuildMember).permissionsIn === "function" && interaction.channelId;
  return canCheck
    ? (member as GuildMember).permissionsIn(interaction.channelId!).has(flag)
    : false;
}

export function buildIdTimestampFooter(id: string, timestamp: string): string {
  return `ID: ${id} • ${timestamp}`;
}

/** True if the interaction has already been deferred or replied to. */
export function isInteractionSettled(interaction: AnyRepliable): boolean {
  return interaction.deferred || interaction.replied;
}

/** True if the interaction can still receive an initial reply or deferral. */
export function canSafeReply(interaction: AnyRepliable): boolean {
  return !interaction.deferred && !interaction.replied;
}

type SanitizeOptions = {
  maxLength?: number;
  preserveNewlines?: boolean;
  allowPattern?: RegExp;
  allowUnderscore?: boolean;
  blockSql?: boolean;
  blockSqlKeywords?: boolean;
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000D\\u000E-\\u001F\\u007F-\\u009F]", "g");

export function sanitizeUserInput(value: string, options?: SanitizeOptions): string {
  const opts = {
    maxLength: options?.maxLength,
    preserveNewlines: options?.preserveNewlines ?? true,
    allowPattern: options?.allowPattern,
    allowUnderscore: options?.allowUnderscore ?? false,
    blockSql: options?.blockSql ?? true,
    blockSqlKeywords: options?.blockSqlKeywords ?? false,
  };

  let sanitized = value ?? "";
  const boldPlaceholder = "BOLDMARKER";
  const spoilerPlaceholder = "SPOILERMARKER";
  const starPlaceholder = "STARMARKER";
  try {
    sanitized = sanitized.normalize("NFKC");
  } catch {
    // ignore normalization errors
  }

  sanitized = sanitized.replace(/\r\n/g, "\n");
  sanitized = sanitized.replace(/\*\*/g, boldPlaceholder);
  sanitized = sanitized.replace(/\|\|/g, spoilerPlaceholder);
  sanitized = sanitized.replace(/\*/g, starPlaceholder);
  sanitized = sanitized.replace(CONTROL_CHAR_REGEX, "");
  sanitized = sanitized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
  sanitized = sanitized.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  sanitized = sanitized.replace(/<[^>]+>/g, "");
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "");
  sanitized = sanitized.replace(/`[^`]*`/g, "");
  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s{0,3}#+\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*>\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*[-*+]\s+/g, "$1");
  sanitized = sanitized.replace(opts.allowUnderscore ? /[*~]/g : /[*_~]/g, "");
  sanitized = sanitized.replace(/<@!?(\d+)>/g, "");
  sanitized = sanitized.replace(/<@&(\d+)>/g, "");
  sanitized = sanitized.replace(/<#(\d+)>/g, "");
  sanitized = sanitized.replace(/@(everyone|here)/gi, "");

  if (opts.blockSql) {
    sanitized = sanitized.replace(/--/g, "");
    sanitized = sanitized.replace(/\/\*/g, "");
    sanitized = sanitized.replace(/\*\//g, "");
    sanitized = sanitized.replace(/;/g, "");
  }
  if (opts.blockSqlKeywords) {
    sanitized = sanitized.replace(
      /\b(select|insert|update|delete|drop|alter|create|truncate|exec|union|merge)\b/gi,
      "",
    );
  }

  if (opts.allowPattern) {
    const pattern = new RegExp(opts.allowPattern.source, opts.allowPattern.flags.replace("g", ""));
    sanitized = sanitized.split("").filter((ch) => pattern.test(ch)).join("");
  }

  if (opts.preserveNewlines) {
    sanitized = sanitized
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .join("\n");
    sanitized = sanitized.replace(/\n{3,}/g, "\n\n");
  } else {
    sanitized = sanitized.replace(/\s+/g, " ");
  }

  sanitized = sanitized.replace(new RegExp(boldPlaceholder, "g"), "**");
  sanitized = sanitized.replace(new RegExp(spoilerPlaceholder, "g"), "||");
  sanitized = sanitized.replace(new RegExp(starPlaceholder, "g"), "*");

  sanitized = sanitized.trim();
  if (opts.maxLength && sanitized.length > opts.maxLength) {
    sanitized = sanitized.slice(0, opts.maxLength);
  }

  return sanitized.trim();
}

export function sanitizeOptionalInput(
  value: string | null | undefined,
  options?: SanitizeOptions,
): string | undefined {
  if (value == null) return undefined;
  const sanitized = sanitizeUserInput(value, options);
  return sanitized.length ? sanitized : undefined;
}

export function stripModalInput(value: string): string {
  return sanitizeUserInput(value);
}

export function getModalField(
  interaction: ModalSubmitInteraction,
  customId: string,
): string {
  return stripModalInput(interaction.fields.getTextInputValue(customId));
}

function normalizeOptions(options: any): any {
  if (typeof options === "string" || options === null || options === undefined) {
    return options;
  }

  const {
    __forceFollowUp: _forceFollowUp,
    ...restOptions
  } = options;
  void _forceFollowUp;

  if ("ephemeral" in options) {
    const { ephemeral, flags, ...rest } = restOptions;
    const newFlags = ephemeral ? ((flags ?? 0) | MessageFlags.Ephemeral) : flags;
    return normalizeComponentsV2Payload({ ...rest, flags: newFlags });
  }

  return normalizeComponentsV2Payload(restOptions);
}

function normalizeComponentsV2Payload(options: any): any {
  if (!options || typeof options !== "object") {
    return options;
  }

  if (!hasComponentsV2Flag((options as { flags?: unknown }).flags)) {
    return options;
  }

  if (!("content" in options)) {
    return options;
  }

  const content = typeof options.content === "string"
    ? options.content
    : String(options.content ?? "");
  const { components, ...rest } = options;
  delete (rest as { content?: unknown }).content;

  if (!content.length) {
    return { ...rest, components };
  }

  const textContainer = buildTextContainer(safeV2TextContent(content, 3500));
  const mergedComponents = Array.isArray(components)
    ? [textContainer, ...components]
    : [textContainer];

  return {
    ...rest,
    components: mergedComponents,
  };
}

function stripEphemeralFlag(flags: any): number {
  try {
    return new MessageFlagsBitField(flags).remove(MessageFlags.Ephemeral).bitfield;
  } catch {
    return 0;
  }
}

function shouldForcePublicInDevChannel(interaction: AnyRepliable): boolean {
  const channelId = interaction.channelId;
  if (!channelId || channelId !== BOT_DEV_CHANNEL_ID) return false;
  const ownerId = interaction.guild?.ownerId;
  return Boolean(ownerId && interaction.user.id === ownerId);
}

type MessageWithInteraction = {
  interaction?: { user?: { id?: string } } | null;
};

function getCommandOwnerId(interaction: AnyRepliable): string | null {
  // message exists on MessageComponentInteraction; use structural check to avoid import.
  const msg = (interaction as unknown as { message?: MessageWithInteraction | null }).message;
  return msg?.interaction?.user?.id ?? null;
}

function memberHasDevRole(interaction: AnyRepliable): boolean {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  // Cached GuildMember exposes a role manager; raw API members expose a string[].
  if (typeof (roles as GuildMemberRoleManager).cache?.has === "function") {
    return (roles as GuildMemberRoleManager).cache.has(DEV_ROLE_ID);
  }
  if (Array.isArray(roles)) return (roles as string[]).includes(DEV_ROLE_ID);
  return false;
}

function shouldBlockDevChannelInteraction(interaction: AnyRepliable): boolean {
  const channelId = interaction.channelId;
  if (!channelId || channelId !== BOT_DEV_CHANNEL_ID) return false;
  const isComponent = interaction.isMessageComponent();
  const isModal = interaction.isModalSubmit();
  if (!isComponent && !isModal) return false;

  const commandOwnerId = getCommandOwnerId(interaction);
  const userId = interaction.user?.id ?? null;
  if (!userId) return true;
  if (userId === commandOwnerId) return false;
  return !memberHasDevRole(interaction);
}

async function sendDevChannelBlockResponse(interaction: AnyRepliable): Promise<void> {
  const aug = interaction as AugmentedInteraction;
  const payload = buildTextReply(
    "Only the command owner or members with the dev role can use controls in this channel.",
    true,
  );

  try {
    if (aug.deferred || aug.replied) {
      await aug.followUp(payload);
    } else {
      await aug.reply(payload);
    }
    aug.__rpgAcked = true;
  } catch (err: unknown) {
    if (!isAckError(err)) throw err;
  }
}

function applyDevChannelOverrides(interaction: AnyRepliable, options: any): any {
  if (!options || typeof options === "string") return options;
  if (!shouldForcePublicInDevChannel(interaction)) return options;
  if (!("flags" in options)) return options;
  const flags = stripEphemeralFlag(options.flags);
  return { ...options, flags };
}

// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(
  interaction: AnyRepliable,
  options?: InteractionDeferReplyOptions,
): Promise<void> {
  const aug = interaction as AugmentedInteraction;

  if (shouldBlockDevChannelInteraction(interaction)) {
    await sendDevChannelBlockResponse(interaction);
    return;
  }

  let deferOptions: InteractionDeferReplyOptions | undefined = options;
  try {
    if (
      !deferOptions &&
      interaction.isChatInputCommand() &&
      ["admin", "mod", "superadmin"].includes(interaction.commandName)
    ) {
      deferOptions = { flags: MessageFlags.Ephemeral };
    }
  } catch {
    // ignore detection issues
  }

  if (deferOptions && shouldForcePublicInDevChannel(interaction)) {
    const flags = stripEphemeralFlag(deferOptions.flags);
    deferOptions = { ...deferOptions, flags };
  }

  // Custom flag so our helpers can reliably detect an acknowledgement
  if (aug.__rpgAcked || aug.deferred || aug.replied) {
    return;
  }

  try {
    const normalized = deferOptions ? normalizeOptions(deferOptions) : deferOptions;
    const overridden = applyDevChannelOverrides(interaction, normalized);
    await interaction.deferReply(overridden as InteractionDeferReplyOptions);
    aug.__rpgAcked = true;
    aug.__rpgDeferred = true;
  } catch {
    // ignore errors from deferReply (e.g., already acknowledged)
  }
}

// Safely defer a component update, ignoring acknowledgement races.
export async function safeDeferUpdate(interaction: AnyRepliable): Promise<void> {
  const aug = interaction as AugmentedInteraction;
  if (shouldBlockDevChannelInteraction(interaction)) {
    await sendDevChannelBlockResponse(interaction);
    return;
  }

  if (aug.__rpgAcked || aug.deferred || aug.replied) {
    return;
  }

  if (!interaction.isMessageComponent()) {
    return;
  }

  try {
    await interaction.deferUpdate();
    aug.__rpgAcked = true;
    aug.__rpgDeferred = true;
  } catch {
    // ignore acknowledgement races
  }
}

/** Defers the update. Returns false if deferral failed (caller should return). */
export async function safeDeferUpdateOrBail(interaction: AnyRepliable): Promise<boolean> {
  try {
    await safeDeferUpdate(interaction);
    return true;
  } catch {
    return false;
  }
}

// Ensure we do not hit "Interaction already acknowledged" when replying
const isAckError = (err: unknown): boolean => {
  const code = (err as { code?: number; rawError?: { code?: number } })?.code
    ?? (err as { rawError?: { code?: number } })?.rawError?.code;
  return code === 40060 || code === 10062;
};

export async function safeReply(interaction: AnyRepliable, options: any): Promise<any> {
  const aug = interaction as AugmentedInteraction;
  if (shouldBlockDevChannelInteraction(interaction)) {
    await sendDevChannelBlockResponse(interaction);
    return;
  }
  const forceFollowUp = Boolean(options?.__forceFollowUp);
  const normalizedOptions = applyDevChannelOverrides(interaction, normalizeOptions(options));

  const deferred: boolean = Boolean(
    aug.__rpgDeferred !== undefined ? aug.__rpgDeferred : aug.deferred,
  );
  const replied: boolean = Boolean(aug.replied);
  const acked: boolean = Boolean(aug.__rpgAcked ?? deferred ?? replied);

  if (forceFollowUp) {
    try {
      if (typeof options === "string") {
        // eslint-disable-next-line local/no-plain-text-v1-reply
        return await interaction.followUp({ content: options });
      } else {
        return await interaction.followUp(normalizedOptions);
      }
    } catch (err: unknown) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // If we've deferred but not yet replied, edit the original reply
  if (deferred && !replied) {
    try {
      if (typeof options === "string") {
        // eslint-disable-next-line local/no-plain-text-v1-reply
        return await interaction.editReply({ content: options });
      } else {
        const result = await interaction.editReply(normalizedOptions);
        logInfo("InteractionUtils.safeReply", { step: "editReply success", messageId: result?.id });
        return result;
      }
    } catch (err: unknown) {
      if (!isAckError(err)) throw err;
      const ackCode = (err as { code?: number; rawError?: { code?: number } })?.code
        ?? (err as { rawError?: { code?: number } })?.rawError?.code;
      logError("InteractionUtils.safeReply", {
        code: (err as { code?: number })?.code,
        status: (err as { status?: number })?.status,
        message: (err as { message?: string })?.message,
        rawError: JSON.stringify((err as { rawError?: unknown })?.rawError),
      });
      // 40060 = already replied; a followUp can still deliver the content
      if (ackCode === 40060) {
        try {
          if (typeof options === "string") {
            // eslint-disable-next-line local/no-plain-text-v1-reply
            return await interaction.followUp({ content: options });
          } else {
            return await interaction.followUp(normalizedOptions);
          }
        } catch {
          // followUp also failed; nothing more to do
        }
      }
    }
    return;
  }

  // If we've already replied, or we know the interaction was acknowledged,
  // send a follow-up message instead of trying to reply again.
  if (replied || acked || forceFollowUp) {
    try {
      if (typeof options === "string") {
        // eslint-disable-next-line local/no-plain-text-v1-reply
        return await interaction.followUp({ content: options });
      } else {
        return await interaction.followUp(normalizedOptions);
      }
    } catch (err: unknown) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // First-time acknowledgement: normal reply
  try {
    const replyOptions = typeof options === "string"
      ? { content: options }
      : { ...normalizedOptions };

    const result = await interaction.reply(replyOptions);
    aug.__rpgAcked = true;
    return result;
  } catch (err: unknown) {
    if (!isAckError(err)) throw err;
  }
}

// Try to update an existing interaction message; fall back to a normal reply if needed.
export async function safeUpdate(interaction: AnyRepliable, options: any): Promise<void> {
  const aug = interaction as AugmentedInteraction;
  if (shouldBlockDevChannelInteraction(interaction)) {
    await sendDevChannelBlockResponse(interaction);
    return;
  }
  const normalizedOptions = applyDevChannelOverrides(interaction, normalizeOptions(options));

  if (interaction.isMessageComponent()) {
    try {
      await interaction.update(normalizedOptions);
      aug.__rpgAcked = true;
      aug.__rpgDeferred = true;
      return;
    } catch (err: unknown) {
      if (isAckError(err)) {
        const alreadyAcked = Boolean(
          aug.__rpgAcked ?? aug.__rpgDeferred ?? aug.deferred ?? aug.replied,
        );
        if (!alreadyAcked) {
          return;
        }
      }
      // Fall back to safeReply path below.
    }
  }

  if (normalizedOptions && typeof normalizedOptions === "object") {
    const fallbackFlags = (normalizedOptions.flags ?? 0) | MessageFlags.Ephemeral;
    await safeReply(interaction, { ...normalizedOptions, flags: fallbackFlags });
    return;
  }

  await safeReply(interaction, buildTextReply(String(options ?? ""), true));
}

export function ephemeralFlag(isEphemeral: boolean | undefined): number | undefined {
  return isEphemeral ? MessageFlags.Ephemeral : undefined;
}

/** Defers reply with ephemeral controlled by the showInChat option. */
export async function deferWithShowInChat(
  interaction: AnyRepliable,
  showInChat: boolean | null | undefined,
): Promise<void> {
  await safeDeferReply(interaction, { flags: buildComponentsV2Flags(!showInChat) });
}

/** Defers reply; defaults to public. Pass privateFlag=true to send ephemerally. */
export async function deferWithPrivateFlag(
  interaction: AnyRepliable,
  privateFlag?: boolean,
): Promise<void> {
  await safeDeferReply(interaction, { flags: buildComponentsV2Flags(privateFlag ?? false) });
}

export function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function withErrorReply<T>(
  interaction: AnyRepliable,
  fn: () => Promise<T>,
  errorPrefix = "Error",
  ephemeral = true,
): Promise<T | void> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = extractErrorMessage(err);
    try {
      await safeReply(interaction, buildTextReply(`${errorPrefix}: ${msg}`, ephemeral));
    } catch {
      // error reply itself failed (e.g. interaction token expired); nothing more to do
    }
  }
}

export const OWNER_ONLY_MESSAGE = "This list isn't for you.";
export const ACCESS_DENIED_ADMIN = "Access denied. Command requires Administrator role.";
export const ACCESS_DENIED_MOD = "Access denied. Command requires Moderator role or above.";
export const ACCESS_DENIED_MOD_ADMIN =
  "Access denied. Command requires Moderator, Administrator, or server owner.";
export const ACCESS_DENIED_OWNER = "Access denied. Command is restricted to the server owner.";
export const ACCESS_DENIED_SERVER_OWNER = "Access denied. Command requires server owner.";
export const ACCESS_DENIED_REGULARS = "Access denied. Command requires the Regulars role.";
export const SHOW_IN_CHAT_DESCRIPTION = "Show in chat (public) instead of ephemeral";
export const PRIVATE_OPTION_DESCRIPTION = "Send reply privately (only visible to you).";
export const NO_RESULTS_MESSAGE = "No results found.";
export const NOTHING_TO_DISPLAY = "Nothing to display.";
export const GAME_NOT_FOUND_MESSAGE = "Could not find that game.";
export const USER_NOT_FOUND_MESSAGE = "Could not find that user.";

/** Returns true and replies ephemerally if user is not the owner. */
export async function replyIfNotOwner(
  interaction: AnyRepliable,
  ownerId: string,
  message?: string,
): Promise<boolean> {
  if (interaction.user.id !== ownerId) {
    await safeReply(interaction, buildTextReply(message ?? OWNER_ONLY_MESSAGE, true));
    return true;
  }
  return false;
}

export function resolveMemberLabel(
  member: import("discord.js").User | import("discord.js").GuildMember | undefined,
  fallback: import("discord.js").User,
): string {
  if (!member) return fallback.username;
  if ("displayName" in member && member.displayName) {
    return member.displayName;
  }
  if ("user" in member && (member as import("discord.js").GuildMember).user?.username) {
    return (member as import("discord.js").GuildMember).user.username;
  }
  if ("username" in member) {
    return (member as import("discord.js").User).username;
  }
  return fallback.username;
}

export async function safeUserFetch(client: Client, userId: string): Promise<User | null> {
  return client.users.fetch(userId).catch(() => null);
}

export async function safeMemberFetch(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}
