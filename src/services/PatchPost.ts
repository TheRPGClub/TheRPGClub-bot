import {
  ActionRowBuilder,
  ButtonBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { ButtonStyle, SeparatorSpacingSize } from "discord-api-types/v10";
import { escapeMarkdown, messageLink, type Client } from "discord.js";
import { DateTime } from "luxon";
import { DISCORD_V2_TEXT_MAX } from "../config/textLimits.js";
import { patchPageUrl } from "../config/website.js";
import { CLUB_TIME_ZONE } from "../functions/ClubDate.js";
import {
  buildComponentsV2View,
  safeV2TextContent,
  type IComponentsV2View,
} from "../functions/ComponentsV2Utils.js";
import { HOME_GUILD_ID } from "../config/guilds.js";
import { BotJobStepError, stepFailed } from "./BotJobErrors.js";
import { isGone } from "./NewsCopySync.js";
import { apiDelete, apiPutOrThrow } from "./RpgClubApiClient.js";

// The Patch post (spec api#510, bot#1592): a published Patch in #patch-notes, as the
// patch_post, patch_edit and patch_delete jobs send, edit and remove it. The message is the
// Patch's cut markdown (cut by the website at the same place as its card), a divider, and
// one link button to the Patch page. It pings nobody. /patch-notes shows the same message.

/** The button under every Patch post (the owner's words, Discord and website alike). */
export const PATCH_POST_BUTTON_LABEL = "Read the full Patch ↗";

/** What the post shows of a Patch. */
export interface IPatchPostText {
  number: number;
  title: string | null;
  /** The cut Discord markdown the API stores (`cut_body`), at most 4000 characters. */
  cutBody: string;
  /** ISO time it was published, or null when unknown. */
  publishedAt: string | null;
}

/** Where a posted Patch's message is. */
export interface IPatchMessage {
  channelId: string;
  messageId: string;
}

/** A Patch's publish day as the website shows it: "26 November 2026", in club time. */
export function formatPatchDate(publishedAt: string): string | null {
  const at = DateTime.fromISO(publishedAt, { zone: "utc" });
  return at.isValid ? at.setZone(CLUB_TIME_ZONE).toFormat("d LLLL yyyy") : null;
}

/** "## Patch 4 · The Franchise update" over "-# 26 November 2026", as on the card's rule. */
export function patchPostHeading(patch: IPatchPostText): string {
  const title = patch.title?.trim();
  const name = title
    ? `Patch ${patch.number} · ${escapeMarkdown(title)}`
    : `Patch ${patch.number}`;
  const date = patch.publishedAt ? formatPatchDate(patch.publishedAt) : null;
  return date ? `## ${name}\n-# ${date}` : `## ${name}`;
}

/**
 * The Patch post: its heading, the cut markdown, a divider and the link button, then
 * `footnote` if given (/patch-notes adds the versions line there). Discord counts every
 * text display of a message against one 4000 limit, and the website cuts the body alone
 * against it, so the heading, then the footnote, is left out when it would not fit beside
 * a long body (the body is never cut a second time).
 */
export function buildPatchPost(
  patch: IPatchPostText,
  options: { footnote?: string | null } = {},
): IComponentsV2View {
  const body = safeV2TextContent(patch.cutBody, DISCORD_V2_TEXT_MAX);
  let room = DISCORD_V2_TEXT_MAX - body.length;
  const heading = patchPostHeading(patch);
  const showHeading = heading.length <= room;
  if (showHeading) room -= heading.length;
  const footnote = options.footnote?.trim();
  const texts = (showHeading ? [heading, body] : [body]).filter(Boolean);
  const textDisplay = (text: string) =>
    new TextDisplayBuilder().setContent(safeV2TextContent(text, DISCORD_V2_TEXT_MAX)).toJSON();
  return buildComponentsV2View([
    ...texts.map(textDisplay),
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small).toJSON(),
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(PATCH_POST_BUTTON_LABEL)
          .setURL(patchPageUrl(patch.number)),
      )
      .toJSON(),
    ...(footnote && footnote.length <= room ? [textDisplay(footnote)] : []),
  ]);
}

/** What the Patch jobs send and record; tests pass a fake. */
export interface IPatchPostDeps {
  /** Posts in a text channel; returns the message id. Throws the discord.js error. */
  sendPost(channelId: string, post: IComponentsV2View): Promise<string>;
  /** Edits the message in place. Throws the discord.js error (Unknown Message when gone). */
  editPost(message: IPatchMessage, post: IComponentsV2View): Promise<void>;
  /** Deletes the message. Throws the discord.js error (Unknown Message when gone). */
  deletePost(message: IPatchMessage): Promise<void>;
  /** PUT /patches/:number/discord_post: the message the Patch is posted as. */
  recordPost(patchNumber: number, message: IPatchMessage): Promise<void>;
  /** DELETE /patches/:number/discord_post?message_id=: that message is gone. */
  clearPost(patchNumber: number, messageId: string): Promise<void>;
  /** The guild a channel is in, for message links; null when unknown. Never throws. */
  guildIdOf(channelId: string): Promise<string | null>;
}

async function fetchTextChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isSendable() || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
  }
  return channel;
}

