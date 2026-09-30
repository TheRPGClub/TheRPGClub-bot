/**
 * Structural parser for the `## Testing` section of a pull request body.
 *
 * The format is fixed by `.github/pull-request-testing-format.md`. The PR body is
 * attacker-controlled, so this module only ever turns it into data. Nothing it
 * returns is executed; commands are shown to a human, who runs them.
 *
 * The PR preview workflow imports this file directly under Node's type stripping
 * (`scripts/preview/plan.mjs`), so it keeps no imports and only erasable TypeScript.
 */

export interface ITestStep {
  /** 1-based position, taken from the `### Step N:` heading. */
  number: number;
  label: string;
  /** The fenced command, exactly as it should be typed into Discord. */
  command: string;
  expected: string;
  ephemeral: boolean;
}

/**
 * Where a quoted string must appear. `text` is anywhere in the output, `absent`
 * is nowhere in it, and the rest narrow the match to one part of the payload.
 */
export type ExpectationKind = "text" | "absent" | "title" | "button" | "option" | "field";

export interface IExpectation {
  kind: ExpectationKind;
  text: string;
}

export type TestPlanParseResult =
  | { kind: "ok"; steps: ITestStep[] }
  | { kind: "absent" }
  | { kind: "empty" }
  | { kind: "malformed"; reason: string };

/** Guardrails against a PR body that tries to flood the channel or the report. */
export const MAX_TEST_STEPS = 25;
export const MAX_COMMAND_LENGTH = 1500;
export const MAX_EXPECTED_LENGTH = 1500;

const SECTION_HEADING = /^##\s+Testing\s*$/;
const TOP_HEADING = /^#{1,2}\s/;
const STEP_HEADING = /^###\s+Step\s+(\d+):\s*(\S.*)$/;
const FENCE_OPEN = /^```[\w-]*\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const EXPECTED_LINE = /^Expected:\s*(.*)$/;
const EPHEMERAL_LINE = /^Ephemeral:\s*(.*?)\s*$/;
/** A quoted string, optionally scoped by a `keyword:` right before it. */
const QUOTED_TEXT = /(?:\b(not|title|button|option|field):\s*)?(?:"([^"\n]+)"|“([^”\n]+)”)/gi;
const SCOPE_KINDS: Record<string, ExpectationKind> = {
  not: "absent",
  title: "title",
  button: "button",
  option: "option",
  field: "field",
};

/**
 * Returns the lines of the `## Testing` section, HTML comments removed, or null
 * when there is none. Headings inside a fence or a comment neither start nor end
 * the section.
 */
export function extractTestingSection(body: string): string[] | null {
  const lines = stripHtmlComments(body.replace(/\r\n?/g, "\n")).split("\n");
  let start = -1;
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) inFence = !inFence;
    else if (!inFence && SECTION_HEADING.test(trimmed)) {
      start = index;
      break;
    }
  }
  if (start < 0) return null;

  const section: string[] = [];
  inFence = false;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) inFence = !inFence;
    if (!inFence && TOP_HEADING.test(trimmed)) break;
    section.push(line);
  }
  return section;
}

/** Drops HTML comments, which the PR template uses for its format reminder. */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

/**
 * The checks an `Expected:` line makes: every quoted string, scoped by a
 * `not:`, `title:`, `button:`, `option:`, or `field:` keyword right before it.
 */
export function extractExpectations(expected: string): IExpectation[] {
  const checks: IExpectation[] = [];
  for (const match of expected.matchAll(QUOTED_TEXT)) {
    const text = (match[2] ?? match[3] ?? "").trim();
    const kind = match[1] ? SCOPE_KINDS[match[1].toLowerCase()] : "text";
    const duplicate = checks.some((check) => check.kind === kind && check.text === text);
    if (text && !duplicate) checks.push({ kind, text });
  }
  return checks;
}

/**
 * Step numbers whose `Expected:` asks for no text to be present. The conductor
 * cannot verify those, so it asks the tester to confirm them by eye.
 */
export function findUncheckedSteps(steps: ITestStep[]): number[] {
  return steps
    .filter((step) => !extractExpectations(step.expected).some((c) => c.kind !== "absent"))
    .map((step) => step.number);
}

type Cursor = { lines: string[]; index: number };

function skipBlank(cursor: Cursor): void {
  while (cursor.index < cursor.lines.length && !cursor.lines[cursor.index].trim()) {
    cursor.index += 1;
  }
}

function peek(cursor: Cursor): string | undefined {
  return cursor.lines[cursor.index]?.trim();
}

class PlanError extends Error {}

function fail(reason: string): never {
  throw new PlanError(reason);
}

