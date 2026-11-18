import sharp, { type OverlayOptions } from "sharp";
import { DISPLAY_FONT, DISPLAY_WEIGHT } from "../config/imageFonts.js";
import { decadeLabel, decadeOf } from "../functions/ChallengeSlotsCopy.js";
import type { IChallengeSlots } from "./ChallengeApi.js";
import {
  composeCanvas,
  coverTile,
  escapeXml,
  textCard,
  wrap,
  type ITileShape,
} from "./ChallengeImageTiles.js";

// The Slots pictures (spec api#376, bot#1550), drawn with sharp like the Run Finished
// shelf: the new-Challenge year strip (design 1B), a row of empty year slots, and the
// Caught Up year poster (design 3B), every year of a Run as a cover in its decade's row.

const BACKGROUND = { r: 17, g: 17, b: 20, alpha: 1 };
const INK = "#f4f4f0";
const MUTED = "#8f8b84";
const SLOT_LINE = "#4a4852";
const CARD = "#2a2932";
const BODY_FONT = "'DejaVu Sans Condensed', 'DejaVu Sans', sans-serif";
/** The SVG attributes that set text in the display face. */
const DISPLAY_TYPE = `font-family="${DISPLAY_FONT}" font-weight="${DISPLAY_WEIGHT}"`;

/** Year strip: at most this many tiles; a longer range shows its ends around a gap. */
const STRIP_TILES_MAX = 12;
const STRIP_END_TILES = 5;
const STRIP_TILE = { width: 72, height: 100 };
const STRIP_GAP = 10;
const STRIP_PADDING = 18;

/** One tile of the strip: a year, the birth year, or the gap in a long range. */
export interface IStripTile {
  label: string;
  /** A smaller second line under the label. */
  sub?: string;
  /** The gap tile, drawn without a frame. */
  gap?: boolean;
}

function yearsBetween(first: number, last: number): IStripTile[] {
  const count = last - first + 1;
  const year = (y: number): IStripTile => ({ label: String(y) });
  if (count <= STRIP_TILES_MAX) {
    return Array.from({ length: Math.max(0, count) }, (_, i) => year(first + i));
  }
  const head = Array.from({ length: STRIP_END_TILES }, (_, i) => year(first + i));
  const tail = Array.from({ length: STRIP_END_TILES }, (_, i) => year(last - 4 + i));
  return [...head, { label: "…", gap: true }, ...tail];
}

/**
 * The strip's tiles for a Slots range as of `currentYear`: every year of a short range, the
 * ends of a long one, and for a birth-year range a "born" tile before the last years.
 */
export function stripTiles(slots: IChallengeSlots, currentYear: number): IStripTile[] {
  const last = slots.last_year === "current_year" ? currentYear : slots.last_year;
  const tiles = slots.first_year === "birth_year"
    ? [
      { label: "Born", sub: "your year" },
      { label: "…", gap: true },
      ...yearsBetween(last - STRIP_END_TILES + 1, last),
    ]
    : yearsBetween(slots.first_year, last);
  if (slots.last_year === "current_year" && tiles.length) {
    tiles[tiles.length - 1] = { ...tiles[tiles.length - 1]!, sub: "now" };
  }
  return tiles;
}

function stripTileSvg(tile: IStripTile, x: number, y: number): string {
  const { width, height } = STRIP_TILE;
  const cx = x + width / 2;
  const labelSize = tile.label.length > 4 ? 18 : 21;
  const labelY = tile.sub ? y + height / 2 - 4 : y + height / 2 + 8;
  const frame = tile.gap
    ? ""
    : `<rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="6" ` +
      `fill="none" stroke="${SLOT_LINE}" stroke-width="2" stroke-dasharray="6 5"/>`;
  const sub = tile.sub
    ? `<text x="${cx}" y="${y + height / 2 + 20}" text-anchor="middle" font-size="13" ` +
      `font-family="${BODY_FONT}" fill="${MUTED}">${escapeXml(tile.sub)}</text>`
    : "";
  return frame +
    `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="${labelSize}" ` +
    `${DISPLAY_TYPE} fill="${tile.gap ? MUTED : INK}">` +
    `${escapeXml(tile.label)}</text>${sub}`;
}

