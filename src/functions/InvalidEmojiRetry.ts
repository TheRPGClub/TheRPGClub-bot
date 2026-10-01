import { RESTJSONErrorCodes } from "discord.js";
import { logError } from "../utilities/LogUtils.js";

const INVALID_FORM_BODY_CODE = RESTJSONErrorCodes.InvalidFormBodyOrContentType;
const INVALID_EMOJI_ERROR_CODE = "COMPONENT_INVALID_EMOJI";

type ErrorTree = { _errors?: { code?: string }[]; [key: string]: unknown };
type InvalidEmojiHandler = (emojiIds: readonly string[]) => void;

let invalidEmojiHandler: InvalidEmojiHandler = () => {};

/**
 * Registers who hears about rejected emoji ids. UserEmojiService sets it at startup, so the
 * send helpers do not import the service (and its sharp and API dependencies) themselves.
 */
export function setInvalidEmojiHandler(handler: InvalidEmojiHandler): void {
  invalidEmojiHandler = handler;
}

function readApiError(err: unknown): { code?: number; errors?: ErrorTree } {
  const e = err as { code?: number; rawError?: { code?: number; errors?: ErrorTree } };
  return { code: e?.code ?? e?.rawError?.code, errors: e?.rawError?.errors };
}

/**
 * Collects the body paths Discord rejected with COMPONENT_INVALID_EMOJI, each ending at the
 * emoji object (the trailing `id` segment is dropped), e.g.
 * `["components", "0", "components", "0", "accessory", "emoji"]`.
 */
export function findInvalidEmojiPaths(err: unknown): string[][] {
  const { code, errors } = readApiError(err);
  if (code !== INVALID_FORM_BODY_CODE || !errors) return [];
  const paths: string[][] = [];
  const walk = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== "object") return;
    const tree = node as ErrorTree;
    if (tree._errors?.some((e) => e.code === INVALID_EMOJI_ERROR_CODE)) {
      paths.push(path.at(-1) === "id" ? path.slice(0, -1) : path);
    }
    for (const [key, child] of Object.entries(tree)) {
      if (key !== "_errors") walk(child, [...path, key]);
    }
  };
  walk(errors, []);
  return paths;
}

function toPlainComponents(components: unknown[]): unknown[] {
  return components.map((component) => {
    const json = (component as { toJSON?: () => unknown })?.toJSON?.() ?? component;
    return JSON.parse(JSON.stringify(json));
  });
}

function resolvePath(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function removeEmojis(node: unknown, emojiIds: ReadonlySet<string> | null): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) removeEmojis(child, emojiIds);
    return;
  }
  const record = node as Record<string, unknown>;
  const emoji = record.emoji as { id?: string | null } | undefined;
  if (emoji?.id && (!emojiIds || emojiIds.has(emoji.id))) delete record.emoji;
  for (const child of Object.values(record)) removeEmojis(child, emojiIds);
}

/**
 * Returns a copy of the payload with the rejected custom emojis removed from its components,
 * plus the ids Discord rejected. When a rejected path cannot be matched to an emoji in the
 * payload, every custom component emoji is removed so the retry cannot fail the same way.
 */
export function stripInvalidEmojis(
  options: unknown,
  err: unknown,
): { options: unknown; emojiIds: string[] } | null {
  const paths = findInvalidEmojiPaths(err);
  const components = (options as { components?: unknown[] } | null)?.components;
  if (!paths.length || !Array.isArray(components)) return null;

  const body = { components: toPlainComponents(components) };
  const emojiIds = paths
    .map((path) => (resolvePath(body, path) as { id?: string } | undefined)?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const allResolved = emojiIds.length === paths.length;
  removeEmojis(body.components, allResolved ? new Set(emojiIds) : null);

  return { options: { ...(options as object), components: body.components }, emojiIds };
}

/**
 * Sends the payload, and when Discord rejects a component emoji (a stale or deleted user
 * emoji, for example) reports the rejected ids and sends once more without them. The header
 * then renders without its emoji instead of the whole message failing with a 400.
 */
export async function sendWithInvalidEmojiRetry<T>(
  options: unknown,
  send: (options: any) => Promise<T>,
  onInvalid: InvalidEmojiHandler = invalidEmojiHandler,
): Promise<T> {
  try {
    return await send(options);
  } catch (err: unknown) {
    const stripped = stripInvalidEmojis(options, err);
    if (!stripped) throw err;
    logError("InvalidEmojiRetry", {
      message: "Discord rejected a component emoji; retrying without it",
      emojiIds: stripped.emojiIds,
    });
    try {
      onInvalid(stripped.emojiIds);
    } catch (handlerErr: unknown) {
      logError("InvalidEmojiRetry.onInvalid", handlerErr);
    }
    return send(stripped.options);
  }
}