export function createPatchPostDeps(client: Client): IPatchPostDeps {
  return {
    sendPost: async (channelId, post) =>
      (await (await fetchTextChannel(client, channelId)).send(post)).id,
    editPost: async ({ channelId, messageId }, post) => {
      const channel = await fetchTextChannel(client, channelId);
      await channel.messages.edit(messageId, post);
    },
    deletePost: async ({ channelId, messageId }) => {
      const channel = await fetchTextChannel(client, channelId);
      await channel.messages.delete(messageId);
    },
    recordPost: async (patchNumber, { channelId, messageId }) => {
      await apiPutOrThrow(`/patches/${patchNumber}/discord_post`, {
        data: { channel_id: channelId, message_id: messageId },
      });
    },
    clearPost: async (patchNumber, messageId) => {
      // A 404 (no such Patch) leaves nothing to clear.
      await apiDelete(`/patches/${patchNumber}/discord_post`, {
        params: { message_id: messageId },
      });
    },
    guildIdOf: async (channelId) => {
      try {
        const channel = await client.channels.fetch(channelId);
        return channel && "guildId" in channel ? channel.guildId : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * A link to the message in its channel's own guild (bot-dev may sit in another guild than
 * #patch-notes), or the home guild when the channel's guild can't be read.
 */
async function link(message: IPatchMessage, deps: IPatchPostDeps): Promise<string> {
  const guildId = await deps.guildIdOf(message.channelId).catch(() => null);
  return messageLink(message.channelId, message.messageId, guildId ?? HOME_GUILD_ID);
}

/**
 * Records a message just posted or edited. Never temporary: a retried patch_post would
 * post the Patch a second time.
 */
async function recordPosted(
  patchNumber: number,
  message: IPatchMessage,
  deps: IPatchPostDeps,
): Promise<void> {
  try {
    await deps.recordPost(patchNumber, message);
  } catch (err) {
    throw new BotJobStepError(
      `Recording Patch ${patchNumber}'s post failed (it is posted: ` +
        `${await link(message, deps)}). The ` +
        "job stopped rather than post it again",
      err,
      false,
    );
  }
}

/**
 * Sends the Patch's post in `channelId` and records it. A failed send is never temporary:
 * Discord may have posted the message before the request failed (a timeout), and a retry
 * would post it twice.
 */
async function sendAndRecord(
  patch: IPatchPostText,
  channelId: string,
  deps: IPatchPostDeps,
): Promise<IPatchMessage> {
  let messageId: string;
  try {
    messageId = await deps.sendPost(channelId, buildPatchPost(patch));
  } catch (err) {
    throw new BotJobStepError(`Posting Patch ${patch.number} failed`, err, false);
  }
  const message = { channelId, messageId };
  await recordPosted(patch.number, message, deps);
  return message;
}

/** patch_post: posts the Patch in `channelId` (already routed) and records the message. */
export async function postPatch(
  patch: IPatchPostText,
  channelId: string,
  deps: IPatchPostDeps,
): Promise<string> {
  const message = await sendAndRecord(patch, channelId, deps);
  return `Posted Patch ${patch.number}: ${await link(message, deps)}`;
}

/**
 * patch_edit of a post in the wrong channel (posted in bot-dev while Patch Notes was in
 * Preview, and the Feature now routes to #patch-notes, or the other way): posts the Patch
 * where it now belongs, records the new message, then removes the old one. A failure once
 * the new message exists is never temporary, so a retry can't post it twice.
 */
async function movePatchPost(
  patch: IPatchPostText,
  old: IPatchMessage,
  channelId: string,
  deps: IPatchPostDeps,
): Promise<string> {
  const message = await sendAndRecord(patch, channelId, deps);
  try {
    await deps.deletePost(old);
  } catch (err) {
    if (!isGone(err)) {
      throw new BotJobStepError(
        `Moved Patch ${patch.number}'s post to ${await link(message, deps)}, but removing the ` +
          `old one (${await link(old, deps)}) failed; delete it in Discord`,
        err,
        false,
      );
    }
  }
  return `Moved Patch ${patch.number}'s post to ${await link(message, deps)}.`;
}

/**
 * patch_edit: edits the Patch's message where it was posted, when that is where the Feature
 * now routes (`channelId`); a post in another channel is moved there (movePatchPost). A
 * message deleted in Discord is cleared from the Patch, so staff can post it again, and the
 * job fails saying so.
 */
export async function editPatch(
  patch: IPatchPostText,
  message: IPatchMessage,
  channelId: string,
  deps: IPatchPostDeps,
): Promise<string> {
  if (message.channelId !== channelId) return movePatchPost(patch, message, channelId, deps);
  try {
    await deps.editPost(message, buildPatchPost(patch));
  } catch (err) {
    if (!isGone(err)) throw stepFailed(`Editing Patch ${patch.number}'s post`, err);
    try {
      await deps.clearPost(patch.number, message.messageId);
    } catch (clearErr) {
      throw stepFailed(`Clearing Patch ${patch.number}'s gone post`, clearErr);
    }
    throw new Error(
      `Patch ${patch.number}'s post is gone from Discord (${await link(message, deps)}), so ` +
        "it was cleared. Post it to #patch-notes again.",
      { cause: err },
    );
  }
  try {
    await deps.recordPost(patch.number, message);
  } catch (err) {
    throw stepFailed(`Recording Patch ${patch.number}'s edited post`, err);
  }
  return `Updated Patch ${patch.number}'s post: ${await link(message, deps)}`;
}

/**
 * patch_delete: removes the Patch's message from its stored channel and clears it from the
 * Patch. A message (or channel) already gone counts as removed.
 */
export async function deletePatchPost(
  patchNumber: number,
  message: IPatchMessage,
  deps: IPatchPostDeps,
): Promise<string> {
  let gone = false;
  try {
    await deps.deletePost(message);
  } catch (err) {
    if (!isGone(err)) throw stepFailed(`Removing Patch ${patchNumber}'s post`, err);
    gone = true;
  }
  await deps.clearPost(patchNumber, message.messageId);
  return gone
    ? `Patch ${patchNumber}'s post was already gone from Discord; cleared it.`
    : `Removed Patch ${patchNumber}'s post from Discord.`;
}
