import type { OverlayOptions } from "sharp";
import {
  composeCanvas,
  coverTile,
  escapeXml,
  textCard,
  wrap,
  type ITileShape,
} from "./ChallengeImageTiles.js";

// The Secret Santa reveal sheet (design 7C "Gift tags"): every picked game's cover with a
// gold tag naming who it is for, under a "Secret Santa 2026 / Revealed 25 December"
// header, drawn with sharp like the Run Finished shelf. Never a Santa's name: a tag only
// ever names the recipient.

/** One gift on the sheet: the recipient, their game (null: nothing could be picked). */
export interface IGiftTag {
  recipient: string;
  game: { title: string; cover: Buffer | null } | null;
}

/** Tiles drawn at most; past it the last tile says "+N more". */
export const GIFT_TAGS_MAX = 24;

const COLUMNS_MAX = 6;
const COVER_WIDTH = 168;
const COVER_HEIGHT = 224;
const GAP_X = 16;
const GAP_Y = 22;
const PADDING = 28;
const HEADER_HEIGHT = 46;
const RULE_HEIGHT = 4;
const HEADER_GAP = 20;
const TAG_TOP = 8;
const TAG_HEIGHT = 30;
const TAG_FONT = 17;
const TITLE_TOP = 22;
const TITLE_FONT = 15;
const TITLE_LINE = 18;
const TITLE_LINES = 2;
const TITLE_CHARS = 17;
const CELL_HEIGHT = COVER_HEIGHT + TAG_TOP + TAG_HEIGHT + TITLE_TOP + TITLE_LINE * TITLE_LINES;
const CORNER = 4;

// The mock's colours: a deep holly sheet, paper text and a gold ribbon.
const BACKGROUND = { r: 14, g: 23, b: 18, alpha: 1 };
const PAPER = "#f4f4f0";
const PAPER_DIM = "#b7bcb4";
const GOLD = "#e8c35a";
const TAG_INK = "#1a1400";
const CARD = "#1b2a21";
const BOX = "#1f4d36";
const FONT = "'Barlow Condensed', 'Roboto Condensed', 'DejaVu Sans Condensed', sans-serif";
/** About how wide a bold uppercase character of the tag font draws, per pixel of size. */
const TAG_CHAR_WIDTH = 0.66;

const SHAPE: ITileShape = { width: COVER_WIDTH, height: COVER_HEIGHT, corner: CORNER };

/** A tile without a cover: the title on a card. */
function titleCard(lines: string[], size: number): Buffer {
  return textCard(SHAPE, {
    lines,
    fill: CARD,
    font: { family: FONT, size, fill: PAPER },
    lineHeight: Math.round(size * 1.25),
  });
}

/** A wrapped present: the tile of a recipient whose backlog had nothing to pick. */
function giftBox(): Buffer {
  const ribbon = 14;
  return Buffer.from(
    `<svg width="${COVER_WIDTH}" height="${COVER_HEIGHT}">` +
      `<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" rx="${CORNER}" fill="${BOX}"/>` +
      `<rect x="${(COVER_WIDTH - ribbon) / 2}" width="${ribbon}" height="${COVER_HEIGHT}" ` +
      `fill="${GOLD}"/><rect y="${COVER_HEIGHT * 0.42}" width="${COVER_WIDTH}" ` +
      `height="${ribbon}" fill="${GOLD}"/></svg>`,
  );
}

function giftTile(tag: IGiftTag): Promise<Buffer> {
  const game = tag.game;
  if (!game) return Promise.resolve(giftBox());
  return coverTile(game.cover, SHAPE, () => titleCard(wrap(game.title.toUpperCase(), 14, 6), 20));
}

/** The tag's name cut to fit the tile next to "TO". */
function tagName(name: string): string {
  const room = Math.floor((COVER_WIDTH - 16) / (TAG_FONT * TAG_CHAR_WIDTH)) - 3;
  const upper = name.toUpperCase();
  return upper.length > room ? `${upper.slice(0, room - 1)}…` : upper;
}

