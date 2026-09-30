import { randomBytes } from "node:crypto";
import type { CommandInteraction } from "discord.js";
import {
  listNominationsForRound,
  NOMINATION_KINDS,
  nominationKindLabel,
  type NominationKind,
} from "../../classes/Nomination.js";
import type { VotingEventKind } from "../../classes/VotingEvents.js";
import { IS_TEST_MODE, TEST_GUILD_ID } from "../../config/testMode.js";
import { buildErrorReply, buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { toUnixTimestamp } from "../../functions/DateFormatUtils.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import {
  mergeTallyWithNominations,
  sumTallyVotes,
} from "../../functions/VoteResultsUtils.js";
import { buildApiErrorMessage, UserFacingError } from "../../utilities/ApiErrorUtils.js";
import {
  deliverSandboxOutbox,
  endSandbox,
  loadSandbox,
  mutateSandbox,
  NO_SANDBOX_MESSAGE,
  startSandbox,
} from "../../services/VotingSandbox.js";
import {
  closeSandboxVoting,
  createSandboxState,
  isSimulatedVoter,
  openSandboxVoting,
  queueSandboxEvent,
  remindSandboxNominations,
  sandboxTally,
  sandboxWinnerTitles,
  seedSandboxOutcome,
  toNominationEntries,
  toVotingRoundCategory,
  type ISandboxNominationSeed,
  type IVotingSandboxState,
  type SandboxOutcome,
} from "../../services/VotingSandboxModel.js";

export const TEST_MODE_ONLY_MESSAGE =
  "The voting sandbox only runs in test mode (TEST_GUILD_ID set), so it never " +
  "posts in the production guild.";

export interface IStartSandboxOptions {
  roundNumber?: number;
  cap?: number;
  gotmNominations?: number;
  nrGotmNominations?: number;
  sourceRound?: number;
}

/**
 * The guilds /vote-sandbox registers in: the test guild in test mode, and none
 * at all otherwise. An empty list here keeps it out of the global commands too,
 * because discordx only registers globally a command that names no guild source.
 */
export function resolveSandboxGuilds(
  testMode: boolean = IS_TEST_MODE,
  guildId: string = TEST_GUILD_ID,
): string[] {
  return testMode && guildId ? [guildId] : [];
}

/** Refuses outside test mode; the command is not registered there either. */
export async function refuseOutsideTestMode(interaction: CommandInteraction): Promise<boolean> {
  if (IS_TEST_MODE) return false;
  await safeReply(interaction, buildTextReply(TEST_MODE_ONLY_MESSAGE, true));
  return true;
}

function kindHeading(kind: NominationKind): string {
  return `**${nominationKindLabel(kind)}**`;
}

/** Everything about the sandbox an admin needs to check a step, tallies included. */
export function buildSandboxStatusText(state: IVotingSandboxState): string {
  const lines = [
    `## 🧪 Voting sandbox \`${state.id}\``,
    `Round ${state.roundNumber} (${state.monthYear}), phase **${state.phase}**, ` +
      `vote cap ${state.cap}.`,
    `Voting opens <t:${toUnixTimestamp(new Date(state.votingOpensAt))}:F> and closes ` +
      `<t:${toUnixTimestamp(new Date(state.votingClosesAt))}:F>.`,
  ];
  for (const kind of NOMINATION_KINDS) {
    const rows = mergeTallyWithNominations(
      sandboxTally(state, kind).rows,
      toNominationEntries(state, kind),
    );
    const votes = state.votes.filter((vote) => vote.kind === kind);
    const simulated = votes.filter((vote) => isSimulatedVoter(vote.userId)).length;
    lines.push(
      `${kindHeading(kind)}: ${rows.length} votable game(s), ` +
        `${sumTallyVotes(sandboxTally(state, kind).rows)} vote(s) ` +
        `(${simulated} simulated, ${votes.length - simulated} from members).`,
    );
    for (const row of rows.slice(0, 10)) {
      lines.push(`- ${row.gameTitle}: ${row.voteCount}`);
    }
    if (rows.length > 10) lines.push(`- ...and ${rows.length - 10} more`);
    const tie = state.pendingTies[toVotingRoundCategory(kind)];
    if (tie?.length) {
      lines.push(`- Tie pending: ${tie.map((game) => game.title).join(", ")}`);
    }
    const winners = sandboxWinnerTitles(state, kind);
    if (winners.length) lines.push(`- Winner(s): ${winners.join(", ")}`);
  }
  const queued = state.outbox.map((event) => `\`${event.kind}\``).join(", ");
  lines.push(`Queued events: ${queued || "none"}.`);
  return lines.join("\n");
}

async function loadSourceSeeds(
  roundNumber: number,
): Promise<Partial<Record<NominationKind, ISandboxNominationSeed[]>>> {
  const seeds: Partial<Record<NominationKind, ISandboxNominationSeed[]>> = {};
  for (const kind of NOMINATION_KINDS) {
    const nominations = await listNominationsForRound(kind, roundNumber);
    seeds[kind] = nominations.map((nomination) => ({
      gameId: nomination.gamedbGameId,
      title: nomination.gameTitle,
      userId: nomination.userId,
      reason: nomination.reason,
    }));
  }
  return seeds;
}

async function replyWithDelivery(
  interaction: CommandInteraction,
  heading: string,
): Promise<void> {
  const ownerId = interaction.user.id;
  const delivery = await deliverSandboxOutbox(interaction.client, ownerId);
  const state = await loadSandbox(ownerId);
  const sections = [heading];
  if (delivery.length) sections.push(`**Delivered**\n${delivery.join("\n")}`);
  if (state) sections.push(buildSandboxStatusText(state));
  await safeReply(interaction, buildTextReply(sections.join("\n\n"), true));
}

