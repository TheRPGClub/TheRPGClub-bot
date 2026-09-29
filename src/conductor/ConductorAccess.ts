/**
 * Who may drive the conductor. Pure, so every rejection path is unit-tested
 * without a Discord client.
 */

export interface IConductorActor {
  userId: string;
  isBot: boolean;
  /** Set when a message came from a webhook rather than a user. */
  webhookId?: string | null;
  /** Null for a DM. */
  guildId: string | null;
}

export interface IConductorAccessContext {
  allowedUserId: string;
  selfId: string;
  testGuildId: string;
}

export type AccessDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * The single allowlisted human, acting in the test guild or in a DM. Every bot,
 * webhook, and the conductor itself is refused before the allowlist is consulted,
 * so a lookalike ID can never open a reply loop.
 */
export function checkConductorAccess(
  actor: IConductorActor,
  context: IConductorAccessContext,
): AccessDecision {
  if (actor.userId === context.selfId) return { allowed: false, reason: "self" };
  if (actor.isBot) return { allowed: false, reason: "bot" };
  if (actor.webhookId) return { allowed: false, reason: "webhook" };
  if (!context.allowedUserId || actor.userId !== context.allowedUserId) {
    return { allowed: false, reason: "not allowlisted" };
  }
  if (actor.guildId !== null && actor.guildId !== context.testGuildId) {
    return { allowed: false, reason: "outside the test guild" };
  }
  return { allowed: true };
}
