import type {
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
} from "discord.js";

export type ResolvedReaction = {
  message: Message;
  reaction: MessageReaction | PartialMessageReaction;
};

// Every messageReactionAdd listener receives the same partial message when it is not cached.
// Sharing one fetch per message keeps a burst of reactions on an old message to a single
// GET /channels/:id/messages/:id instead of one or two per listener per reaction (#1292).
const inFlightMessageFetches = new Map<string, Promise<Message | null>>();

function fetchMessageOnce(message: PartialMessage): Promise<Message | null> {
  const pending = inFlightMessageFetches.get(message.id);
  if (pending) return pending;

  const fetch = message
    .fetch()
    .catch(() => null)
    .finally(() => inFlightMessageFetches.delete(message.id));
  inFlightMessageFetches.set(message.id, fetch);
  return fetch;
}

/**
 * Resolves a reaction's message, fetching it at most once across concurrent callers.
 * A partial reaction is read back from the fetched message rather than fetched again,
 * because MessageReaction.fetch() refetches the whole message.
 */
export async function resolveReactionMessage(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<ResolvedReaction | null> {
  const source = reaction.message;
  if (!source) return null;
  if (!source.partial) return { message: source, reaction };

  const message = await fetchMessageOnce(source);
  if (!message) return null;
  if (!reaction.partial) return { message, reaction };

  const emojiKey = reaction.emoji.id ?? reaction.emoji.name;
  const refreshed = emojiKey ? message.reactions.cache.get(emojiKey) : undefined;
  return { message, reaction: refreshed ?? reaction };
}