function readCommand(cursor: Cursor, stepNumber: number): string {
  skipBlank(cursor);
  if (!FENCE_OPEN.test(peek(cursor) ?? "")) {
    fail(`Step ${stepNumber} has no fenced code block after its heading.`);
  }
  cursor.index += 1;

  const commandLines: string[] = [];
  while (cursor.index < cursor.lines.length && !FENCE_CLOSE.test(peek(cursor) ?? "")) {
    commandLines.push(cursor.lines[cursor.index]);
    cursor.index += 1;
  }
  if (cursor.index >= cursor.lines.length) {
    fail(`Step ${stepNumber} has a code block that is never closed.`);
  }
  cursor.index += 1;

  const command = commandLines.join("\n").trim();
  if (!command) fail(`Step ${stepNumber} has an empty code block.`);
  if (command.includes("```")) fail(`Step ${stepNumber} nests a code fence in its command.`);
  if (command.length > MAX_COMMAND_LENGTH) {
    fail(`Step ${stepNumber} has a command longer than ${MAX_COMMAND_LENGTH} characters.`);
  }
  return command;
}

/**
 * Reads the `Expected:` line. The format doc's worked example wraps it, so
 * following non-blank prose lines up to `Ephemeral:` are joined onto it.
 */
function readExpected(cursor: Cursor, stepNumber: number): string {
  skipBlank(cursor);
  const match = EXPECTED_LINE.exec(peek(cursor) ?? "");
  if (!match) fail(`Step ${stepNumber} has no "Expected:" line after its code block.`);
  cursor.index += 1;

  const parts = [match[1].trim()];
  while (cursor.index < cursor.lines.length) {
    const line = peek(cursor) ?? "";
    if (!line || EPHEMERAL_LINE.test(line)) break;
    if (line.startsWith("#") || line.startsWith("```") || EXPECTED_LINE.test(line)) {
      fail(`Step ${stepNumber} has something other than prose between Expected and Ephemeral.`);
    }
    parts.push(line);
    cursor.index += 1;
  }

  const expected = parts.filter(Boolean).join(" ");
  if (!expected) fail(`Step ${stepNumber} has an empty "Expected:" line.`);
  if (expected.length > MAX_EXPECTED_LENGTH) {
    fail(`Step ${stepNumber} has an Expected line longer than ${MAX_EXPECTED_LENGTH} characters.`);
  }
  return expected;
}

function readEphemeral(cursor: Cursor, stepNumber: number): boolean {
  const match = EPHEMERAL_LINE.exec(peek(cursor) ?? "");
  if (!match) fail(`Step ${stepNumber} has no "Ephemeral:" line directly after Expected.`);
  cursor.index += 1;
  if (match[1] === "yes") return true;
  if (match[1] === "no") return false;
  fail(`Step ${stepNumber} has "Ephemeral: ${match[1]}"; only "yes" or "no" is accepted.`);
}

function readStep(cursor: Cursor, expectedNumber: number): ITestStep {
  const heading = STEP_HEADING.exec(peek(cursor) ?? "");
  if (!heading) {
    fail(`Expected "### Step ${expectedNumber}: <label>" but found "${peek(cursor)}".`);
  }
  const number = Number(heading[1]);
  if (number !== expectedNumber) {
    fail(`Steps must be numbered from 1 in order; found Step ${number} where ` +
      `Step ${expectedNumber} belongs.`);
  }
  cursor.index += 1;

  const command = readCommand(cursor, number);
  const expected = readExpected(cursor, number);
  const ephemeral = readEphemeral(cursor, number);

  skipBlank(cursor);
  const next = peek(cursor);
  if (next !== undefined && !STEP_HEADING.test(next)) {
    fail(`Step ${number} has extra content after its Ephemeral line: "${next}".`);
  }

  return {
    number,
    label: heading[2].trim(),
    command,
    expected,
    ephemeral,
  };
}

/**
 * Parses the `## Testing` section into an ordered script. Any deviation from the
 * fixed shape is reported as malformed; a partially guessed script is never
 * returned.
 */
export function parseTestPlan(body: string | null | undefined): TestPlanParseResult {
  const section = extractTestingSection(body ?? "");
  if (!section) return { kind: "absent" };

  const lines = section;
  const cursor: Cursor = { lines, index: 0 };
  skipBlank(cursor);
  if (cursor.index >= lines.length) return { kind: "empty" };

  const steps: ITestStep[] = [];
  try {
    while (cursor.index < lines.length) {
      if (steps.length >= MAX_TEST_STEPS) fail(`More than ${MAX_TEST_STEPS} steps.`);
      steps.push(readStep(cursor, steps.length + 1));
      skipBlank(cursor);
    }
  } catch (err: unknown) {
    if (err instanceof PlanError) return { kind: "malformed", reason: err.message };
    throw err;
  }
  return { kind: "ok", steps };
}
