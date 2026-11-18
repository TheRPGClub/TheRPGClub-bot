// The fonts of the pictures the bot draws with sharp (the Birthday banner, the Challenge
// pictures): the club's print style. Anton and Barlow Condensed (OFL) ship in
// src/assets/fonts, and the Dockerfile registers them with fontconfig; DejaVu Sans
// (fonts-dejavu-core) is the fallback.

/** The display face: headlines, names and numbers. */
export const DISPLAY_FONT = "Anton, 'DejaVu Sans Condensed', 'DejaVu Sans', sans-serif";
/** Anton has a single weight; asking for bold would make fontconfig smear a fake one. */
export const DISPLAY_WEIGHT = 400;
/** The label face: small caps lines, tags and notes. Bundled in 400, 600, 700 and 800. */
export const LABEL_FONT = "'Barlow Condensed', 'DejaVu Sans Condensed', 'DejaVu Sans', " +
  "sans-serif";
