// /codex lore read's paging (spec api#397, bot#1563, design 3D): a Lore Entry's Discord
// text is split at its headings into pages, so nothing is ever cut off. A section too long
// for one page is split at its last whole sentence that fits and continues on the next
// page, never inside a `||spoiler||`.

/** A heading line as the website writes it in `body` (Plate h1 to h3). */
const HEADING = /^#{1,3} \S/;

/**
 * Where a sentence ends: its terminator and any closing quotes, brackets or emphasis,
 * followed by white space. A spoiler's closing `||` isn't among them, so a sentence that
 * ends a spoiler is cut after the spoiler only when a space follows the `||`.
 */
const SENTENCE_END = /[.!?…]["'”’)\]*_~]*(?=\s)/g;
const SPOILER = "||";
const QUOTE_MARKER = "> ";

function spoilersBefore(text: string, index: number): number {
  return text.slice(0, index).split(SPOILER).length - 1;
}

function outsideSpoiler(text: string, index: number): boolean {
  return spoilersBefore(text, index) % 2 === 0;
}

/** The last candidate cut past `min` and at most `max` that is outside every spoiler. */
function lastCut(
  text: string,
  bounds: { min: number; max: number },
  candidates: Iterable<number>,
): number | null {
  let best: number | null = null;
  for (const cut of candidates) {
    if (cut > bounds.min && cut <= bounds.max && outsideSpoiler(text, cut)) best = cut;
  }
  return best;
}

function* sentenceCuts(text: string): Generator<number> {
  const cuts: number[] = [];
  for (const match of text.matchAll(SENTENCE_END)) cuts.push(match.index + match[0].length);
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) cuts.push(i);
  yield* cuts.sort((a, b) => a - b);
}

function* spaceCuts(text: string): Generator<number> {
  for (const match of text.matchAll(/\s/g)) yield match.index;
}

/** The rest after a cut: a cut inside a quoted line keeps the quote going. */
function restAfter(text: string, cut: number): string {
  const rest = text.slice(cut).replace(/^\s+/, "");
  if (!rest || text[cut] === "\n") return rest;
  const lineStart = text.lastIndexOf("\n", cut - 1) + 1;
  const quoted = text.startsWith(QUOTE_MARKER, lineStart) && !rest.startsWith(">");
  return quoted ? `${QUOTE_MARKER}${rest}` : rest;
}

/**
 * Splits `text` into a head of at most `max` characters and the rest. The head ends at
 * the last whole sentence (or line) that fits, outside every spoiler; failing that, at
 * the last space; failing that, it is cut hard, closing an open spoiler and reopening it
 * in the rest. Text that fits is returned whole with an empty rest. A cut never leaves a
 * head of `min` characters or fewer (a heading on its own), unless it must cut hard.
 */
export function cutAtSentence(text: string, max: number, min = 0): [string, string] {
  if (text.length <= max) return [text, ""];
  const bounds = { min, max };
  const cut = lastCut(text, bounds, sentenceCuts(text))
    ?? lastCut(text, bounds, spaceCuts(text));
  if (cut !== null) return [text.slice(0, cut).trimEnd(), restAfter(text, cut)];

  const hard = Math.max(1, max - SPOILER.length);
  const head = text.slice(0, hard);
  const rest = text.slice(hard);
  return outsideSpoiler(text, hard)
    ? [text.slice(0, max), text.slice(max)]
    : [`${head}${SPOILER}`, `${SPOILER}${rest}`];
}

/** The story's sections: the opening text, then one per heading, each trimmed. */
function sections(body: string): string[] {
  const found: string[][] = [[]];
  for (const line of body.split("\n")) {
    if (HEADING.test(line)) found.push([]);
    found[found.length - 1].push(line);
  }
  return found.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

/** One section's pages: whole when it fits, else cut at sentences under its heading. */
function sectionPages(section: string, max: number): string[] {
  if (section.length <= max) return [section];
  const firstLine = section.split("\n", 1)[0];
  const continued = HEADING.test(firstLine) ? `${firstLine} (continued)\n` : "";
  // A heading as long as the page itself would leave no room: continue without it.
  const prefix = continued.length * 2 <= max ? continued : "";
  const pages: string[] = [];
  let [head, rest] = cutAtSentence(section, max, continued ? firstLine.length : 0);
  pages.push(head);
  while (rest) {
    [head, rest] = cutAtSentence(rest, max - prefix.length);
    pages.push(`${prefix}${head}`);
  }
  return pages;
}

/**
 * The pages of a Lore Entry's Discord text, each at most `max` characters: the opening
 * text, then each heading's section, an over-long section continuing on further pages.
 * An empty story is one empty page.
 */
export function splitLorePages(body: string | null, max: number): string[] {
  const pages = sections(body ?? "").flatMap((section) => sectionPages(section, max));
  return pages.length ? pages : [""];
}
