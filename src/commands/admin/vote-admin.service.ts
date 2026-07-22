import type { ButtonInteraction, CommandInteraction } from "discord.js";
import { channelMention } from "discord.js";
import type { INominationEntry, NominationKind } from "../../classes/Nomination.js";
import {
  listNominationsForRound,
  NOMINATION_KINDS,
  nominationKindLabel,
  parseNominationKind,
} from "../../classes/Nomination.js";
import { deleteAllVotesForRound, getVoteTally } from "../../classes/Vote.js";
import BotVotingInfo from "../../classes/BotVotingInfo.js";
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
  buildVotePanelComponents,
  type VotePanelComponent,
} from "../../functions/VotePanelComponents.js";
import {
  buildTallyText,
  dedupeNominationsByGame,
  mergeTallyWithNominations,
} from "../../functions/VoteResultsUtils.js";
import { getActiveVotingRound, isRoundDecided } from "../../functions/VotingRound.js";
import { calculateVoteDeadlineEt } from "../../functions/VoteDateUtils.js";
import { toUnixTimestamp } from "../../functions/DateFormatUtils.js";
import { ANNOUNCEMENT_CHANNEL_ID } from "../../config/channels.js";
import { isPositiveInt } from "../../utilities/ValidationUtils.js";
import { logError } from "../../utilities/LogUtils.js";

function buildUpdateText(text: string): {
  components: ReturnType<typeof buildTextContainer>[];
  flags: number;
} {
  return { components: [buildTextContainer(text)], flags: buildComponentsV2EditFlags() };
}

