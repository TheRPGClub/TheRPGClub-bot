import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { DateTime } from "luxon";
import sharp from "sharp";
import { safeV2TextContent } from "../functions/ComponentsV2Utils.js";
import { escapeChallengeText, formatMonthDay } from "../functions/ChallengeCopy.js";
import { buildChallengeSantaId } from "../functions/ChallengeCustomIds.js";
import { MAX_CONTAINER_TEXT } from "../config/textLimits.js";
import { logError } from "../utilities/LogUtils.js";
import type { IChallengeJobDeps, IChallengePost } from "./ChallengeAnnouncements.js";
import type { IChallengeDm } from "./ChallengeSeasons.js";
import type { IChallenge } from "./ChallengeApi.js";
import { commandMention } from "./CommandMentionService.js";
import type {
  IChallengeEdition,
  IChallengeEditionSummary,
  ISignupPost,
} from "./ChallengeEditionApi.js";

// Secret Santa's sign-up posts (spec api#376, bot#1551), design 7C "Gift tags": a warm
// opening post with a drawn gift and a Sign up button, stored on the Edition, and the
// closing, closed and cancelled posts as replies to it.

const LOG_CONTEXT = "ChallengeSignupPosts";

/** The gift's box when the Challenge has no tint, and its ribbon (the mock's colours). */
const GIFT_BOX = "#1f4d36";
const GIFT_RIBBON = "#e8c35a";
/** The thumbnail at twice the mock's 64 by 85. */
const GIFT_WIDTH = 128;
const GIFT_HEIGHT = 170;

const giftCache = new Map<string, Promise<Buffer>>();

/** A wrapped present in the Challenge's tint, drawn once per colour. */
export function giftImage(fill: string): Promise<Buffer> {
  const box = /^#[0-9a-f]{6}$/i.test(fill) ? fill : GIFT_BOX;
  let image = giftCache.get(box);
  if (!image) {
    const ribbon = 16;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${GIFT_WIDTH}" ` +
      `height="${GIFT_HEIGHT}"><rect width="${GIFT_WIDTH}" height="${GIFT_HEIGHT}" rx="16" ` +
      `fill="${box}"/><rect x="${(GIFT_WIDTH - ribbon) / 2}" width="${ribbon}" ` +
      `height="${GIFT_HEIGHT}" fill="${GIFT_RIBBON}"/><rect y="72" width="${GIFT_WIDTH}" ` +
      `height="${ribbon}" fill="${GIFT_RIBBON}"/></svg>`;
    image = sharp(Buffer.from(svg)).png().toBuffer();
    giftCache.set(box, image);
    image.catch(() => giftCache.delete(box));
  }
  return image;
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(safeV2TextContent(content, MAX_CONTAINER_TEXT));
}

/** "Secret Santa 2026": the Challenge's name and the Edition's year, escaped. */
export function editionName(edition: Pick<IChallengeEdition, "challenge" | "year">): string {
  return `${escapeChallengeText(edition.challenge.name)} ${edition.year}`;
}

/** A club date "2026-12-01" as "1 December". */
export function editionDay(isoDate: string): string {
  return formatMonthDay(isoDate.slice(5));
}

/** The Sign up button of an Edition's posts; the clicking member signs up. */
export function buildSignUpButton(editionId: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeSantaId("join", editionId))
    .setLabel("Sign up")
    .setStyle(ButtonStyle.Success);
}

function signUpRow(edition: Pick<IChallengeEdition, "id">): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buildSignUpButton(edition.id));
}

/** An Assignment Challenge's latest Edition while it takes sign-ups, else null. */
export function signupEditionOf(challenge: IChallenge): IChallengeEditionSummary | null {
  const edition = challenge.assignment?.edition;
  return edition && edition.phase === "signup" ? edition : null;
}

/** "**2026 Edition** sign-up closes 1 December · Santas pick by 15 December · reveal ..." */
export function editionRuleLine(edition: IChallengeEditionSummary): string {
  return `**${edition.year} Edition** sign-up closes ${editionDay(edition.signup_cutoff_on)} · ` +
    `Santas pick by ${editionDay(edition.pick_deadline_on)} · ` +
    `reveal ${editionDay(edition.reveal_on)}`;
}

/** The `edition` of a job payload, or a thrown error naming what is wrong. */
export function payloadEdition(payload: Record<string, unknown>): IChallengeEdition {
  const edition = payload.edition as Partial<IChallengeEdition> | undefined;
  if (
    !edition || typeof edition !== "object" ||
    typeof edition.id !== "number" || typeof edition.year !== "number" ||
    !edition.challenge || typeof edition.challenge.name !== "string" ||
    typeof edition.signup_cutoff_on !== "string" ||
    typeof edition.pick_deadline_on !== "string" || typeof edition.reveal_on !== "string"
  ) {
    throw new Error(`Invalid payload: edition must be an Edition, got ${
      JSON.stringify(edition)
    }.`);
  }
  return edition as IChallengeEdition;
}

