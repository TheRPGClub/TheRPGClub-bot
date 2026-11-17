import sharp, { type OverlayOptions } from "sharp";

// What the Challenge pictures (the Run Finished shelf, the Slots poster, the Secret Santa
// gift tags) draw alike with sharp: covers cut to rounded tiles, cards of centred text for
// a game without a cover, and the dark canvas the tiles are laid on.

/** A tile's size and corner radius, in pixels. */
export interface ITileShape {
  width: number;
  height: number;
  corner: number;
}

/** Centred lines on a tile-sized card. */
export interface ITextCard {
  lines: readonly string[];
  /** The card's colour. */
  fill: string;
  font: { family: string; size: number; fill: string };
  lineHeight: number;
  /** Where the middle line sits; the tile's middle by default. */
  middle?: number;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Words into lines of about `width` characters, at most `max` lines (the last cut). */
export function wrap(value: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1]!.slice(0, width - 1)}…`;
  return kept;
}

function roundedRect(shape: ITileShape, attributes = ""): string {
  return `<rect width="${shape.width}" height="${shape.height}" rx="${shape.corner}" ` +
    `ry="${shape.corner}"${attributes}/>`;
}

/** A card of centred text lines: a game's title, or "+N more". */
export function textCard(shape: ITileShape, card: ITextCard): Buffer {
  const middle = card.middle ?? shape.height / 2;
  const top = middle - ((card.lines.length - 1) * card.lineHeight) / 2;
  const text = card.lines.map((line, index) =>
    `<text x="50%" y="${top + index * card.lineHeight}" text-anchor="middle" ` +
      `dominant-baseline="middle">${escapeXml(line)}</text>`).join("");
  return Buffer.from(
    `<svg width="${shape.width}" height="${shape.height}">` +
      roundedRect(shape, ` fill="${card.fill}"`) +
      `<g font-family="${card.font.family}" font-size="${card.font.size}" font-weight="700" ` +
      `fill="${card.font.fill}">${text}</g></svg>`,
  );
}

/**
 * A cover cut to a rounded tile, or `fallback()` (a title card) without a cover or for an
 * image sharp can't read.
 */
export async function coverTile(
  cover: Buffer | null,
  shape: ITileShape,
  fallback: () => Buffer,
): Promise<Buffer> {
  if (!cover) return fallback();
  const mask = Buffer.from(
    `<svg width="${shape.width}" height="${shape.height}">${roundedRect(shape)}</svg>`,
  );
  try {
    return await sharp(cover)
      .resize(shape.width, shape.height, { fit: "cover" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return fallback();
  }
}

/** The picture as a PNG: the overlays laid on a canvas of one colour. */
export function composeCanvas(
  size: { width: number; height: number },
  background: { r: number; g: number; b: number; alpha: number },
  composites: OverlayOptions[],
): Promise<Buffer> {
  return sharp({ create: { ...size, channels: 4, background } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}
