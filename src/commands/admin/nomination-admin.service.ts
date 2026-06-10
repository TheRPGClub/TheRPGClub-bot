import type {
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags, userMention } from "discord.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import {
  buildDeletionReasonState,
  buildDeletionReasonModal,
  buildDeletionSelectControls,
  buildNominationDeleteView,
  parseDeletionReasonModalCustomId,
  parseDeletionReasonStateId,
  parseDeletionSelectCustomId,
  announceNominationChange,
} from "../../functions/NominationAdminHelpers.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
} from "../../functions/NominationListComponents.js";

export async function handleDeleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("gotm", "/nominate");
  if (!view) {
    await safeReply(
      interaction,
      buildTextReply(`No GOTM nominations found for Round ${window.targetRound}.`, true),
    );
    return;
  }

  await safeReply(interaction, {
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleDeleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("nr-gotm", "/nominate");
  if (!view) {
    await safeReply(
      interaction,
      buildTextReply(`No NR-GOTM nominations found for Round ${window.targetRound}.`, true),
    );
    return;
  }

  await safeReply(interaction, {
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleAdminNominationDeleteSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseDeletionSelectCustomId(interaction.customId);
  const selectedUserId = interaction.values?.[0];
  if (!parsed || !selectedUserId) {
    await safeReply(
      interaction,
      buildTextReply("This nomination deletion menu is invalid. Run the command again.", true),
    );
    return;
  }

  const nomination = await getNominationForUser(parsed.kind, parsed.round, selectedUserId);
  if (!nomination) {
    await safeReply(
      interaction,
      buildTextReply("That nomination no longer exists. Run the command again.", true),
    );
    return;
  }

  await interaction.showModal(
    buildDeletionReasonModal(parsed.kind, parsed.round, selectedUserId, nomination.gameTitle),
  ).catch(async () => {
    await safeReply(
      interaction,
      buildTextReply("Unable to open the deletion reason prompt. Try again.", true),
    );
  });
}

export async function handleAdminNominationDeleteReasonModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseDeletionReasonModalCustomId(interaction.customId);
  if (!parsed) {
    await safeReply(
      interaction,
      buildTextReply("This nomination deletion prompt is invalid. Run the command again.", true),
    );
    return;
  }

  const parsedState = parseDeletionReasonStateId(parsed.sessionId);
  if (!parsedState) {
    await safeReply(
      interaction,
      buildTextReply("This nomination deletion prompt is invalid. Run the command again.", true),
    );
    return;
  }

  const nomination = await getNominationForUser(
    parsedState.kind, parsedState.round, parsedState.userId,
  );
  const sessionState = nomination
    ? buildDeletionReasonState(
      parsedState.kind,
      parsedState.round,
      parsedState.userId,
      nomination.gameTitle,
    )
    : null;
  if (!sessionState) {
    await safeReply(
      interaction,
      buildTextReply("That nomination no longer exists. Run the command again.", true),
    );
    return;
  }

  const reason = sanitizeUserInput(
    interaction.fields.getTextInputValue("admin-nom-del-reason-input"),
    { preserveNewlines: true, maxLength: 250 },
  );
  if (!reason) {
    await safeReply(
      interaction,
      buildTextReply("A deletion reason is required.", true),
    );
    return;
  }

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await deleteNominationForUser(sessionState.kind, sessionState.round, sessionState.userId);
  const nominations = await listNominationsForRound(sessionState.kind, sessionState.round);
  const window = await getUpcomingNominationWindow();
  const payload = await buildNominationListPayload(
    sessionState.kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    {
      ...window,
      targetRound: sessionState.round,
    },
    nominations,
    false,
  );
  const content =
    `${userMention(interaction.user.id)} deleted ${userMention(sessionState.userId)}'s nomination ` +
    `"${sessionState.gameTitle}" for ${sessionState.kind.toUpperCase()} Round ${sessionState.round}. ` +
    `Reason: ${reason}`;

  const textContainer = buildTextReply(content, true);
  await safeReply(interaction, {
    components: [...textContainer.components, ...payload.components],
    files: payload.files,
    flags: buildComponentsV2Flags(true),
  });
  await announceNominationChange(sessionState.kind, interaction, content, payload);
}

export async function buildDeleteViewForTests(
  kind: "gotm" | "nr-gotm",
  round: number,
): Promise<Array<any>> {
  const nominations = await listNominationsForRound(kind, round);
  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    {
      closesAt: new Date("2026-03-13T12:00:00.000Z"),
      nextVoteAt: new Date("2026-03-20T12:00:00.000Z"),
      targetRound: round,
    },
    nominations,
    false,
    { includeDetailSelect: false },
  );

  return [...payload.components, ...buildDeletionSelectControls(kind, round, nominations)];
}