/** The opening post: the Edition, how it works, its three dates, and Sign up. */
export function buildSignupOpenedPost(edition: IChallengeEdition, gift: Buffer | null):
  IChallengePost {
  const fileName = `secret-santa-${edition.id}.png`;
  const intro = text(
    `## ${editionName(edition)}\n` +
      "Someone in the club picks a game from your backlog. You pick one from someone " +
      `else's. On ${editionDay(edition.reveal_on)} everyone unwraps theirs.`,
  );
  const container = new ContainerBuilder();
  if (gift) {
    const section = new SectionBuilder().addTextDisplayComponents(intro);
    section.setThumbnailAccessory(new ThumbnailBuilder()
      .setURL(`attachment://${fileName}`)
      .setDescription("A wrapped present"));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(intro);
  }
  container.addTextDisplayComponents(text([
    `**${editionDay(edition.signup_cutoff_on)}** sign-up closes`,
    `**${editionDay(edition.pick_deadline_on)}** Santas have picked`,
    `**${editionDay(edition.reveal_on)}** the reveal`,
  ].join("\n")));
  return {
    components: [container.toJSON(), signUpRow(edition).toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(gift ? { files: [{ name: fileName, data: gift }] } : {}),
  };
}

async function giftFor(challenge: IChallenge | null): Promise<Buffer | null> {
  try {
    return await giftImage(challenge?.tint?.fill ?? GIFT_BOX);
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.gift`, err);
    return null;
  }
}

/**
 * Stores the posted message as the Edition's sign-up post. A failure is logged and told in
 * the returned note: the post stands (failing the job would post it again), and the later
 * posts go out without replying to it.
 */
export async function storeSignupPost(
  editionId: number,
  channelId: string,
  messageId: string | void,
  deps: IChallengeJobDeps,
): Promise<string> {
  if (!messageId) return " The post's ID was not known, so it was not stored.";
  try {
    await deps.storeSignupPost(editionId, { channel_id: channelId, message_id: messageId });
    return "";
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.storeSignupPost`, err);
    const reason = err instanceof Error ? err.message : String(err);
    return ` Could not store the post on the Edition (${reason}); later posts won't reply to it.`;
  }
}

/**
 * Payload `{ event: "signup_opened", challenge, edition, feature_key }`: posts the
 * Edition's opening post in `channelId` and stores it on the Edition.
 */
export async function announceSignupOpened(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const edition = payloadEdition(payload);
  const challenge = (payload.challenge as IChallenge | undefined) ?? null;
  const messageId = await deps.postMessage(
    channelId,
    buildSignupOpenedPost(edition, await giftFor(challenge)),
  );
  const note = await storeSignupPost(edition.id, channelId, messageId, deps);
  return `Opened sign-up for ${edition.challenge.name} ${edition.year} (Edition ${edition.id}).` +
    note;
}

const SMALL_NUMBERS = [
  "No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The payload's whole number at `key`, or 0 when it has none. */
function payloadCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * The opening post's message ID when it is in `channelId` (a reply must be in the same
 * channel: a post made in Preview lives in bot-dev), else null.
 */
export function replyTarget(
  payload: Record<string, unknown>,
  channelId: string,
): string | null {
  const post = payload.signup_post as Partial<ISignupPost> | null | undefined;
  if (!post || typeof post !== "object") return null;
  return post.channel_id === channelId && typeof post.message_id === "string"
    ? post.message_id
    : null;
}

/**
 * A short follow-up: a reply to the opening post, or, without it here, a post that names
 * the Edition first so it reads on its own.
 */
function followUpPost(
  edition: IChallengeEdition,
  replyTo: string | null,
  body: string,
  withSignUp: boolean,
): IChallengePost {
  const content = replyTo ? body : `### ${editionName(edition)}\n${body}`;
  const components = [text(content).toJSON()];
  return {
    components: withSignUp ? [...components, signUpRow(edition).toJSON()] : components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(replyTo ? { replyTo } : {}),
  };
}

/** "-# 2 members sit this one out with too few games in their backlog." or null. */
function leftOutLine(leftOut: number, past: boolean): string | null {
  if (!leftOut) return null;
  const verb = past ? "sat" : leftOut === 1 ? "sits" : "sit";
  return `-# ${plural(leftOut, "member", "members")} ${verb} this one out with too few ` +
    "games in their backlog.";
}

/** "Three days left: 14 members have signed up. Sign up before 1 December." */
export function signupClosingText(edition: IChallengeEdition, daysLeft: number): string {
  const days = daysLeft === 1 ? "One day" : `${SMALL_NUMBERS[daysLeft] ?? daysLeft} days`;
  const count = edition.signed_up_count;
  const who = count === 0
    ? "nobody has signed up yet"
    : `${plural(count, "member has", "members have")} signed up`;
  return `${days} left: ${who}. Sign up before ${editionDay(edition.signup_cutoff_on)}.`;
}

