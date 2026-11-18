import sharp, { type OverlayOptions } from "sharp";
import { DISPLAY_FONT, DISPLAY_WEIGHT, LABEL_FONT } from "../config/imageFonts.js";
import { composeCanvas, coverTile, escapeXml } from "./ChallengeImageTiles.js";

// The Birthday Post's banner (spec api#396, design pick 1C): "HAPPY BIRTHDAY" in the club's
// print style (Anton, a paper rule, highlighter-yellow names and paper confetti), with the
// members' Discord avatars beside it, up to 4 then a "+N" sticker. Drawn with sharp like the
// Challenge pictures.

/** One member on the banner: their Discord name and avatar (null: an initial instead). */
export interface IBannerMember {
  name: string;
  avatar: Buffer | null;
}

export interface IBirthdayBannerInput {
  /** The club day, as the banner's top line shows it: "18 November". */
  dateLabel: string;
  /** Every member greeted, in the post's order. */
  members: readonly IBannerMember[];
}

/** Avatars drawn at most; past it a sticker says "+N". */
export const BANNER_AVATARS_MAX = 4;

export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 600;

const BACKGROUND = { r: 11, g: 11, b: 13, alpha: 1 };
const BACKGROUND_HEX = "#0b0b0d";
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const PAPER = "#f4f4f0";
const PAPER_DIM = "#b9b9b2";
const PAPER_MUTE = "#8d8d87";
const HIGHLIGHTER = "#ffd400";
const STICKER_INK = "#101012";
const CARD = "#2a2932";
const FRAME = "rgba(244,244,240,0.14)";
/** The SVG attributes that set text in the display face. */
const DISPLAY_TYPE = `font-family="${DISPLAY_FONT}" font-weight="${DISPLAY_WEIGHT}"`;

const PAD_X = 60;
const RIGHT = BANNER_WIDTH - PAD_X;
const TOP_LINE_Y = 82;
const RULE_Y = 96;
const RULE_HEIGHT = 4;
const HEADLINE_TOP = 128;
/** The headline keeps left of the avatars. */
const HEADLINE_MAX_WIDTH = 660;
const HEADLINE_SIZE = { one: 150, many: 128 };
const NAMES_BASELINE = 540;
const NAMES_SIZE = { one: 100, many: 72, min: 30 };
const NAME_GAP = 30;
/** A name longer than this is cut, so one long name can't shrink the others away. */
const NAME_CHARS_MAX = 16;
/** The avatars sit in this box, right of the headline. */
const AVATAR_BOX = { left: 740, top: 124, width: 380, height: 320 };
const RING = 6;
const STICKER_DIAMETER = 104;

// The mock's confetti: colour, x and y (fractions of the banner), turn, width, height. The
// pieces the mock had low on the right sit higher here, clear of the names.
const CONFETTI: readonly [string, number, number, number, number, number][] = [
  ["#ff0000", 0.08, 0.18, 28, 32, 11], ["#ffd400", 0.86, 0.26, -18, 23, 9],
  ["#8a4dff", 0.78, 0.7, 40, 37, 11], ["#f4f4f0", 0.92, 0.58, 12, 18, 7],
  ["#ffd400", 0.64, 0.14, 70, 28, 9], ["#ff0000", 0.7, 0.44, -35, 21, 9],
  ["#8a4dff", 0.6, 0.68, 15, 25, 9], ["#f4f4f0", 0.955, 0.42, -60, 30, 9],
  ["#ffd400", 0.955, 0.7, 50, 16, 16], ["#ff0000", 0.6, 0.6, 80, 14, 14],
];

/** The avatars drawn and how many members the "+N" sticker stands for. */
export function bannerFaces<T>(members: readonly T[]): { shown: T[]; more: number } {
  return {
    shown: members.slice(0, BANNER_AVATARS_MAX),
    more: Math.max(0, members.length - BANNER_AVATARS_MAX),
  };
}

/** "Lufia", "Kaiserkaze and Marle", "Kaiserkaze, Marle and tenpenny". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The banner's alt text, naming every member. */
export function bannerDescription(names: readonly string[]): string {
  return `Happy Birthday banner for ${joinNames(names)}`;
}

function cut(name: string): string {
  const chars = [...name.trim()];
  return chars.length > NAME_CHARS_MAX
    ? `${chars.slice(0, NAME_CHARS_MAX - 1).join("")}…`
    : chars.join("");
}

