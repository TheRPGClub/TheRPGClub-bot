import type { OverlayOptions } from "sharp";
import {
  composeCanvas,
  coverTile,
  textCard,
  wrap,
  type ITileShape,
} from "./ChallengeImageTiles.js";

// The Run Finished shelf (design 3B): the Run's Cleared covers standing on a shelf, up to
// 5 a row, drawn with sharp like the vote collage (collageGenerator). A game without a
// cover gets a card with its title, and games past the last tile a "+N more" card. The
// Season opened post's cover strip (design 2B) draws its tiles the same way.

/** One tile on the shelf: a game (its cover, or null for a title card) or the rest. */
export type ShelfTile =
  | { kind: "game"; title: string; cover: Buffer | null }
  | { kind: "more"; count: number };

const COVER_WIDTH = 264;
const COVER_HEIGHT = 352;
const GAP = 24;
const PADDING = 32;
const PLANK_HEIGHT = 14;
const ROW_GAP = 28;
const PER_ROW_MAX = 5;
const CORNER = 10;
const BACKGROUND = { r: 23, g: 22, b: 28, alpha: 1 };
const PLANK = "#6b4a2b";
const PLANK_EDGE = "#8d6640";
const CARD = "#2a2932";
const CARD_TEXT = "#e8e4dc";
const CARD_MUTED = "#a9a39a";
/** Characters per line and lines on a title card. */
const TITLE_LINE_CHARS = 16;
const TITLE_LINES_MAX = 5;

const SHAPE: ITileShape = { width: COVER_WIDTH, height: COVER_HEIGHT, corner: CORNER };

/** A card with centred text lines: a game's title, or "+N more". */
function card(lines: string[], options: { size: number; muted?: boolean }): Buffer {
  return textCard(SHAPE, {
    lines,
    fill: CARD,
    font: {
      family: "sans-serif",
      size: options.size,
      fill: options.muted ? CARD_MUTED : CARD_TEXT,
    },
    lineHeight: Math.round(options.size * 1.25),
  });
}

function tileImage(tile: ShelfTile): Promise<Buffer> {
  if (tile.kind === "more") {
    return Promise.resolve(card([`+${tile.count} more`], { size: 44, muted: true }));
  }
  return coverTile(tile.cover, SHAPE, () =>
    card(wrap(tile.title, TITLE_LINE_CHARS, TITLE_LINES_MAX), { size: 26 }));
}

/** Tiles per row: balanced rows of at most 5 (6 as 3 and 3, 7 as 4 and 3). */
function rowSizes(count: number): number[] {
  const rows = Math.ceil(count / PER_ROW_MAX);
  const perRow = Math.ceil(count / rows);
  const sizes: number[] = [];
  for (let left = count; left > 0; left -= perRow) sizes.push(Math.min(perRow, left));
  return sizes;
}

function plank(width: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${PLANK_HEIGHT}">` +
      `<rect width="${width}" height="${PLANK_HEIGHT}" rx="4" ry="4" fill="${PLANK}"/>` +
      `<rect width="${width}" height="3" rx="1.5" ry="1.5" fill="${PLANK_EDGE}"/></svg>`,
  );
}

/**
 * The Season opened strip (design 2B): the tiles in one row, no shelf, on the same dark
 * backdrop. Throws when there are no tiles.
 */
export async function composeCoverStrip(tiles: readonly ShelfTile[]): Promise<Buffer> {
  if (!tiles.length) throw new Error("A strip needs at least one tile.");
  const width = PADDING * 2 + tiles.length * COVER_WIDTH + (tiles.length - 1) * GAP;
  const height = PADDING * 2 + COVER_HEIGHT;
  const images = await Promise.all(tiles.map(tileImage));
  const composites: OverlayOptions[] = images.map((input, index) => ({
    input,
    left: PADDING + index * (COVER_WIDTH + GAP),
    top: PADDING,
  }));
  return composeCanvas({ width, height }, BACKGROUND, composites);
}

/** The shelf as a PNG. Throws when there are no tiles. */
export async function composeRunShelf(tiles: readonly ShelfTile[]): Promise<Buffer> {
  if (!tiles.length) throw new Error("A shelf needs at least one tile.");
  const sizes = rowSizes(tiles.length);
  const widest = Math.max(...sizes);
  const rowWidth = (count: number): number => count * COVER_WIDTH + (count - 1) * GAP;
  const width = PADDING * 2 + rowWidth(widest);
  const rowHeight = COVER_HEIGHT + PLANK_HEIGHT;
  const height = PADDING * 2 + sizes.length * rowHeight + (sizes.length - 1) * ROW_GAP;

  const images = await Promise.all(tiles.map(tileImage));
  const composites: OverlayOptions[] = [];
  let index = 0;
  sizes.forEach((count, row) => {
    const top = PADDING + row * (rowHeight + ROW_GAP);
    const left = PADDING + Math.round((rowWidth(widest) - rowWidth(count)) / 2);
    for (let column = 0; column < count; column += 1) {
      composites.push({ input: images[index]!, left: left + column * (COVER_WIDTH + GAP), top });
      index += 1;
    }
    composites.push({
      input: plank(rowWidth(count) + GAP),
      left: left - Math.round(GAP / 2),
      top: top + COVER_HEIGHT,
    });
  });

  return composeCanvas({ width, height }, BACKGROUND, composites);
}
