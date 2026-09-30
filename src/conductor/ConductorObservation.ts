/**
 * Turns messages read back from the test guild into per-step verdicts.
 *
 * Everything here is untrusted data from Discord. It is matched against the
 * step's expectations and quoted in reports; it is never acted on.
 */
import {
  extractExpectations,
  type ExpectationKind,
  type IExpectation,
  type ITestStep,
} from "./TestPlanParser.js";

/** A plain copy of a Discord message, so attribution runs without a client. */
export interface IMessageSnapshot {
  id: string;
  channelId: string;
  authorId: string;
  authorIsBot: boolean;
  webhookId: string | null;
  createdTimestamp: number;
  editedTimestamp: number | null;
  content: string;
  /** The user who ran the interaction this message answers, when it answers one. */
  interactionUserId: string | null;
  embeds: unknown[];
  components: unknown[];
}

export interface IObservationContext {
  selfId: string;
  allowedUserId: string;
  testChannelId: string;
  mirrorChannelId: string;
}

export type ObservationPlace = "channel" | "mirror";

export interface IObservedOutput {
  place: ObservationPlace;
  messageId: string;
  /** Latest of the message's create and edit times. */
  at: number;
  createdAt: number;
  /** The mirror's `source`, such as `/collection` or `component:<id>`. */
  source: string | null;
  payload: unknown;
}

export type StepVerdict = "pass" | "fail" | "unverified";

export interface IStepResult {
  stepNumber: number;
  verdict: StepVerdict;
  reason: string;
  observed: IObservedOutput[];
  /** Output in the window that did not belong to this step, shown on failure. */
  unattributed: IObservedOutput[];
}

export interface IStepWindow {
  /** When the step was handed to the tester, from the step message's Discord timestamp. */
  start: number;
  /** When the tester asked for the check, from the interaction's timestamp. */
  end: number;
}

const MIRROR_BLOCK = /^```json\n([\s\S]*)\n```$/;
const MIRROR_USER = /"user":\s*"(\d+)"/;
const MIRROR_SOURCE = /"source":\s*"([^"]*)"/;
const TEXT_KEYS = new Set([
  "content", "title", "description", "name", "value", "label", "placeholder", "text",
  "custom_id", "customId",
]);

type MirrorRecord = { user: string | null; source: string | null; payload: unknown };

/**
 * Reads a mirror post written by `formatMirrorMessage`. A post truncated at
 * Discord's length cap is not valid JSON, so its user and source are recovered
 * by pattern and the raw text is kept as the payload.
 */