/** The new-Challenge year strip as a PNG. Throws when there are no tiles. */
export async function composeYearStrip(tiles: readonly IStripTile[]): Promise<Buffer> {
  if (!tiles.length) throw new Error("A year strip needs at least one tile.");
  const width = STRIP_PADDING * 2 + tiles.length * STRIP_TILE.width +
    (tiles.length - 1) * STRIP_GAP;
  const height = STRIP_PADDING * 2 + STRIP_TILE.height;
  const body = tiles
    .map((tile, i) => stripTileSvg(tile, STRIP_PADDING + i * (STRIP_TILE.width + STRIP_GAP),
      STRIP_PADDING))
    .join("");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" rx="12" fill="rgb(17,17,20)"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** One year of the poster: its game (cover, or null for a title card) or an open slot. */
export interface IPosterYear {
  year: number;
  game: { title: string; cover: Buffer | null } | null;
}

export interface IPosterInput {
  /** The member's name, shown large. */
  name: string;
  /** "Years Alive · 1994 to 2026" */
  caption: string;
  cleared: number;
  target: number;
  years: readonly IPosterYear[];
}

const POSTER_PADDING = 36;
const POSTER_LABEL_WIDTH = 96;
const POSTER_TILE = { width: 84, height: 112 };
const POSTER_GAP = 8;
const POSTER_ROW_GAP = 12;
const POSTER_HEADER = 148;
const POSTER_LEGEND = 64;
const POSTER_CORNER = 6;

const POSTER_SHAPE: ITileShape = { ...POSTER_TILE, corner: POSTER_CORNER };

function titleCard(title: string): Buffer {
  // Three lines at most, kept above the year in the corner.
  return textCard(POSTER_SHAPE, {
    lines: wrap(title, 11, 3),
    fill: CARD,
    font: { family: BODY_FONT, size: 12, fill: INK },
    lineHeight: 15,
    middle: POSTER_TILE.height / 2 - 10,
  });
}

function posterTile(year: IPosterYear): Promise<Buffer | null> {
  const game = year.game;
  if (!game) return Promise.resolve(null);
  return coverTile(game.cover, POSTER_SHAPE, () => titleCard(game.title));
}

/** The year's two digits on a tile, over a shade so it reads on any cover. */
function yearMark(year: IPosterYear, x: number, y: number): string {
  const { width, height } = POSTER_TILE;
  const digits = String(year.year % 100).padStart(2, "0");
  if (!year.game) {
    return `<rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" ` +
      `rx="${POSTER_CORNER}" fill="none" stroke="${SLOT_LINE}" stroke-width="2" ` +
      `stroke-dasharray="6 5"/><text x="${x + 8}" y="${y + height - 10}" font-size="16" ` +
      `${DISPLAY_TYPE} fill="${MUTED}">${digits}</text>`;
  }
  return `<rect x="${x}" y="${y + height - 30}" width="${width}" height="30" ` +
    `fill="url(#shade)"/><text x="${x + 8}" y="${y + height - 10}" font-size="16" ` +
    `${DISPLAY_TYPE} fill="${INK}">${digits}</text>`;
}

/** The Caught Up year poster as a PNG. Throws when there are no years. */
export async function composeYearPoster(input: IPosterInput): Promise<Buffer> {
  if (!input.years.length) throw new Error("A year poster needs at least one year.");
  const decades = [...new Set(input.years.map((y) => decadeOf(y.year)))].sort((a, b) => a - b);
  const gridWidth = 10 * POSTER_TILE.width + 9 * POSTER_GAP;
  const width = POSTER_PADDING * 2 + POSTER_LABEL_WIDTH + gridWidth;
  const rowHeight = POSTER_TILE.height + POSTER_ROW_GAP;
  const height = POSTER_HEADER + decades.length * rowHeight - POSTER_ROW_GAP + POSTER_LEGEND;
  const left = POSTER_PADDING + POSTER_LABEL_WIDTH;
  const place = (year: number): { x: number; y: number } => ({
    x: left + (year % 10) * (POSTER_TILE.width + POSTER_GAP),
    y: POSTER_HEADER + decades.indexOf(decadeOf(year)) * rowHeight,
  });

  const tiles = await Promise.all(input.years.map(posterTile));
  const composites: OverlayOptions[] = [];
  input.years.forEach((year, i) => {
    const tile = tiles[i];
    if (!tile) return;
    const { x, y } = place(year.year);
    composites.push({ input: tile, left: x, top: y });
  });

  const right = width - POSTER_PADDING;
  const labels = decades.map((decade, row) =>
    `<text x="${POSTER_PADDING}" y="${POSTER_HEADER + row * rowHeight + POSTER_TILE.height / 2}"` +
      ` dominant-baseline="middle" font-size="18" ${DISPLAY_TYPE} ` +
      `fill="${MUTED}">${decadeLabel(decade)}</text>`).join("");
  const marks = input.years.map((year) => {
    const { x, y } = place(year.year);
    return yearMark(year, x, y);
  }).join("");
  const legendY = height - POSTER_LEGEND / 2;
  const overlay =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    "<defs><linearGradient id=\"shade\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
    "<stop offset=\"0\" stop-color=\"#000\" stop-opacity=\"0\"/>" +
    "<stop offset=\"1\" stop-color=\"#000\" stop-opacity=\"0.75\"/></linearGradient></defs>" +
    `<text x="${POSTER_PADDING}" y="84" font-size="56" ${DISPLAY_TYPE} ` +
    `fill="${INK}">${escapeXml(input.name.toUpperCase())}</text>` +
    `<text x="${POSTER_PADDING}" y="114" font-size="17" font-family="${BODY_FONT}" ` +
    `font-weight="700" letter-spacing="1" fill="${MUTED}">` +
    `${escapeXml(input.caption.toUpperCase())}</text>` +
    `<text x="${right}" y="96" text-anchor="end" ${DISPLAY_TYPE} ` +
    `fill="${INK}"><tspan font-size="76">${input.cleared}</tspan>` +
    `<tspan font-size="34" fill="${MUTED}">/${input.target}</tspan></text>` +
    `<rect x="${POSTER_PADDING}" y="128" width="${width - POSTER_PADDING * 2}" height="3" ` +
    `fill="${INK}"/>${labels}${marks}` +
    `<rect x="${POSTER_PADDING}" y="${legendY - 9}" width="14" height="18" rx="2" ` +
    `fill="#5b7fb5"/><text x="${POSTER_PADDING + 22}" y="${legendY + 6}" font-size="14" ` +
    `font-family="${BODY_FONT}" font-weight="700" fill="${MUTED}">CLEARED</text>` +
    `<rect x="${POSTER_PADDING + 120}" y="${legendY - 9}" width="14" height="18" rx="2" ` +
    `fill="none" stroke="${SLOT_LINE}" stroke-width="2" stroke-dasharray="3 3"/>` +
    `<text x="${POSTER_PADDING + 142}" y="${legendY + 6}" font-size="14" ` +
    `font-family="${BODY_FONT}" font-weight="700" fill="${MUTED}">OPEN</text></svg>`;
  composites.push({ input: Buffer.from(overlay), left: 0, top: 0 });

  return composeCanvas({ width, height }, BACKGROUND, composites);
}
