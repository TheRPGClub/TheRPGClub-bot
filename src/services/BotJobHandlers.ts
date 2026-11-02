import type { Client } from "discord.js";
import { requestVotingEventPoll } from "./VotingEventService.js";

/**
 * The narrow slice of Discord (and of the bot's own services) that job handlers may use,
 * so a handler can be tested with a fake instead of a live client. Add a method here
 * (and to createBotJobSurface) when a new handler needs one; never hand out the Client.
 */
export interface IBotJobSurface {
  /** Wakes the voting event poller so it claims now instead of at its next due time. */
  requestVotingEventPoll(): void;
}

export function createBotJobSurface(_client: Client): IBotJobSurface {
  return {
    requestVotingEventPoll,
  };
}

/**
 * Performs one job. Resolving acks it done; throwing acks it failed with the error, so
 * let API (axios) and discord.js errors escape as they are: the dispatcher formats them
 * with the full request and response.
 */
export type BotJobHandler = (
  payload: Record<string, unknown>,
  surface: IBotJobSurface,
) => Promise<void>;

export type BotJobHandlers = Readonly<Record<string, BotJobHandler>>;

/**
 * Payload: `{}` (nothing). Queued after a website change to a voting round so panels and
 * results go out now rather than when the voting poller next wakes (up to an hour).
 */
export const handleVotingPollWakeup: BotJobHandler = async (_payload, surface) => {
  surface.requestVotingEventPoll();
};

/** Job kind (BotJob::KINDS in the API) to handler. One line per kind. */
export const BOT_JOB_HANDLERS: BotJobHandlers = {
  voting_poll_wakeup: handleVotingPollWakeup,
};
