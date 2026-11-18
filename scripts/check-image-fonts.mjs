// Checks that the bot's Docker image draws text in the club's print fonts (Anton and Barlow
// Condensed, bundled in src/assets/fonts) rather than empty boxes. Run inside the built
// image, from /app so sharp resolves:
//   docker run --rm -i <image> node --input-type=module - < scripts/check-image-fonts.mjs
// A family fontconfig can't find falls back to DejaVu Sans, and with no font at all every
// family draws the same boxes; so each bundled face must draw a word at a different width
// than DejaVu Sans does at that weight.
import { Buffer } from "node:buffer";
import process from "node:process";
import sharp from "sharp";

const WORD = "HAPPY BIRTHDAY";

async function drawnWidth(family, weight) {
  const svg = `<svg width="2000" height="200" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="10" y="150" font-family="${family}" font-weight="${weight}" ` +
    `font-size="100">${WORD}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
  return info.width;
}

const faces = [["Anton", 400], ["Barlow Condensed", 600], ["Barlow Condensed", 700],
  ["Barlow Condensed", 800]];
let failed = false;
for (const [family, weight] of faces) {
  const width = await drawnWidth(family, weight);
  const fallback = await drawnWidth("DejaVu Sans", weight);
  const ok = width !== fallback;
  failed ||= !ok;
  const verdict = ok ? "ok  " : "FAIL";
  process.stdout.write(
    `${verdict} ${family} ${weight}: ${width}px (DejaVu Sans ${fallback}px)\n`,
  );
}
if (failed) {
  process.stderr.write(
    "The image does not draw the bundled fonts: check fontconfig in the Dockerfile.\n",
  );
  process.exit(1);
}