export function parseMirrorMessage(content: string): MirrorRecord | null {
  const match = MIRROR_BLOCK.exec(content.trim());
  if (!match) return null;
  const body = match[1];
  try {
    const parsed = JSON.parse(body) as { user?: unknown; source?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    return {
      user: typeof parsed.user === "string" ? parsed.user : null,
      source: typeof parsed.source === "string" ? parsed.source : null,
      payload: parsed,
    };
  } catch {
    const user = MIRROR_USER.exec(body)?.[1] ?? null;
    if (!user) return null;
    return { user, source: MIRROR_SOURCE.exec(body)?.[1] ?? null, payload: body };
  }
}

function latestTime(snapshot: IMessageSnapshot): number {
  return Math.max(snapshot.createdTimestamp, snapshot.editedTimestamp ?? 0);
}

/**
 * Keeps output from the bot under test that answers the allowlisted user. The
 * conductor's own posts, webhooks, human messages, and replies to anyone else
 * are dropped.
 */
export function classifySnapshot(
  snapshot: IMessageSnapshot,
  context: IObservationContext,
): IObservedOutput | null {
  if (snapshot.authorId === context.selfId) return null;
  if (!snapshot.authorIsBot || snapshot.webhookId) return null;

  const base = {
    messageId: snapshot.id,
    at: latestTime(snapshot),
    createdAt: snapshot.createdTimestamp,
  };

  if (snapshot.channelId === context.mirrorChannelId) {
    const mirror = parseMirrorMessage(snapshot.content);
    if (mirror) {
      if (mirror.user !== context.allowedUserId) return null;
      return { ...base, place: "mirror", source: mirror.source, payload: mirror.payload };
    }
  }

  if (snapshot.channelId !== context.testChannelId) return null;
  if (snapshot.interactionUserId && snapshot.interactionUserId !== context.allowedUserId) {
    return null;
  }
  return {
    ...base,
    place: "channel",
    source: null,
    payload: {
      content: snapshot.content || undefined,
      embeds: snapshot.embeds.length ? snapshot.embeds : undefined,
      components: snapshot.components.length ? snapshot.components : undefined,
    },
  };
}

function inWindow(output: IObservedOutput, window: IStepWindow): boolean {
  const touched = (time: number): boolean => time > window.start && time <= window.end;
  return touched(output.createdAt) || touched(output.at);
}

/** `/collection add` becomes `/collection`, which is what the mirror records. */
export function slashSourceFor(command: string): string | null {
  const match = /^\/([\w-]+)/.exec(command.trim());
  return match ? `/${match[1]}` : null;
}

/**
 * Splits the window's output into what this step produced and what it did not.
 * A step's output must land where its `Ephemeral:` line says, and a mirrored slash
 * command reply must come from the command the step names, so a late reply from an
 * earlier step is not credited to this one.
 */
export function attributeStepOutput(
  step: ITestStep,
  outputs: IObservedOutput[],
  window: IStepWindow,
): { observed: IObservedOutput[]; unattributed: IObservedOutput[] } {
  // Ephemeral replies only come back through the mirror; test mode turns off the
  // dev channel override that would post them publicly. Output in the wrong place
  // is a failure either way.
  const places: ObservationPlace[] = step.ephemeral ? ["mirror"] : ["channel"];
  const slashSource = slashSourceFor(step.command);
  const observed: IObservedOutput[] = [];
  const unattributed: IObservedOutput[] = [];

  for (const output of outputs.filter((entry) => inWindow(entry, window))) {
    const rightPlace = places.includes(output.place);
    // A click step never owns a slash command's reply, which would be a late
    // answer to an earlier step.
    const rightSource = output.place !== "mirror" || (slashSource
      ? output.source === slashSource
      : !output.source?.startsWith("/"));
    if (rightPlace && rightSource) observed.push(output);
    else unattributed.push(output);
  }

  const byTime = (a: IObservedOutput, b: IObservedOutput): number => a.at - b.at;
  return { observed: observed.sort(byTime), unattributed: unattributed.sort(byTime) };
}

/** Every human-readable string in a payload: content, embed text, labels, options. */
export function collectPayloadText(payload: unknown, into: string[] = []): string[] {
  if (typeof payload === "string") {
    into.push(payload);
    return into;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) collectPayloadText(entry, into);
    return into;
  }
  if (!payload || typeof payload !== "object") return into;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === "string") {
      if (TEXT_KEYS.has(key)) into.push(value);
    } else {
      collectPayloadText(value, into);
    }
  }
  return into;
}

/**
 * Where a string sits in a payload, for the scoped `Expected:` checks. `raw` is a
 * mirror post cut at Discord's length cap: text, not JSON, so any scope may match it.
 */
type TextScope = Exclude<ExpectationKind, "text" | "absent"> | "other" | "raw";

export interface IScopedText {
  scope: TextScope;
  text: string;
}

const BUTTON_TYPE = 2;
const HEADING_LINE = /^#{1,3}\s+(.+)$/;

function headingsIn(content: string): string[] {
  return content.split("\n").flatMap((line) => {
    const match = HEADING_LINE.exec(line.trim());
    return match ? [match[1].trim()] : [];
  });
}

/**
 * Every human-readable string in a payload, tagged with where it sits: embed
 * titles and markdown headings are titles, button labels are buttons, select
 * option labels are options, and embed field names and values are fields.
 */
export function collectScopedText(
  payload: unknown,
  into: IScopedText[] = [],
  parentKey = "",
): IScopedText[] {
  if (typeof payload === "string") {
    into.push({ scope: "other", text: payload });
    return into;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) collectScopedText(entry, into, parentKey);
    return into;
  }
  if (!payload || typeof payload !== "object") return into;
  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") {
      collectScopedText(value, into, key);
      continue;
    }
    if (!TEXT_KEYS.has(key)) continue;
    into.push({ scope: scopeFor(record, key, parentKey), text: value });
    if (key === "content") {
      for (const heading of headingsIn(value)) into.push({ scope: "title", text: heading });
    }
  }
  return into;
}

