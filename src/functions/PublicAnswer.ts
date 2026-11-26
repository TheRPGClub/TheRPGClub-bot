// A command that answers everyone publicly, but some of whose answers are only for the
// member who ran it (nothing found, a failed read). Answered at once, a private answer can
// simply be ephemeral; once deferred publicly, it has to replace the public placeholder.
// Used by /funfact (bot#1562) and /patch-notes (bot#1594). Nothing here outlives the
// command, so there is nothing to resume after a restart.

/**
 * The answer is sent at once when it is back this soon after the member ran the command,
 * leaving a second of Discord's 3 for a defer when it isn't.
 */
export const PUBLIC_ANSWER_BY_MS = 2000;
/** The longest a command waits on its answer before deferring, whatever the clocks say. */
export const PUBLIC_ANSWER_WAIT_MAX_MS = 1500;

/** An answer for everyone, or one only the member who ran the command sees. */
export type PublicOrPrivateAnswer = { public: object } | { private: object };

/** How the command answers its interaction (the command wires these to discord.js). */
export interface IPublicAnswerIo {
  /** Answers at once, before any defer: publicly, or a private reply. */
  reply(payload: object): Promise<void>;
  /** Defers publicly, which shows "is thinking…" in the channel. */
  deferPublicly(): Promise<void>;
  /** Fills the public deferred reply. */
  editReply(payload: object): Promise<void>;
  /** Deletes the public deferred reply and answers the member privately instead. */
  replaceWithPrivate(payload: object): Promise<void>;
  /** Resolves after `ms`. */
  wait(ms: number): Promise<void>;
}

/**
 * How long a command may wait on its answer before deferring: until `answerByMs` after the
 * member ran it (`ranAt`, Discord's time), and never over `maxWaitMs`, in case this clock
 * runs behind Discord's.
 */
export function publicAnswerWaitMs(
  ranAt: number,
  now: number,
  answerByMs = PUBLIC_ANSWER_BY_MS,
  maxWaitMs = PUBLIC_ANSWER_WAIT_MAX_MS,
): number {
  const left = answerByMs - (now - ranAt);
  return Math.min(maxWaitMs, Math.max(0, left));
}

/**
 * Answers with `answer`. One back within `waitMs` is sent at once, so a private answer is
 * only ever private. A slower one is deferred publicly (the public answer being the usual
 * one) before Discord's 3 seconds run out; if it then turns out private, the public
 * placeholder is swapped for a private reply.
 */
export async function answerPublicOrPrivate(
  answer: Promise<PublicOrPrivateAnswer>,
  io: IPublicAnswerIo,
  waitMs: number,
): Promise<void> {
  const quick = await Promise.race([answer, io.wait(waitMs).then(() => null)]);
  if (quick) {
    await io.reply("public" in quick ? quick.public : quick.private);
    return;
  }
  await io.deferPublicly();
  const late = await answer;
  if ("public" in late) {
    await io.editReply(late.public);
    return;
  }
  await io.replaceWithPrivate(late.private);
}
