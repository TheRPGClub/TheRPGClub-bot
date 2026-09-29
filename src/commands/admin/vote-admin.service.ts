import type { ButtonInteraction, CommandInteraction } from "discord.js";
import { channelMention } from "discord.js";
import {
  listNominationsForRound,
  NOMINATION_KINDS,
  nominationKindLabel,
  parseNominationKind,
} from "../../classes/Nomination.js";
import { deleteAllVotesForRound, getVoteTally } from "../../classes/Vote.js";
import Gotm from "../../classes/Gotm.js";
import VotingRounds, {
  isRoundTallyRevealed,
  type IVotingRound,
} from "../../classes/VotingRounds.js";
import {
  safeReply,
  safeUpdate,
  withErrorReply,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { buildActionButton, buildButtonRow } from "../../functions/uiComponents.js";
import {
  buildHiddenTallyText,
  buildTallyText,
  mergeTallyWithNominations,
  sumTallyVotes,
} from "../../functions/VoteResultsUtils.js";
import { announceVotingResults } from "../../services/VotingResultsAnnouncement.js";
import {
  hasVotableNominations,
  loadNominationsByKind,
  postVotePanels,
} from "../../functions/VotePanelPosting.js";
import { toUnixTimestamp } from "../../functions/DateFormatUtils.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../../config/channels.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";

const NO_ROUND_SCHEDULED = "No voting round is scheduled.";

function buildUpdateText(text: string): {
  components: ReturnType<typeof buildTextContainer>[];
  flags: number;
} {
  return { components: [buildTextContainer(text)], flags: buildComponentsV2EditFlags() };
}

/** Why a test panel's casts would be refused, for the panel banner. */
function buildCastsRefusedReason(roundNumber: number, round: IVotingRound | null): string {
  if (!round) {
    return `the API has no voting round ${roundNumber}`;
  }
  if (round.votingEnded) {
    return `voting for Round ${roundNumber} has already ended`;
  }
  return `voting for Round ${roundNumber} has not opened yet`;
}

/**
 * Rehearses a round's voting panels without writing anything. Panels go to the
 * invoking channel and never to announcements, and the round's schedule is
 * left alone. Casting from a test panel is still a real vote, which the
 * banner says.
 */
async function handleVotingOpenTestMode(
  interaction: CommandInteraction,
  roundInput: number | undefined,
): Promise<void> {
  await withErrorReply(interaction, async () => {
    const channelId = interaction.channelId;
    if (!channelId) {
      await safeReply(
        interaction,
        buildTextReply(
          "Test mode posts the panels in the channel it was run from, " +
            "so it cannot be used here.",
          true,
        ),
      );
      return;
    }

    let targetRound = roundInput;
    if (targetRound == null) {
      const current = await VotingRounds.getCurrent();
      if (!current) {
        await safeReply(
          interaction,
          buildTextReply(
            `${NO_ROUND_SCHEDULED} Pass round:<number> to choose what to rehearse.`,
            true,
          ),
        );
        return;
      }
      targetRound = current.roundNumber;
    }
    if (!isPositiveInt(targetRound)) {
      await safeReply(interaction, buildTextReply("Invalid round number.", true));
      return;
    }

    const nominationsByKind = await loadNominationsByKind(targetRound);
    if (!hasVotableNominations(nominationsByKind)) {
      await safeReply(
        interaction,
        buildTextReply(
          `There are no votable nominations for Round ${targetRound}, ` +
            "so there is nothing to rehearse.",
          true,
        ),
      );
      return;
    }

    const round = await VotingRounds.getByRound(targetRound);
    const castsAccepted = Boolean(round?.votingOpen);
    const castsRefusedReason = castsAccepted
      ? null
      : buildCastsRefusedReason(targetRound, round);

    const { lines: resultLines } = await postVotePanels({
      client: interaction.client,
      channelId,
      roundNumber: targetRound,
      voteDeadline: round?.votingClosesAt ?? null,
      nominationsByKind,
      testMode: true,
      castsAccepted,
      castsRefusedReason,
    });

    const castNote = castsAccepted
      ? `Casting is live: votes land on Round ${targetRound} for real. Clear them with ` +
        `/admin votes-reset type:<category> round:${targetRound}.`
      : `Casting is refused: ${castsRefusedReason}.`;
    await safeReply(
      interaction,
      buildTextReply(
        `🧪 Test mode: Round ${targetRound} panels posted in ${channelMention(channelId)}. ` +
          "The round's schedule was not changed.\n" +
          `${castNote}\n${resultLines.join("\n")}`,
        true,
      ),
    );
  }, "Could not post the test voting panels");
}

/**
 * Reposts the current round's voting panels. The API opens voting on schedule
 * and queues the panels itself (the voting_opened event), so this only
 * replaces panels that are missing while voting is open.
 */
export async function handleVotingOpen(
  interaction: CommandInteraction,
  postHere: boolean,
  testMode = false,
  roundInput?: number,
): Promise<void> {
  if (testMode) {
    await handleVotingOpenTestMode(interaction, roundInput);
    return;
  }
  if (roundInput != null) {
    await safeReply(
      interaction,
      buildTextReply(
        "round: only applies with testmode:true. Reposting always targets the current round.",
        true,
      ),
    );
    return;
  }
  await withErrorReply(interaction, async () => {
    const current = await VotingRounds.getCurrent();
    if (!current) {
      await safeReply(interaction, buildTextReply(NO_ROUND_SCHEDULED, true));
      return;
    }
    const roundNumber = current.roundNumber;
    if (current.nominationsOpen) {
      await safeReply(
        interaction,
        buildTextReply(
          `Voting for Round ${roundNumber} opens ` +
            `<t:${toUnixTimestamp(current.votingOpensAt)}:F>, ` +
            "and the panels post on their own then.",
          true,
        ),
      );
      return;
    }
    if (!current.votingOpen) {
      await safeReply(
        interaction,
        buildTextReply(
          `Voting for Round ${roundNumber} has ended, so there are no panels to repost.`,
          true,
        ),
      );
      return;
    }

    const nominationsByKind = await loadNominationsByKind(roundNumber);
    if (!hasVotableNominations(nominationsByKind)) {
      await safeReply(
        interaction,
        buildTextReply(
          `There are no votable nominations for Round ${roundNumber}, ` +
            "so no panels were posted.",
          true,
        ),
      );
      return;
    }

    const channelId =
      postHere && interaction.channelId ? interaction.channelId : ANNOUNCEMENT_CHANNEL_ID;
    const { lines: resultLines } = await postVotePanels({
      client: interaction.client,
      channelId,
      roundNumber,
      voteDeadline: current.votingClosesAt,
      nominationsByKind,
    });

    await safeReply(
      interaction,
      buildTextReply(
        `Round ${roundNumber} voting panels reposted. Voting closes ` +
          `<t:${toUnixTimestamp(current.votingClosesAt)}:F>.\n${resultLines.join("\n")}`,
        true,
      ),
    );
  }, "Could not repost the voting panels");
}

const RESULTS_POST_NOTE =
  `The results post in ${channelMention(ANNOUNCEMENT_CHANNEL_ID)} once the API ` +
  "decides the round.";

export async function handleVotingClose(interaction: CommandInteraction): Promise<void> {
  await withErrorReply(interaction, async () => {
    const round = await VotingRounds.getCurrent();
    if (!round?.votingOpen) {
      await safeReply(interaction, buildTextReply("No voting is currently open.", true));
      return;
    }
    const container = buildTextContainer(
      `Close Round ${round.roundNumber} voting now? ${RESULTS_POST_NOTE} It is otherwise ` +
        `scheduled to close <t:${toUnixTimestamp(round.votingClosesAt)}:F>.`,
    );
    const row = buildButtonRow(
      buildActionButton(
        "confirm",
        `admin-vote-close:${round.roundNumber}:confirm`,
        "Close Voting",
      ),
      buildActionButton("cancel", `admin-vote-close:${round.roundNumber}:cancel`),
    );
    await safeReply(interaction, {
      components: [container, row],
      flags: buildComponentsV2Flags(true),
    });
  }, "Could not prepare the voting close confirmation");
}

export async function handleVoteCloseButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const round = Number(parts[1] ?? "");
  const action = parts[2] ?? "";
  if (!isPositiveInt(round)) {
    await safeUpdate(interaction, buildUpdateText("Invalid voting close action."));
    return;
  }
  if (action !== "confirm") {
    await safeUpdate(interaction, buildUpdateText("Voting close cancelled."));
    return;
  }
  await withErrorReply(interaction, async () => {
    // Re-read: the confirmation can be clicked after the round closed on its
    // own, and moving the close of an ended round would rewrite its history.
    const current = await VotingRounds.getByRound(round);
    if (!current?.votingOpen) {
      await safeUpdate(
        interaction,
        buildUpdateText(`Voting for Round ${round} is not open, so there is nothing to close.`),
      );
      return;
    }
    await VotingRounds.reschedule(round, { votingClosesAt: new Date() });
    await safeUpdate(
      interaction,
      buildUpdateText(`🔒 Voting for Round ${round} is now closed. ${RESULTS_POST_NOTE}`),
    );
  }, "Could not close voting");
}