function scopeFor(record: Record<string, unknown>, key: string, parentKey: string): TextScope {
  if (key === "title") return "title";
  if (key === "label" && record.type === BUTTON_TYPE) return "button";
  if (key === "label" && parentKey === "options") return "option";
  if ((key === "name" || key === "value") && parentKey === "fields") return "field";
  return "other";
}

function describeCheck(check: IExpectation): string {
  return check.kind === "text" ? `"${check.text}"` : `${check.kind} "${check.text}"`;
}

/**
 * Whether the output satisfies one check. A raw post's JSON keys and metadata would
 * trip a `not:` check, so absent text is only looked for in parsed payloads.
 */
function checkHolds(check: IExpectation, texts: IScopedText[]): boolean {
  const needle = check.text.toLowerCase();
  const inScope = (entry: IScopedText): boolean => {
    if (check.kind === "absent") return entry.scope !== "raw";
    return check.kind === "text" || entry.scope === check.kind || entry.scope === "raw";
  };
  const found = texts.some((entry) =>
    inScope(entry) && entry.text.toLowerCase().includes(needle));
  return check.kind === "absent" ? !found : found;
}

/**
 * Decides one step. Every check in `Expected:` must hold on the step's output.
 * A step whose checks only rule text out cannot show the right output arrived,
 * so it is left for the tester's eyes rather than passed on any output at all.
 */
export function judgeStep(
  step: ITestStep,
  outputs: IObservedOutput[],
  window: IStepWindow,
): IStepResult {
  const { observed, unattributed } = attributeStepOutput(step, outputs, window);
  const result = { stepNumber: step.number, observed, unattributed };
  const where = step.ephemeral ? "the ephemeral mirror channel" : "the test channel";

  if (observed.length === 0) {
    const elsewhere = unattributed.length
      ? ` ${unattributed.length} other message(s) arrived in the window but did not match.`
      : "";
    // A preview built from a branch older than the test mode override switch still
    // posts the owner's ephemeral replies publicly.
    const publicReply = step.ephemeral && unattributed.some((entry) => entry.place === "channel")
      ? " A public reply arrived instead: it was not ephemeral, or this PR's branch predates" +
        " the test mode dev channel fix and needs main merged in."
      : "";
    return {
      ...result,
      verdict: "fail",
      reason: `No output observed in ${where}.${elsewhere}${publicReply}`,
    };
  }

  const texts = observed.flatMap((output): IScopedText[] => typeof output.payload === "string"
    ? [{ scope: "raw", text: output.payload }]
    : collectScopedText(output.payload));
  const checks = extractExpectations(step.expected);
  const failed = checks.filter((check) => !checkHolds(check, texts));
  const present = failed.filter((check) => check.kind !== "absent");
  const absent = failed.filter((check) => check.kind === "absent");
  if (failed.length) {
    const reasons = [
      present.length ? `Missing expected ${present.map(describeCheck).join(", ")}.` : "",
      absent.length ? `Found text that should be absent: ` +
        `${absent.map((check) => `"${check.text}"`).join(", ")}.` : "",
    ];
    return { ...result, verdict: "fail", reason: reasons.filter(Boolean).join(" ") };
  }

  if (!checks.some((check) => check.kind !== "absent")) {
    return {
      ...result,
      verdict: "unverified",
      reason: `Output observed in ${where}, but Expected quotes no text to look for.`,
    };
  }
  return { ...result, verdict: "pass", reason: "Every expected check held." };
}

/** "Looks right": the tester vouches for output the conductor had nothing to check in. */
export function confirmedResult(pending: IStepResult): IStepResult {
  return {
    ...pending,
    verdict: "pass",
    reason: `The tester confirmed the output matches Expected. ${pending.reason}`,
  };
}

/** The pending check, recorded as failed: a failure stands, unchecked output does not match. */
export function failedResult(pending: IStepResult): IStepResult {
  if (pending.verdict === "fail") return pending;
  return {
    ...pending,
    verdict: "fail",
    reason: `The tester says the output does not match Expected. ${pending.reason}`,
  };
}
