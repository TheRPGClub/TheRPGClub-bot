import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from "@discordjs/builders";
import { MessageFlags } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  escapeChallengeText,
  formatChallengeDate,
  listJoin,
  memberName,
} from "../functions/ChallengeCopy.js";
import { logError } from "../utilities/LogUtils.js";
import type { IChallengeJobDeps, IChallengePost } from "./ChallengeAnnouncements.js";
import type { IChallengeEdition, IEditionAssignment } from "./ChallengeEditionApi.js";
import { composeGiftTags, GIFT_TAGS_MAX, type IGiftTag } from "./ChallengeGiftTagsImage.js";
import { commandMention } from "./CommandMentionService.js";
import { editionDay, editionName, replyTarget } from "./ChallengeSignupPosts.js";
import { plural } from "../utilities/TextUtils.js";
import { payloadEdition } from "./ChallengePayloads.js";

// The Secret Santa reveal (spec api#376, bot#1552), design 7C "Gift tags": on the reveal
// date one post, replying to the Edition's opening post, shows every gift as one generated
// sheet of covers tagged with their recipients. Santas are never named: the payload has
// none before the Edition ends, and the post reads only the recipients.

/** A media gallery item's description holds at most this many characters. */
const ALT_TEXT_MAX = 1024;

/** "To Lufia: Vagrant Story", or ": nothing to pick" when no game could be picked. */
function giftLine(assignment: IEditionAssignment): string {
  const game = assignment.game?.title ?? "nothing to pick";
  return `To ${memberName(assignment.recipient)}: ${game}`;
}

/** The sheet's alt text: every gift in words, cut to what Discord holds. */
function altText(assignments: readonly IEditionAssignment[]): string {
  const all = `${assignments.map(giftLine).join(". ")}.`;
  return all.length <= ALT_TEXT_MAX ? all : `${all.slice(0, ALT_TEXT_MAX - 1)}…`;
}

/** "Vexx's", "Vexx's and Zeal's": recipients named for the closing line. */
function possessives(assignments: readonly IEditionAssignment[]): string {
  return listJoin(assignments.map((a) => `${escapeChallengeText(memberName(a.recipient))}'s`));
}

/**
 * "-# Full list: /challenge show Secret Santa · 17 games · Vexx's was picked at random":
 * where to read every gift, and the gifts the Santas didn't pick themselves.
 */
function closingLine(edition: IChallengeEdition, assignments: IEditionAssignment[]): string {
  const games = assignments.filter((a) => a.game).length;
  const random = assignments.filter((a) => a.game && a.picked_randomly);
  const nothing = assignments.filter((a) => !a.game);
  const parts = [
    `Full list: ${commandMention("challenge show")} ` +
      escapeChallengeText(edition.challenge.name),
    `${plural(games, "game")}`,
  ];
  if (random.length) {
    parts.push(`${possessives(random)} ${random.length === 1 ? "was" : "were"} picked at random`);
  }
  if (nothing.length) {
    parts.push(`${possessives(nothing)} ${nothing.length === 1 ? "backlog" : "backlogs"} had ` +
      "nothing to pick");
  }
  return `-# ${parts.join(" · ")}`;
}

/** The reveal post: the heading, when to Clear by, the sheet (or the list), and the line. */
export function buildRevealPost(
  edition: IChallengeEdition,
  sheet: Buffer | null,
  replyTo: string | null,
): IChallengePost {
  const fileName = `secret-santa-${edition.year}-reveal.png`;
  const assignments = edition.assignments ?? [];
  const container = new ContainerBuilder().addTextDisplayComponents(buildTextDisplay(
    `# ${editionName(edition)}\n` +
      "The presents are open. Clear yours before " +
      `${formatChallengeDate(edition.ends_on)} to Finish.`,
  ));
  if (sheet) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(`attachment://${fileName}`)
        .setDescription(altText(assignments)),
    ));
  } else if (assignments.length) {
    // No picture: the gifts in words instead.
    container.addTextDisplayComponents(buildTextDisplay(assignments.map((a) =>
      `**To ${escapeChallengeText(memberName(a.recipient))}:** ` +
        escapeChallengeText(a.game?.title ?? "nothing to pick")).join("\n")));
  }
  if (assignments.length) {
    container.addTextDisplayComponents(buildTextDisplay(closingLine(edition, assignments)));
  }
  return {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    ...(sheet ? { files: [{ name: fileName, data: sheet }] } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

/** The gift-tag sheet, or null without gifts or when drawing it fails (logged). */
async function revealSheet(
  edition: IChallengeEdition,
  assignments: readonly IEditionAssignment[],
  deps: IChallengeJobDeps,
): Promise<Buffer | null> {
  if (!assignments.length) return null;
  try {
    const drawn = assignments.length > GIFT_TAGS_MAX
      ? assignments.slice(0, GIFT_TAGS_MAX - 1)
      : assignments;
    const tags: IGiftTag[] = await Promise.all(drawn.map(async (a) => ({
      recipient: memberName(a.recipient),
      game: a.game
        ? { title: a.game.title, cover: await deps.coverImage(a.game.game_id) }
        : null,
    })));
    const rest = assignments.slice(drawn.length).map((a): IGiftTag => ({
      recipient: memberName(a.recipient),
      game: null,
    }));
    return await composeGiftTags(
      editionName(edition).replace(/\\/g, ""),
      `Revealed ${editionDay(edition.reveal_on)}`,
      [...tags, ...rest],
    );
  } catch (err: unknown) {
    logError("ChallengeReveal.sheet", err);
    return null;
  }
}

/**
 * Payload `{ event: "edition_revealed", challenge, edition, signup_post, feature_key }`:
 * the Edition's `assignments` (without Santas) as one gift-tag sheet, replying to the
 * opening post when it is in `channelId`.
 */
export async function announceEditionRevealed(
  payload: Record<string, unknown>,
  channelId: string,
  deps: IChallengeJobDeps,
): Promise<string> {
  const edition = payloadEdition(payload);
  const assignments = edition.assignments ?? [];
  const sheet = await revealSheet(edition, assignments, deps);
  const replyTo = replyTarget(payload, channelId);
  await deps.postMessage(channelId, buildRevealPost(edition, sheet, replyTo));
  const games = assignments.filter((a) => a.game).length;
  return `Revealed ${edition.challenge.name} ${edition.year}: ${games} ` +
    `${games === 1 ? "game" : "games"}${sheet ? "" : ", without the picture"}` +
    `${replyTo ? ", as a reply" : ""}.`;
}
