/**
 * Turns messages read back from the test guild into per-step verdicts.
 *
 * Everything here is untrusted data from Discord. It is matched against the
 * step's expectations and quoted in reports; it is never acted on.
 */
import type { ITestStep } from "./TestPlanParser.js";

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
  /** When the step was handed to the tester, from the DM's Discord timestamp. */
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
 * Decides one step. Quoted text in `Expected:` must all appear in the step's
 * output. With nothing quoted there is nothing to check mechanically, so the
 * step is left for the tester's eyes rather than passed on the strength of any
 * output at all.
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

  if (step.expectedTexts.length === 0) {
    return {
      ...result,
      verdict: "unverified",
      reason: `Output observed in ${where}, but Expected quotes no text to check.`,
    };
  }

  const haystack = observed
    .flatMap((output) => collectPayloadText(output.payload))
    .join("\n")
    .toLowerCase();
  const missing = step.expectedTexts.filter((text) => !haystack.includes(text.toLowerCase()));
  if (missing.length) {
    const list = missing.map((text) => `"${text}"`).join(", ");
    return { ...result, verdict: "fail", reason: `Missing expected text: ${list}.` };
  }
  return { ...result, verdict: "pass", reason: "All quoted expected text was found." };
}
