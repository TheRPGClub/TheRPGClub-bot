// Decides whether a push to main changes what the conductor runs. Loaded by an
// actions/github-script step in .github/workflows/conductor-deploy.yml, and by tsx in
// the unit tests. Imports only Node built-ins, so the runner needs no install.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export const CONDUCTOR_ENTRY = "src/conductor/main.ts";

/** Files outside the import graph that change what the conductor process runs. */
export const CONDUCTOR_RUNTIME_FILES = ["package.json", "package-lock.json", "tsconfig.json"];

// Static `import`/`export ... from` specifiers, side-effect imports, and `import("...")`.
const SPECIFIER_PATTERN = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

/**
 * The repo-relative file a relative specifier loads, or null when none exists. Source
 * imports name `.js` for a `.ts` file, per Node16 module resolution.
 *
 * @param {string} root
 * @param {string} fromFile repo-relative path of the importing file
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveSpecifier(root, fromFile, specifier) {
  const base = normalize(join(dirname(fromFile), specifier));
  const candidates = [base, `${base}.ts`, join(base, "index.ts")];
  if (base.endsWith(".js")) candidates.unshift(`${base.slice(0, -3)}.ts`);
  if (base.endsWith(".mjs")) candidates.unshift(`${base.slice(0, -4)}.mts`);
  const found = candidates.find(
    (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false,
  );
  return found ?? null;
}

/**
 * Every repo-relative source file the conductor loads, following relative imports from
 * its entry point. Package imports are covered by the lockfile instead.
 *
 * @param {string} root the repository root
 * @returns {Set<string>}
 */
export function conductorSources(root) {
  const seen = new Set();
  const queue = [CONDUCTOR_ENTRY];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveSpecifier(root, file, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/**
 * The changed files that affect the conductor, so a deploy can say why it ran.
 *
 * @param {{ changed: string[], sources: Set<string> }} args
 * @returns {string[]}
 */
export function conductorChanges({ changed, sources }) {
  return changed.filter(
    (path) => sources.has(path) || CONDUCTOR_RUNTIME_FILES.includes(path),
  );
}
