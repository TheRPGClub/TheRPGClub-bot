/**
 * Turns a driven step's code block into the structured action the Playwright runner
 * (`scripts/conduct-playwright/`) performs in Discord web.
 *
 * The grammar is the one `.github/pull-request-testing-format.md` sets. Anything this
 * module cannot read exactly returns null, and the runner hands that step to the tester
 * rather than guessing.
 */

import { detectAction } from "./DrivePlan.js";

export interface ISlashOption {
  name: string;
  value: string;
}

export interface IModalField {
  kind: "enter" | "select";
  value: string;
  field: string;
}

export interface ISlashAction {
  kind: "slash";
  /** The command name, then its subcommand group and subcommand when it has them. */
  path: string[];
  options: ISlashOption[];
  /** The fields of the modal the command opens, or null when it opens none. */
  modal: IModalField[] | null;
}

export type DriveAction =
  | ISlashAction
  | { kind: "click"; button: string }
  | { kind: "select"; values: string[]; menu: string | null }
  | { kind: "modal"; button: string; fields: IModalField[] };

/** Discord option names: lowercase letters, digits, `-` and `_`, preceded by a space. */
const OPTION_START = /(?:^|\s)([\p{Ll}\p{N}_-]{1,32}):/gu;
const SLASH_PATH = /^[\p{Ll}\p{N}_-]{1,32}$/u;
const CLICK = /^(?:click|press)\s+"([^"]+)"$/i;
const FIELD = /^(enter|select)\s+"([^"]*)"\s+in\s+"([^"]+)"$/i;
const SELECT = /^(?:select|choose|pick)\s+(.+?)(?:\s+(?:from|in)\s+"([^"]+)")?$/i;
const QUOTED_LIST = /^"[^"]+"(?:\s*(?:,|and)\s*"[^"]+")*$/i;
const QUOTED_VALUE = /"([^"]+)"/g;

function straightQuotes(text: string): string {
  return text.replace(/[“”]/g, '"');
}

/** Splits on commas outside double quotes, trimming each clause. */
export function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      clauses.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  clauses.push(current.trim());
  return clauses.filter(Boolean);
}

/** Parses `enter "<v>" in "<f>", ..., submit`; null unless it ends in one `submit`. */
function parseModalFields(clauses: string[]): IModalField[] | null {
  if (clauses.at(-1)?.toLowerCase() !== "submit") return null;
  const fields: IModalField[] = [];
  for (const clause of clauses.slice(0, -1)) {
    const match = FIELD.exec(clause);
    if (!match) return null;
    const kind = match[1].toLowerCase() === "enter" ? "enter" : "select";
    fields.push({ kind, value: match[2], field: match[3] });
  }
  return fields;
}

/** Parses `/name sub opt:value opt2:value two`, keeping spaces inside option values. */
export function parseSlashLine(line: string): Omit<ISlashAction, "modal"> | null {
  const body = line.trim().replace(/^\//, "");
  const starts = [...body.matchAll(OPTION_START)];
  const pathEnd = starts[0]?.index ?? body.length;
  const path = body.slice(0, pathEnd).trim().split(/\s+/).filter(Boolean);
  if (!path.length || path.length > 3 || !path.every((part) => SLASH_PATH.test(part))) {
    return null;
  }
  const options: ISlashOption[] = starts.map((match, index) => {
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = starts[index + 1]?.index ?? body.length;
    return { name: match[1], value: body.slice(valueStart, valueEnd).trim() };
  });
  if (options.some((option) => !option.value)) return null;
  return { kind: "slash", path, options };
}

function parseSelect(line: string): DriveAction | null {
  const match = SELECT.exec(line);
  if (!match || !QUOTED_LIST.test(match[1].trim())) return null;
  const values = [...match[1].matchAll(QUOTED_VALUE)].map((value) => value[1]);
  return { kind: "select", values, menu: match[2] ?? null };
}

function parseClickOrModal(line: string): DriveAction | null {
  const [first, ...rest] = splitClauses(line);
  const click = CLICK.exec(first ?? "");
  if (!click) return null;
  if (!rest.length) return { kind: "click", button: click[1] };
  const fields = parseModalFields(rest);
  return fields ? { kind: "modal", button: click[1], fields } : null;
}

/** The structured action for a step's code block, or null when it is not exact. */
export function parseDriveAction(command: string): DriveAction | null {
  const text = straightQuotes(command);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  switch (detectAction(text)) {
    case "slash": {
      const slash = parseSlashLine(lines[0]);
      return slash ? { ...slash, modal: null } : null;
    }
    case "slash-modal": {
      const slash = parseSlashLine(lines[0]);
      const modal = parseModalFields(splitClauses(lines.slice(1).join(", ")));
      return slash && modal ? { ...slash, modal } : null;
    }
    case "click":
    case "modal":
      return parseClickOrModal(lines[0]);
    case "select":
      return parseSelect(lines[0]);
    default:
      return null;
  }
}
