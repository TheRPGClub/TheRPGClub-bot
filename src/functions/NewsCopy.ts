import { DISCORD_MESSAGE_CONTENT_MAX } from "../config/suggestions.js";

// The News Copy (spec api#367): the bot's copy of a News Item in its News Category's thread.
// A plain message, not a Components V2 container, so Discord shows the link's preview as it
// does on the original. Pure: posting it is the caller's job.

const ELLIPSIS = "…";

/**
 * What the bot uploads with one message: Discord's default upload limit, which holds in any
 * server whatever its boost level. Images past it are linked instead (see {@link buildNewsCopy}).
 */
export const NEWS_COPY_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

/** An image of the original, uploaded again with the copy. */
export interface INewsCopyImage {
  /** Where to fetch it: the original message's attachment address, freshly read. */
  url: string;
  /** Its file name on the original; a `SPOILER_` prefix keeps it hidden. */
  name: string;
  /** Its size in bytes, when known. An image of unknown size is uploaded. */
  size?: number;
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
 * The images split into those uploaded with the copy and those linked: in posted order, an
 * image is uploaded while it fits in what is left of `limit`, so a copy never fails for size.
 */
function splitBySize(
  images: readonly INewsCopyImage[],
  limit: number,
): { uploaded: INewsCopyImage[]; linked: INewsCopyImage[] } {
  const uploaded: INewsCopyImage[] = [];
  const linked: INewsCopyImage[] = [];
  let left = limit;
  for (const image of images) {
    const size = image.size ?? 0;
    if (size > left) {
      linked.push(image);
      continue;
    }
    uploaded.push(image);
    left -= size;
  }
  return { uploaded, linked };
}

/**
 * The News Copy of a News Item: the sharer's name (no ping; the date too for an imported
 * item), their comment, the link, their images as files and a link to the original. Images
 * past the upload limit are linked on their own lines instead (Discord shows them from the
 * link). A comment too long for one message is shortened; nothing else is.
 */
export function buildNewsCopy(
  source: INewsCopySource,
  uploadLimit: number = NEWS_COPY_UPLOAD_LIMIT_BYTES,
): INewsCopyMessage {
  const { uploaded, linked } = splitBySize(source.images, uploadLimit);
  const head = creditLine(source);
  const tail = [source.linkUrl, ...linked.map((image) => image.url),
    `-# Discuss: ${source.originalUrl}`]
    .filter((line): line is string => line !== null);
  let lines = [head, ...tail];
  if (source.comment) {
    const room = DISCORD_MESSAGE_CONTENT_MAX - lines.join("\n").length - 1;
    lines = [head, fitted(source.comment, room), ...tail];
  }
  return {
    content: lines.join("\n"),
    files: uploaded.map((image) => ({ attachment: image.url, name: image.name })),
    allowedMentions: { parse: [] },
  };
}