async function sendPanelToChannel(
  interaction: CommandInteraction,
  channelId: string,
  components: VotePanelComponent[],
): Promise<boolean> {
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    const sendable =
      channel?.isTextBased() && typeof (channel as any).send === "function"
        ? (channel as any)
        : null;
    if (!sendable) {
      return false;
    }
    await sendable.send({
      components,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    logError("vote-admin.service.sendPanelToChannel", error);
    return false;
  }
}

/**
 * Opens first-party voting for the round after the current one and posts the
 * voting panels. Creating the target round's voting_info row (openVotingRound)
 * is what opens the window server-side, so this only runs once the scheduled
 * vote time has passed. Re-running while voting is open reposts the panels.
 */
export async function handleVotingOpen(
  interaction: CommandInteraction,
  postHere: boolean,
): Promise<void> {
  await withErrorReply(interaction, async () => {
    const current = await BotVotingInfo.getCurrentRound();
    if (!current) {
      await safeReply(
        interaction,
        buildTextReply(
          "No voting round information is available. Run /admin nextround-setup first.",
          true,
        ),
      );
      return;
    }

    let targetRound: number;
    let reposting = false;

    if (!isRoundDecided(current.roundNumber)) {
      if (current.votingOpen) {
        targetRound = current.roundNumber;
        reposting = true;
      } else if (current.votingEnded) {
        await safeReply(
          interaction,
          buildTextReply(
            `Voting for Round ${current.roundNumber} has already ended. ` +
              "Run /admin nextround-setup to record the winners.",
            true,
          ),
        );
        return;
      } else {
        await safeReply(
          interaction,
          buildTextReply(
            `Voting for Round ${current.roundNumber} is scheduled to open ` +
              `<t:${toUnixTimestamp(current.nextVoteAt)}:F>.`,
            true,
          ),
        );
        return;
      }
    } else {
      targetRound = current.roundNumber + 1;
      if (new Date() < current.nextVoteAt) {
        await safeReply(
          interaction,
          buildTextReply(
            `Voting for Round ${targetRound} is scheduled to open ` +
              `<t:${toUnixTimestamp(current.nextVoteAt)}:F>. ` +
              "Run this command again once that time has passed.",
            true,
          ),
        );
        return;
      }
    }

    const nominationsByKind = new Map<NominationKind, INominationEntry[]>();
    for (const kind of NOMINATION_KINDS) {
      nominationsByKind.set(kind, await listNominationsForRound(kind, targetRound));
    }
    const hasVotableNominations = [...nominationsByKind.values()].some(
      (nominations) => dedupeNominationsByGame(nominations).length > 0,
    );
    if (!hasVotableNominations) {
      await safeReply(
        interaction,
        buildTextReply(
          `There are no votable nominations for Round ${targetRound}, ` +
            "so voting was not opened.",
          true,
        ),
      );
      return;
    }

    if (!reposting) {
      let opensAt = current.nextVoteAt;
      if (new Date() >= calculateVoteDeadlineEt(opensAt)) {
        // Opened after the scheduled window would already have closed; open
        // now so the round still gets a window through the coming Sunday.
        opensAt = new Date();
      }
      await BotVotingInfo.openVotingRound(targetRound, opensAt);
    }

    const info = await BotVotingInfo.getByRound(targetRound);
    if (!info?.votingOpen) {
      await safeReply(
        interaction,
        buildTextReply(
          `Voting for Round ${targetRound} did not open as expected. ` +
            "Check the round's voting_info row.",
          true,
        ),
      );
      return;
    }

    const channelId =
      postHere && interaction.channelId ? interaction.channelId : ANNOUNCEMENT_CHANNEL_ID;
    const resultLines: string[] = [];
    for (const kind of NOMINATION_KINDS) {
      const kindLabel = nominationKindLabel(kind);
      const nominations = nominationsByKind.get(kind) ?? [];
      if (!dedupeNominationsByGame(nominations).length) {
        resultLines.push(`${kindLabel}: no votable nominations; panel skipped.`);
        continue;
      }
      const tally = await getVoteTally(kind, targetRound);
      const components = buildVotePanelComponents({
        kind,
        roundNumber: targetRound,
        voteDeadline: info.voteDeadline,
        cap: tally.cap,
        nominations,
      });
      const sent = await sendPanelToChannel(interaction, channelId, components);
      resultLines.push(
        sent
          ? `${kindLabel}: voting panel posted in ${channelMention(channelId)}.`
          : `${kindLabel}: failed to post the voting panel in ${channelMention(channelId)}.`,
      );
    }

    const deadlinePart = info.voteDeadline
      ? ` Voting closes <t:${toUnixTimestamp(info.voteDeadline)}:F>.`
      : "";
    const headline = reposting
      ? `Voting for Round ${targetRound} is already open; panels reposted.`
      : `Voting opened for Round ${targetRound}.`;
    await safeReply(
      interaction,
      buildTextReply(`${headline}${deadlinePart}\n${resultLines.join("\n")}`, true),
    );
  }, "Could not open voting");
}

export async function handleVotingClose(interaction: CommandInteraction): Promise<void> {
  await withErrorReply(interaction, async () => {
    const round = await getActiveVotingRound();
    if (!round) {
      await safeReply(interaction, buildTextReply("No voting is currently open.", true));
      return;
    }
    const deadlineText = round.voteDeadline
      ? ` It is otherwise scheduled to close <t:${toUnixTimestamp(round.voteDeadline)}:F>.`
      : "";
    const container = buildTextContainer(
      `Close Round ${round.roundNumber} voting now?${deadlineText}`,
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
    await BotVotingInfo.updateVoteEndsAt(round, new Date());
    await safeUpdate(
      interaction,
      buildUpdateText(
        `🔒 Voting for Round ${round} is now closed. Results are no longer hidden.`,
      ),
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
): Promise<void> {
  await withErrorReply(interaction, async () => {
    let round = roundInput;
    if (round == null) {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(
          interaction,
          buildTextReply("No voting round information is available.", true),
        );
        return;
      }
      round = current.roundNumber;
    }
    if (!isPositiveInt(round)) {
      await safeReply(interaction, buildTextReply("Invalid round number.", true));
      return;
    }

    const info = await BotVotingInfo.getByRound(round);
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
      sections.push(
        buildTallyText({
          kindLabel,
          roundNumber: round,
          rows: mergeTallyWithNominations(tally.rows, nominations),
          cap: tally.cap,
          votingOpen: Boolean(info?.votingOpen) && !isRoundDecided(round),
          voteDeadline: info?.voteDeadline ?? null,
        }),
      );
    }
    await safeReply(interaction, {
      components: [buildTextContainer(sections.join("\n\n"))],
      flags: buildComponentsV2Flags(true),
    });
  }, "Could not load voting results");
}