export async function handleVotesReset(
  interaction: CommandInteraction,
  rawKind: string,
  round: number,
): Promise<void> {
  const kind = parseNominationKind(rawKind);
  if (!kind || !isPositiveInt(round)) {
    await safeReply(
      interaction,
      buildTextReply("Please choose a valid category and round number.", true),
    );
    return;
  }
  const kindLabel = nominationKindLabel(kind);
  const container = buildTextContainer(
    `Delete ALL ${kindLabel} votes for Round ${round}? This cannot be undone.`,
  );
  const row = buildButtonRow(
    buildActionButton(
      "delete",
      `admin-votes-reset:${kind}:${round}:confirm`,
      "Delete All Votes",
    ),
    buildActionButton("cancel", `admin-votes-reset:${kind}:${round}:cancel`),
  );
  await safeReply(interaction, {
    components: [container, row],
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleVotesResetButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const kind = parseNominationKind(parts[1] ?? "");
  const round = Number(parts[2] ?? "");
  const action = parts[3] ?? "";
  if (!kind || !isPositiveInt(round)) {
    await safeUpdate(interaction, buildUpdateText("Invalid vote reset action."));
    return;
  }
  if (action !== "confirm") {
    await safeUpdate(interaction, buildUpdateText("Vote reset cancelled."));
    return;
  }
  await withErrorReply(interaction, async () => {
    const deleted = await deleteAllVotesForRound(kind, round);
    const voteNoun = deleted === 1 ? "vote" : "votes";
    await safeUpdate(
      interaction,
      buildUpdateText(
        `🗑️ Deleted ${deleted} ${nominationKindLabel(kind)} ${voteNoun} for Round ${round}.`,
      ),
    );
  }, "Could not reset votes");
}

export async function handleVotingResults(
  interaction: CommandInteraction,
  roundInput: number | undefined,
  publish: boolean,
  channelOverrideId?: string,
): Promise<void> {
  if (channelOverrideId && !publish) {
    await safeReply(
      interaction,
      buildTextReply(
        "channel: only applies with publish:true. Without it the results are returned " +
          "to you here, not posted anywhere.",
        true,
      ),
    );
    return;
  }
  await withErrorReply(interaction, async () => {
    let round = roundInput;
    let current: IVotingRound | null = null;
    if (round == null) {
      current = await VotingRounds.getCurrent();
      if (!current) {
        await safeReply(interaction, buildTextReply(NO_ROUND_SCHEDULED, true));
        return;
      }
      round = current.roundNumber;
    }
    if (!isPositiveInt(round)) {
      await safeReply(interaction, buildTextReply("Invalid round number.", true));
      return;
    }

    const info = current ?? (await VotingRounds.getByRound(round));
    // Tallies are hidden from everyone (admins included) until voting ends.
    const stillOpen = !isRoundTallyRevealed(
      round,
      info,
      info ? null : await VotingRounds.getCurrent(),
    );

    if (publish) {
      if (stillOpen) {
        await safeReply(
          interaction,
          buildTextReply(
            `Voting for Round ${round} has not ended; results cannot be published yet.`,
            true,
          ),
        );
        return;
      }
      // Rounds from before the API tracked the lifecycle have no row, so their
      // month comes from the recorded GOTM round instead.
      const monthLabel = info?.monthYear ?? Gotm.getByRound(round)[0]?.monthYear;
      if (!monthLabel) {
        await safeReply(
          interaction,
          buildTextReply(`No voting round or GOTM entry exists for Round ${round}.`, true),
        );
        return;
      }
      // A channel override makes this a rehearsal: banner added, no winner thread.
      const rehearsal = Boolean(channelOverrideId);
      await announceVotingResults(
        interaction.client,
        { roundNumber: round, monthLabel },
        { channelIdOverride: channelOverrideId, rehearsal },
      );
      const targetChannelId = channelOverrideId ?? ANNOUNCEMENT_CHANNEL_ID;
      await safeReply(
        interaction,
        buildTextReply(
          rehearsal
            ? `🧪 Test mode: Round ${round} results were posted in ` +
              `${channelMention(targetChannelId)}. No winner thread was created or renamed.`
            : `Round ${round} results were posted in ${channelMention(targetChannelId)}.`,
          true,
        ),
      );
      return;
    }

    const sections: string[] = [];
    for (const kind of NOMINATION_KINDS) {
      const kindLabel = nominationKindLabel(kind);
      const [tally, nominations] = await Promise.all([
        getVoteTally(kind, round),
        listNominationsForRound(kind, round),
      ]);
      if (!nominations.length) {
        sections.push(`${kindLabel}: no nominations for Round ${round}.`);
        continue;
      }
      if (stillOpen) {
        sections.push(
          buildHiddenTallyText({
            kindLabel,
            roundNumber: round,
            totalVotes: sumTallyVotes(tally.rows),
            voteDeadline: info?.votingClosesAt ?? null,
          }),
        );
        continue;
      }
      sections.push(
        buildTallyText({
          kindLabel,
          roundNumber: round,
          rows: mergeTallyWithNominations(tally.rows, nominations),
          cap: tally.cap,
          votingOpen: false,
          voteDeadline: info?.votingClosesAt ?? null,
        }),
      );
    }
    await safeReply(interaction, {
      components: [buildTextContainer(sections.join("\n\n"))],
      flags: buildComponentsV2Flags(true),
    });
  }, "Could not load voting results");
}
