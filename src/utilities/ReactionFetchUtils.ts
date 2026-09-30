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

// Every messageReactionAdd listener receives the same partial message when it is not cached,
// and MessageReaction.fetch() refetches that whole message. Sharing one fetch per reaction
// event keeps it to a single GET /channels/:id/messages/:id instead of up to four (#1292).
// The key includes the reacting user so a later event never reuses a snapshot taken before
// its own reaction existed, which would leave the cached reaction count one short.
const inFlightMessageFetches = new Map<string, Promise<Message | null>>();

function fetchMessageOnce(message: PartialMessage, eventKey: string): Promise<Message | null> {
  const pending = inFlightMessageFetches.get(eventKey);
  if (pending) return pending;

  const fetch = message
    .fetch()
    .catch(() => null)
    .finally(() => inFlightMessageFetches.delete(eventKey));
  inFlightMessageFetches.set(eventKey, fetch);
  return fetch;
}

/**
 * Resolves a reaction's message, fetching it at most once across the listeners of one event.
 * A partial reaction is read back from the fetched message rather than fetched again,
 * because MessageReaction.fetch() refetches the whole message.
 */
export async function resolveReactionMessage(
  reaction: MessageReaction | PartialMessageReaction,
  userId: string,
): Promise<ResolvedReaction | null> {
  const source = reaction.message;
  if (!source) return null;
  if (!source.partial) return { message: source, reaction };

  const emojiKey = reaction.emoji.id ?? reaction.emoji.name;
  const message = await fetchMessageOnce(source, `${source.id}:${userId}:${emojiKey}`);
  if (!message) return null;
  if (!reaction.partial) return { message, reaction };

  const refreshed = emojiKey ? message.reactions.cache.get(emojiKey) : undefined;
  return { message, reaction: refreshed ?? reaction };
}