/**
 * How wide an SVG fragment draws, in pixels, with the fonts this machine has: it is drawn
 * alone and trimmed. Null when nothing drew (no font at all).
 */
async function drawnWidth(fragment: string, height: number): Promise<number | null> {
  const width = BANNER_WIDTH * 3;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `${fragment}</svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
    return info.width;
  } catch {
    return null;
  }
}

/** Measuring rounds before fitSize settles; each scales the size by how far it is over. */
const FIT_ROUNDS = 4;

/**
 * About the largest size, up to `max`, at which `draw(size)` fits `maxWidth`. Measured, since
 * the display font falls back to a wider one where Anton isn't installed, and in rounds,
 * since gaps between names don't scale with the size.
 */
async function fitSize(
  draw: (size: number) => string,
  max: number,
  maxWidth: number,
  min = 1,
): Promise<number> {
  let size = max;
  for (let round = 0; round < FIT_ROUNDS && size > min; round++) {
    const width = await drawnWidth(draw(size), max * 2);
    if (!width || width <= maxWidth) return size;
    size = Math.max(min, Math.min(size - 1, Math.floor((size * maxWidth) / width)));
  }
  return size;
}

function headline(size: number, x = 0, top = 0): string {
  const first = top + Math.round(size * 0.8);
  const second = first + Math.round(size * 0.9);
  return `<g ${DISPLAY_TYPE} font-size="${size}" ` +
    `fill="${PAPER}"><text x="${x}" y="${first}">HAPPY</text>` +
    `<text x="${x}" y="${second}">BIRTHDAY</text></g>`;
}

function namesLine(
  names: readonly string[],
  more: number,
  size: number,
  at: { x: number; y: number },
): string {
  const spans = names.map((name, i) =>
    `<tspan${i ? ` dx="${NAME_GAP}"` : ""}>${escapeXml(cut(name).toUpperCase())}</tspan>`)
    .join("");
  const moreSize = Math.max(18, Math.round(size * 0.36));
  const moreSpan = more
    ? `<tspan dx="${NAME_GAP}" font-family="${LABEL_FONT}" font-weight="700" ` +
      `font-size="${moreSize}" ` +
      `letter-spacing="2" fill="${PAPER_MUTE}">+${more} MORE</tspan>`
    : "";
  return `<text x="${at.x}" y="${at.y}" ${DISPLAY_TYPE} ` +
    `font-size="${size}" fill="${HIGHLIGHTER}">${spans}${moreSpan}</text>`;
}

function confetti(): string {
  return CONFETTI.map(([colour, x, y, turn, w, h]) => {
    const left = Math.round(x * BANNER_WIDTH);
    const top = Math.round(y * BANNER_HEIGHT);
    return `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="2" fill="${colour}" ` +
      `opacity="0.9" transform="rotate(${turn} ${left + w / 2} ${top + h / 2})"/>`;
  }).join("");
}

function topLine(dateLabel: string): string {
  return `<g font-family="${LABEL_FONT}" font-weight="700" font-size="26" ` +
    `letter-spacing="3"><text x="${PAD_X}" y="${TOP_LINE_Y}" fill="${PAPER}">THE RPG CLUB` +
    `</text><text x="${RIGHT}" y="${TOP_LINE_Y}" text-anchor="end" fill="${PAPER_DIM}">` +
    `${escapeXml(dateLabel.toUpperCase())}</text></g>` +
    `<rect x="${PAD_X}" y="${RULE_Y}" width="${RIGHT - PAD_X}" height="${RULE_HEIGHT}" ` +
    `fill="${PAPER}"/>`;
}

/** Where each avatar's circle goes: its centre and diameter, by how many are drawn. */
function avatarSpots(count: number): { cx: number; cy: number; d: number }[] {
  const { left, top, width, height } = AVATAR_BOX;
  const cx = left + width / 2;
  const cy = top + height / 2;
  if (count === 1) return [{ cx, cy, d: 290 }];
  if (count === 2) {
    return [{ cx: cx - 92, cy, d: 200 }, { cx: cx + 92, cy, d: 200 }];
  }
  // A 2 by 2 grid; three leave the bottom one centred.
  const d = 150;
  const step = d / 2 + 8;
  const grid = [
    { cx: cx - step, cy: cy - step, d }, { cx: cx + step, cy: cy - step, d },
    { cx: cx - step, cy: cy + step, d }, { cx: cx + step, cy: cy + step, d },
  ];
  return count === 3 ? [grid[0]!, grid[1]!, { cx, cy: cy + step, d }] : grid;
}

function initialCard(name: string, d: number): Buffer {
  const initial = escapeXml([...name.trim()][0]?.toUpperCase() ?? "?");
  return Buffer.from(
    `<svg width="${d}" height="${d}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${CARD}"/>` +
      `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
      `${DISPLAY_TYPE} font-size="${Math.round(d * 0.46)}" ` +
      `fill="${PAPER}">${initial}</text></svg>`,
  );
}

