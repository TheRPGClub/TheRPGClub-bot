// The News Copy (spec api#367): the bot's copy of a News Item in its News Category's thread.
// A plain message, not a Components V2 container, so Discord shows the link's preview as it
// does on the original. Pure: posting it is the caller's job.

/** Discord's limit on a message's text. */
const MESSAGE_LIMIT = 2000;
const ELLIPSIS = "…";

/** An image of the original, uploaded again with the copy. */
export interface INewsCopyImage {
  /** Where to fetch it: the original message's attachment address, freshly read. */
  url: string;
  /** Its file name on the original; a `SPOILER_` prefix keeps it hidden. */
  name: string;
}

/** What a News Copy shows. */
export interface INewsCopySource {
  /** The jump link to the original message, where discussion happens. */
  originalUrl: string;
  /** The sharer, shown as a mention that does not ping. */
  authorId: string;
  comment: string | null;
  linkUrl: string | null;
  images: readonly INewsCopyImage[];
  /** The original date, shown on copies of imported items. Null for a live post. */
  postedAt: Date | null;
}

/** The copy as discord.js message options: `channel.send(copy)` or `message.edit(copy)`. */
export interface INewsCopyMessage {
  content: string;
  files: { attachment: string; name: string }[];
  allowedMentions: { parse: [] };
}

function creditLine(source: INewsCopySource): string {
  const credit = `<@${source.authorId}> shared`;
  if (!source.postedAt) return credit;
  return `${credit} on <t:${Math.floor(source.postedAt.getTime() / 1000)}:D>`;
}

/** The comment, cut to `room` characters (ending in an ellipsis when cut). */
function fitted(comment: string, room: number): string {
  if (comment.length <= room) return comment;
  return `${comment.slice(0, Math.max(0, room - ELLIPSIS.length)).trimEnd()}${ELLIPSIS}`;
}

/**
 * The News Copy of a News Item: the sharer's name (no ping; the date too for an imported
 * item), their comment, the link, their images as files and a link to the original. A
 * comment too long for one message is shortened; nothing else is.
 */
export function buildNewsCopy(source: INewsCopySource): INewsCopyMessage {
  const head = creditLine(source);
  const tail = [source.linkUrl, `-# Discuss: ${source.originalUrl}`]
    .filter((line): line is string => line !== null);
  let lines = [head, ...tail];
  if (source.comment) {
    const room = MESSAGE_LIMIT - lines.join("\n").length - 1;
    lines = [head, fitted(source.comment, room), ...tail];
  }
  return {
    content: lines.join("\n"),
    files: source.images.map((image) => ({ attachment: image.url, name: image.name })),
    allowedMentions: { parse: [] },
  };
}