/**
 * Payload `{ event: "signup_closing", challenge, edition, days_left, signup_post }`: a
 * reply to the opening post with the count so far and Sign up.
 */
export async function announceSignupClosing(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const edition = payloadEdition(payload);
  const daysLeft = payloadCount(payload, "days_left");
  const replyTo = replyTarget(payload, channelId);
  await deps.postMessage(
    channelId,
    followUpPost(edition, replyTo, signupClosingText(edition, daysLeft), true),
  );
  return `Posted that sign-up for ${edition.challenge.name} ${edition.year} closes in ` +
    `${plural(daysLeft, "day", "days")}${replyTo ? ", as a reply" : ""}.`;
}

/**
 * Payload `{ event: "signup_closed", challenge, edition, joined, left_out, signup_post }`:
 * the draw is done; a reply with the members drawn.
 */
export async function announceSignupClosed(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const edition = payloadEdition(payload);
  const joined = payloadCount(payload, "joined");
  const replyTo = replyTarget(payload, channelId);
  const lines = [
    `Sign-up is closed with **${plural(joined, "member", "members")}**. The draw is done: ` +
      `Santas, check ${commandMention("challenge santa pick")}.`,
    leftOutLine(payloadCount(payload, "left_out"), false),
  ].filter((line): line is string => !!line);
  await deps.postMessage(channelId, followUpPost(edition, replyTo, lines.join("\n"), false));
  return `Posted the draw for ${edition.challenge.name} ${edition.year}: ` +
    `${plural(joined, "member", "members")} drawn.`;
}

/**
 * Payload `{ event: "edition_cancelled", challenge, edition, joined, left_out,
 * signup_post }`: fewer than 2 members could be drawn; a reply saying so, and when the
 * next Edition's sign-up opens (the day after this one's reveal).
 */
export async function announceEditionCancelled(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const edition = payloadEdition(payload);
  const joined = payloadCount(payload, "joined");
  const replyTo = replyTarget(payload, channelId);
  const drawn = joined
    ? `only ${plural(joined, "member", "members")} could be drawn`
    : "nobody could be drawn";
  const nextOpens = DateTime.fromISO(edition.reveal_on).plus({ days: 1 }).toISODate();
  const next = editionName({ ...edition, year: edition.year + 1 });
  const lines = [
    `${editionName(edition)} is cancelled: the circle needs at least 2 Santas, and ` +
      `${drawn}.` +
      (nextOpens ? ` Sign-up for ${next} opens on ${editionDay(nextOpens)}.` : ""),
    leftOutLine(payloadCount(payload, "left_out"), true),
  ].filter((line): line is string => !!line);
  await deps.postMessage(channelId, followUpPost(edition, replyTo, lines.join("\n"), false));
  return `Posted that ${edition.challenge.name} ${edition.year} is cancelled ` +
    `(${plural(joined, "member", "members")} could be drawn).`;
}

/**
 * Payload `{ event: "left_out_of_draw", user_id, challenge, edition, backlog_count,
 * minimum }`: the DM telling a member the draw left them out, and how to be in the next.
 * Sent whatever their Challenge DM setting (it is news about their own sign-up).
 */
export async function leftOutOfDrawDm(payload: Record<string, unknown>):
  Promise<IChallengeDm> {
  const userId = payload.user_id;
  if (typeof userId !== "string" || !/^\d+$/.test(userId)) {
    throw new Error(`Invalid payload: user_id must be a Discord user ID, got ${
      JSON.stringify(userId)
    }.`);
  }
  const edition = payloadEdition(payload);
  const minimum = payloadCount(payload, "minimum");
  const backlog = payloadCount(payload, "backlog_count");
  const nextOpens = DateTime.fromISO(edition.reveal_on).plus({ days: 1 }).toISODate();
  const next = editionName({ ...edition, year: edition.year + 1 });
  const content = [
    `## ${editionName(edition)}: sitting this one out`,
    `The draw needs at least ${plural(minimum, "game", "games")} in your backlog to pick ` +
      `from, and yours had ${backlog} when sign-up closed, so you weren't drawn this time. ` +
      `Add games with ${commandMention("backlog add")}` +
      (nextOpens ? `, and sign up for ${next} from ${editionDay(nextOpens)}.` : "."),
  ].join("\n");
  return {
    userId,
    post: {
      components: [new ContainerBuilder().addTextDisplayComponents(text(content)).toJSON()],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    },
    about: `the left-out notice for "${edition.challenge.name} ${edition.year}" ` +
      `(Edition ${edition.id})`,
  };
}