/** The gold "TO LUFIA" tag and the game's title under a tile at (left, top). */
function tagSvg(tag: IGiftTag, left: number, top: number): string {
  const name = tagName(tag.recipient);
  const width = Math.min(
    COVER_WIDTH,
    Math.round((name.length + 3) * TAG_FONT * TAG_CHAR_WIDTH) + 12,
  );
  const tagTop = top + COVER_HEIGHT + TAG_TOP;
  const baseline = tagTop + TAG_HEIGHT / 2;
  const title = tag.game ? tag.game.title : "Nothing to pick";
  const lines = wrap(title.toUpperCase(), TITLE_CHARS, TITLE_LINES);
  const titleTop = tagTop + TAG_HEIGHT + TITLE_TOP - 4;
  return `<rect x="${left}" y="${tagTop}" width="${width}" height="${TAG_HEIGHT}" ` +
    `rx="${CORNER}" fill="${GOLD}"/>` +
    `<text x="${left + 6}" y="${baseline}" dominant-baseline="central" ` +
    `font-size="${TAG_FONT}" fill="${TAG_INK}">` +
    `<tspan font-weight="600" fill-opacity="0.7">TO</tspan>` +
    `<tspan dx="5" font-weight="800">${escapeXml(name)}</tspan></text>` +
    lines.map((line, index) =>
      `<text x="${left}" y="${titleTop + index * TITLE_LINE}" font-size="${TITLE_FONT}" ` +
        `font-weight="600" fill="${PAPER_DIM}">${escapeXml(line)}</text>`).join("");
}

/**
 * The reveal sheet as a PNG: `title` ("Secret Santa 2026") and `note` ("Revealed 25
 * December") over up to GIFT_TAGS_MAX tagged covers, 6 to a row. Throws when there are no
 * tags.
 */
export async function composeGiftTags(
  title: string,
  note: string,
  tags: readonly IGiftTag[],
): Promise<Buffer> {
  if (!tags.length) throw new Error("A reveal sheet needs at least one gift.");
  const shown = tags.length > GIFT_TAGS_MAX ? tags.slice(0, GIFT_TAGS_MAX - 1) : tags;
  const more = tags.length - shown.length;
  const tiles = shown.length + (more ? 1 : 0);
  const columns = Math.min(COLUMNS_MAX, tiles);
  const rows = Math.ceil(tiles / columns);
  const gridWidth = columns * COVER_WIDTH + (columns - 1) * GAP_X;
  const width = Math.max(PADDING * 2 + gridWidth, 560);
  const gridLeft = Math.round((width - gridWidth) / 2);
  const gridTop = PADDING + HEADER_HEIGHT + RULE_HEIGHT + HEADER_GAP;
  const height = gridTop + rows * CELL_HEIGHT + (rows - 1) * GAP_Y + PADDING;
  const at = (index: number): { left: number; top: number } => ({
    left: gridLeft + (index % columns) * (COVER_WIDTH + GAP_X),
    top: gridTop + Math.floor(index / columns) * (CELL_HEIGHT + GAP_Y),
  });

  const covers = await Promise.all(shown.map(giftTile));
  const composites: OverlayOptions[] = covers.map((input, index) => ({ input, ...at(index) }));
  if (more) composites.push({ input: titleCard([`+${more} more`], 30), ...at(shown.length) });

  const ruleTop = PADDING + HEADER_HEIGHT;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g font-family="${FONT}">` +
    `<text x="${PADDING}" y="${ruleTop - 10}" font-size="40" font-weight="800" ` +
    `fill="${PAPER}">${escapeXml(title.toUpperCase())}</text>` +
    `<text x="${width - PADDING}" y="${ruleTop - 12}" text-anchor="end" font-size="18" ` +
    `font-weight="700" letter-spacing="1.5" fill="${GOLD}">${escapeXml(note.toUpperCase())}` +
    "</text>" +
    `<rect x="${PADDING}" y="${ruleTop}" width="${width - PADDING * 2}" ` +
    `height="${RULE_HEIGHT}" fill="${GOLD}"/>` +
    shown.map((tag, index) => {
      const { left, top } = at(index);
      return tagSvg(tag, left, top);
    }).join("") +
    "</g></svg>";
  composites.push({ input: Buffer.from(svg), left: 0, top: 0 });

  return composeCanvas({ width, height }, BACKGROUND, composites);
}