/** A member's avatar cut to a circle with a paper ring, sized `d` plus the ring. */
async function avatarDisc(member: IBannerMember, d: number): Promise<Buffer> {
  const disc = await coverTile(member.avatar, { width: d, height: d, corner: d / 2 },
    () => initialCard(member.name, d));
  const outer = d + RING * 2;
  const ring = Buffer.from(
    `<svg width="${outer}" height="${outer}" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="${outer / 2}" cy="${outer / 2}" r="${outer / 2 - RING / 2}" fill="none" ` +
      `stroke="${PAPER}" stroke-width="${RING}"/></svg>`,
  );
  return composeCanvas({ width: outer, height: outer }, CLEAR, [
    { input: disc, left: RING, top: RING },
    { input: ring, left: 0, top: 0 },
  ]);
}

/** The highlighter "+N" sticker, tilted, on the grid's bottom right corner. */
function sticker(more: number, spots: readonly { cx: number; cy: number; d: number }[]):
  string {
  const last = spots[spots.length - 1]!;
  const cx = last.cx + last.d / 2;
  const cy = last.cy + last.d / 2;
  const r = STICKER_DIAMETER / 2;
  const label = `+${more}`;
  const size = label.length > 3 ? 34 : 44;
  return `<g transform="rotate(-8 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="${r}" ` +
    `fill="${HIGHLIGHTER}" stroke="${BACKGROUND_HEX}" stroke-width="4"/>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
    `${DISPLAY_TYPE} font-size="${size}" ` +
    `fill="${STICKER_INK}">${label}</text></g>`;
}

function svgLayer(body: string): OverlayOptions {
  return {
    input: Buffer.from(
      `<svg width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" ` +
        `xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
    ),
    left: 0,
    top: 0,
  };
}

/** The banner as a PNG. Throws when there is nobody to greet. */
export async function composeBirthdayBanner(input: IBirthdayBannerInput): Promise<Buffer> {
  if (!input.members.length) throw new Error("A Birthday banner needs at least one member.");
  const { shown, more } = bannerFaces(input.members);
  const one = input.members.length === 1;
  const names = shown.map((m) => m.name);

  const headlineSize = await fitSize((size) => headline(size), one
    ? HEADLINE_SIZE.one
    : HEADLINE_SIZE.many, HEADLINE_MAX_WIDTH);
  const namesSize = await fitSize(
    (size) => namesLine(names, more, size, { x: 0, y: size }),
    one ? NAMES_SIZE.one : NAMES_SIZE.many,
    RIGHT - PAD_X,
    NAMES_SIZE.min,
  );

  const spots = avatarSpots(shown.length);
  const discs = await Promise.all(shown.map((m, i) => avatarDisc(m, spots[i]!.d)));
  const avatars: OverlayOptions[] = discs.map((disc, i) => ({
    input: disc,
    left: Math.round(spots[i]!.cx - spots[i]!.d / 2 - RING),
    top: Math.round(spots[i]!.cy - spots[i]!.d / 2 - RING),
  }));

  const base = `<rect x="16" y="16" width="${BANNER_WIDTH - 32}" ` +
    `height="${BANNER_HEIGHT - 32}" fill="none" stroke="${FRAME}" stroke-width="2"/>` +
    confetti() + topLine(input.dateLabel) + headline(headlineSize, PAD_X, HEADLINE_TOP) +
    namesLine(names, more, namesSize, { x: PAD_X, y: NAMES_BASELINE });

  return composeCanvas({ width: BANNER_WIDTH, height: BANNER_HEIGHT }, BACKGROUND, [
    svgLayer(base),
    ...avatars,
    ...(more ? [svgLayer(sticker(more, spots))] : []),
  ]);
}