/**
 * Runs a sandbox step and replies with what it delivered. A refused step (a
 * phase that does not allow it, a failed API read) is shown with its reason.
 */
async function runStep(
  interaction: CommandInteraction,
  label: string,
  step: () => Promise<string>,
): Promise<void> {
  let heading: string;
  try {
    heading = await step();
  } catch (err) {
    await safeReply(interaction, buildErrorReply(buildApiErrorMessage(label, err), true));
    return;
  }
  await replyWithDelivery(interaction, heading);
}

export async function handleSandboxStart(
  interaction: CommandInteraction,
  options: IStartSandboxOptions,
): Promise<void> {
  await runStep(interaction, "Could not start the voting sandbox", async () => {
    const seeds = options.sourceRound ? await loadSourceSeeds(options.sourceRound) : undefined;
    const state = createSandboxState({
      id: randomBytes(4).toString("hex"),
      ownerId: interaction.user.id,
      roundNumber: options.roundNumber,
      cap: options.cap,
      now: new Date(),
      seeds,
      nominationCounts: {
        "gotm": options.gotmNominations,
        "nr-gotm": options.nrGotmNominations,
      },
    });
    await startSandbox(state);
    const source = options.sourceRound
      ? `Nominations copied (read only) from Round ${options.sourceRound}; a category it ` +
        "had none for gets fixture games."
      : "Nominations are fixture games.";
    return `🧪 Started sandbox \`${state.id}\`. Any earlier sandbox of yours was replaced, ` +
      `and its panels now refuse votes. ${source}`;
  });
}

export async function handleSandboxStatus(interaction: CommandInteraction): Promise<void> {
  const state = await loadSandbox(interaction.user.id);
  await safeReply(
    interaction,
    buildTextReply(
      state ? buildSandboxStatusText(state) : NO_SANDBOX_MESSAGE,
      true,
    ),
  );
}

export async function handleSandboxRemind(
  interaction: CommandInteraction,
  which: "5d" | "1d",
): Promise<void> {
  await runStep(interaction, "Could not queue the reminder", async () => {
    await mutateSandbox(interaction.user.id, (state) =>
      remindSandboxNominations(state, which, new Date()),
    );
    return `Queued the ${which === "5d" ? "five" : "one"}-day nomination reminder.`;
  });
}

export async function handleSandboxOpen(interaction: CommandInteraction): Promise<void> {
  await runStep(interaction, "Could not open sandbox voting", async () => {
    await mutateSandbox(interaction.user.id, (state) => openSandboxVoting(state, new Date()));
    return "Opened voting. The panels post in the announcements channel.";
  });
}

export async function handleSandboxSeed(
  interaction: CommandInteraction,
  outcomes: Partial<Record<NominationKind, SandboxOutcome>>,
): Promise<void> {
  const kinds = NOMINATION_KINDS.filter((kind) => outcomes[kind]);
  if (!kinds.length) {
    await safeReply(
      interaction,
      buildTextReply("Pick an outcome for gotm, nr-gotm, or both.", true),
    );
    return;
  }
  await runStep(interaction, "Could not seed the sandbox votes", async () => {
    await mutateSandbox(interaction.user.id, (state) => {
      if (state.phase !== "voting") {
        throw new UserFacingError(
          `Seeding needs open voting; sandbox Round ${state.roundNumber} is ${state.phase}.`,
        );
      }
      const now = new Date();
      for (const kind of kinds) {
        const outcome = outcomes[kind];
        if (outcome) seedSandboxOutcome(state, kind, outcome, now);
      }
    });
    const seeded = kinds.map((kind) => `${nominationKindLabel(kind)}: ${outcomes[kind]}`);
    return `Seeded simulated votes (${seeded.join(", ")}). Earlier simulated votes in those ` +
      "categories were replaced; members' votes were kept.";
  });
}

export async function handleSandboxClose(interaction: CommandInteraction): Promise<void> {
  await runStep(interaction, "Could not close sandbox voting", async () => {
    await mutateSandbox(interaction.user.id, (state) => closeSandboxVoting(state, new Date()));
    return "Closed voting. Results post in announcements, and a tie prompts the admin channel.";
  });
}

export async function handleSandboxEvent(
  interaction: CommandInteraction,
  kind: VotingEventKind,
): Promise<void> {
  await runStep(interaction, "Could not queue the event", async () => {
    await mutateSandbox(interaction.user.id, (state) => queueSandboxEvent(state, kind));
    return `Queued \`${kind}\` without changing the round, so its handler sees the ` +
      "current phase.";
  });
}

export async function handleSandboxDeliver(interaction: CommandInteraction): Promise<void> {
  await runStep(interaction, "Could not deliver the sandbox events", async () => {
    if (!(await loadSandbox(interaction.user.id))) {
      throw new UserFacingError(NO_SANDBOX_MESSAGE);
    }
    return "Retried the queued events.";
  });
}

export async function handleSandboxEnd(interaction: CommandInteraction): Promise<void> {
  try {
    const existed = await endSandbox(interaction.user.id);
    await safeReply(
      interaction,
      buildTextReply(
        existed
          ? "Ended your voting sandbox. Its panels and tie prompts now refuse input."
          : "You have no voting sandbox to end.",
        true,
      ),
    );
  } catch (err) {
    await safeReply(
      interaction,
      buildErrorReply(buildApiErrorMessage("Could not end the voting sandbox", err), true),
    );
  }
}
