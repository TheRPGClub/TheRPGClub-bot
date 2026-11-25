import type {
  AutocompleteInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import {
  gotyAdminApi,
  type IGotyAdminApi,
  type IGotyDateChanges,
  type IGotyNomination,
  type IGotyVoteAdminView,
} from "../../classes/GotyVoteAdmin.js";
import {
  buildGotyNomDeleteModal,
  buildGotyNominationDeletedNotice,
  buildGotyTiePrompt,
  describeGotySchedule,
  filterGotyNominationChoices,
  GOTY_DATE_LABELS,
  GOTY_NOM_DEL_REASON_INPUT_ID,
  GOTY_NOM_DEL_REASON_MAX,
  NO_GOTY_VOTE,
  parseGotyDateInput,
  parseGotyNomDeleteModalId,
  parseGotyTieSelectId,
  postGotyNominationChange,
  resolveGotyYear,
  type GotyDateField,
} from "../../functions/GotyAdminHelpers.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  safeRespond,
  sanitizeUserInput,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2EditFlags,
  buildComponentsV2Flags,
  buildErrorReply,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { requestVotingEventPoll } from "../../services/VotingEventService.js";
import { buildApiRefusalMessage } from "../../utilities/ApiErrorUtils.js";
import { logError } from "../../utilities/LogUtils.js";

/**
 * The GOTY Vote admin actions in /admin (bot#1583): move a GOTY Vote's dates, settle a
 * tie a runoff left, and remove a Game of the Year nomination with a reason. Each action
 * is a function over an IGotyAdminApi returning what to reply, so it is tested without
 * Discord; the handle* wrappers do the Discord side.
 */

/** What an action says back, and whether the voting event poll should re-read now. */
export interface IGotyAdminOutcome {
  ok: boolean;
  text: string;
  /** The schedule or the decision changed, so the poller's next wake-up may have moved. */
  poll?: boolean;
}

function refusal(err: unknown, fallback: string): IGotyAdminOutcome {
  return { ok: false, text: buildApiRefusalMessage(err, fallback) };
}

// ---------------------------------------------------------------------------
// Move dates
// ---------------------------------------------------------------------------

export type GotyDateInputs = Partial<Record<GotyDateField, string>>;

/**
 * Moves the dates given (the others stay; moving only the voting open keeps the default
 * weekend window, as the API does). With no date given it shows the schedule. The API
 * refuses dates out of order, a move of the opening dates once voting has opened, and a
 * decided GOTY Vote; its message is shown with the full request and response.
 */
export async function moveGotyDates(
  api: IGotyAdminApi,
  yearOption: number | undefined,
  inputs: GotyDateInputs,
): Promise<IGotyAdminOutcome> {
  const changes: IGotyDateChanges = {};
  for (const field of Object.keys(GOTY_DATE_LABELS) as GotyDateField[]) {
    const raw = inputs[field]?.trim();
    if (!raw) continue;
    const parsed = parseGotyDateInput(raw, field);
    if (!parsed) {
      return {
        ok: false,
        text: `Could not read ${GOTY_DATE_LABELS[field]} "${raw}". Use a date such as ` +
          "`2027-01-15` or a date and time such as `2027-01-15 12:00` (US Eastern).",
      };
    }
    changes[field] = parsed;
  }

  let year: number | null;
  try {
    year = await resolveGotyYear(api, yearOption);
  } catch (err: unknown) {
    return refusal(err, "Could not load the GOTY Votes");
  }
  if (year === null) return { ok: false, text: NO_GOTY_VOTE };

  if (Object.keys(changes).length === 0) {
    let vote: IGotyVoteAdminView | null;
    try {
      vote = await api.getVote(year);
    } catch (err: unknown) {
      return refusal(err, `Could not load GOTY Vote ${year}`);
    }
    if (!vote) return { ok: false, text: `There is no GOTY Vote ${year}.` };
    return {
      ok: true,
      text: `No dates given, so nothing moved. ${vote.name} (${vote.phase}):\n` +
        describeGotySchedule(vote),
    };
  }

  try {
    const vote = await api.moveDates(year, changes);
    return {
      ok: true,
      text: `${vote.name} dates moved.\n${describeGotySchedule(vote)}`,
      poll: true,
    };
  } catch (err: unknown) {
    return refusal(err, `Could not move the GOTY Vote ${year} dates`);
  }
}

export async function handleGotyDates(
  interaction: CommandInteraction,
  year: number | undefined,
  inputs: GotyDateInputs,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  const outcome = await moveGotyDates(api, year, inputs);
  await replyOutcome(interaction, outcome);
}

// ---------------------------------------------------------------------------
// Settle a tie
// ---------------------------------------------------------------------------

/** The tie prompt for a GOTY Vote, or why there is none to show. */
export async function loadGotyTiePrompt(
  api: IGotyAdminApi,
  yearOption: number | undefined,
): Promise<{ vote: IGotyVoteAdminView } | IGotyAdminOutcome> {
  try {
    const year = await resolveGotyYear(api, yearOption);
    if (year === null) return { ok: false, text: NO_GOTY_VOTE };
    const vote = await api.getVote(year);
    if (!vote) return { ok: false, text: `There is no GOTY Vote ${year}.` };
    return { vote };
  } catch (err: unknown) {
    return refusal(err, "Could not load the GOTY Vote");
  }
}

export async function handleGotyTie(
  interaction: CommandInteraction,
  year: number | undefined,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  const loaded = await loadGotyTiePrompt(api, year);
  if (!("vote" in loaded)) {
    await replyOutcome(interaction, loaded);
    return;
  }
  await safeReply(interaction, {
    components: buildGotyTiePrompt(loaded.vote),
    flags: buildComponentsV2Flags(true),
    allowedMentions: { parse: [] },
  });
}

/**
 * Records the admin's pick as the Award's winner. The API refuses a stale pick (422
 * `no_tie` or `invalid_pick`). Settling the last tie decides the GOTY Vote; its results
 * are the API's `goty_decided` event, which the poll then picks up.
 */
export async function settleGotyTie(
  api: IGotyAdminApi,
  customId: string,
  gameId: number,
  adminUserId: string,
): Promise<{ vote: IGotyVoteAdminView; lead: string; poll: boolean } | IGotyAdminOutcome> {
  const target = parseGotyTieSelectId(customId);
  if (!target || !Number.isInteger(gameId) || gameId <= 0) {
    return { ok: false, text: "This tie-break prompt is invalid. Run /admin goty-tie again." };
  }
  try {
    const vote = await api.resolveTie(target.year, target.award, gameId);
    const winner = vote.winners.find((entry) => entry.award === target.award);
    const title = winner?.game.title ?? `Game ${gameId}`;
    const awardName = winner?.name ?? target.award;
    return {
      vote,
      lead: `<@${adminUserId}> picked ${title} as ${awardName} ${target.year}.`,
      poll: vote.decidedAt !== null,
    };
  } catch (err: unknown) {
    return refusal(err, `Could not settle the GOTY Vote ${target.year} tie`);
  }
}

export async function handleGotyTieSelect(
  interaction: StringSelectMenuInteraction,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  await safeDeferUpdate(interaction);
  const settled = await settleGotyTie(
    api,
    interaction.customId,
    Number(interaction.values?.[0]),
    interaction.user.id,
  );
  if (!("vote" in settled)) {
    // A follow-up, so the prompt (and any other Award's select) stays.
    await safeFollowUpIfSettled(interaction, buildErrorReply(settled.text, true));
    return;
  }
  await safeEditReply(interaction, {
    components: buildGotyTiePrompt(settled.vote, settled.lead),
    flags: buildComponentsV2EditFlags(),
    allowedMentions: { parse: [] },
  });
  if (settled.poll) requestVotingEventPoll();
}

// ---------------------------------------------------------------------------
// Remove a nomination
// ---------------------------------------------------------------------------

/** Autocomplete for /admin goty-delete-nom: the year's nominations by game and nominator. */
export async function autocompleteGotyNomination(
  interaction: AutocompleteInteraction,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  try {
    const yearOption = interaction.options.getInteger("year") ?? undefined;
    const year = await resolveGotyYear(api, yearOption);
    if (year === null) {
      await safeRespond(interaction, []);
      return;
    }
    const nominations = await api.listNominations(year);
    const query = String(interaction.options.getFocused() ?? "");
    await safeRespond(interaction, filterGotyNominationChoices(nominations, query));
  } catch (err: unknown) {
    logError("GotyAdmin.autocompleteNomination", err);
    await safeRespond(interaction, []);
  }
}

/** The nomination an admin picked, or why it cannot be removed. */
export async function findGotyNomination(
  api: IGotyAdminApi,
  yearOption: number | undefined,
  rawNominationId: string,
): Promise<{ year: number; nomination: IGotyNomination } | IGotyAdminOutcome> {
  const nominationId = Number(rawNominationId.trim());
  if (!Number.isInteger(nominationId) || nominationId <= 0) {
    return { ok: false, text: "Pick a nomination from the list." };
  }
  try {
    const year = await resolveGotyYear(api, yearOption);
    if (year === null) return { ok: false, text: NO_GOTY_VOTE };
    const nomination = (await api.listNominations(year))
      .find((entry) => entry.id === nominationId);
    if (!nomination) {
      return { ok: false, text: `That GOTY Vote ${year} nomination no longer exists.` };
    }
    return { year, nomination };
  } catch (err: unknown) {
    return refusal(err, "Could not load the GOTY Vote nominations");
  }
}

/** Opens the reason modal. Not deferred: a modal must be the first response. */
export async function handleGotyDeleteNomination(
  interaction: CommandInteraction,
  year: number | undefined,
  rawNominationId: string,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  const found = await findGotyNomination(api, year, rawNominationId);
  if (!("nomination" in found)) {
    await safeReply(interaction, buildTextReply(found.text, true));
    return;
  }
  await interaction.showModal(buildGotyNomDeleteModal(found.year, found.nomination))
    .catch(async () => {
      await safeReply(
        interaction,
        buildTextReply("Unable to open the deletion reason prompt. Try again.", true),
      );
    });
}

export interface IGotyNominationRemoval extends IGotyAdminOutcome {
  /** Set once removed: the public notice and the list to post with it. */
  announcement?: { year: number; content: string; nominations: IGotyNomination[] };
}

/**
 * Removes a nomination as the service (a plain delete, so the API queues no job) and words
 * the notice the bot posts itself, as /admin delete-gotm-noms does. The reason is required,
 * 1 to 250 characters. Removal is refused once voting has opened (422 nominations_closed).
 */
export async function removeGotyNomination(
  api: IGotyAdminApi,
  year: number,
  nominationId: number,
  adminUserId: string,
  rawReason: string,
): Promise<IGotyNominationRemoval> {
  const reason = sanitizeUserInput(rawReason, {
    preserveNewlines: true,
    maxLength: GOTY_NOM_DEL_REASON_MAX,
  }).trim();
  if (!reason) return { ok: false, text: "A deletion reason is required." };

  const found = await findGotyNomination(api, year, String(nominationId));
  if (!("nomination" in found)) return found;
  const { nomination } = found;

  try {
    const deleted = await api.deleteNomination(year, nominationId);
    if (!deleted) {
      return { ok: false, text: `That GOTY Vote ${year} nomination no longer exists.` };
    }
  } catch (err: unknown) {
    return refusal(err, `Could not delete the GOTY Vote ${year} nomination`);
  }

  const content = buildGotyNominationDeletedNotice(
    year,
    adminUserId,
    nomination.userId,
    nomination.gameTitle,
    reason,
  );
  let nominations: IGotyNomination[] = [];
  try {
    nominations = await api.listNominations(year);
  } catch (err: unknown) {
    logError("GotyAdmin.removeNomination.list", err);
  }
  return { ok: true, text: content, announcement: { year, content, nominations } };
}

export async function handleGotyDeleteNominationModal(
  interaction: ModalSubmitInteraction,
  api: IGotyAdminApi = gotyAdminApi,
): Promise<void> {
  const parsed = parseGotyNomDeleteModalId(interaction.customId);
  if (!parsed) {
    await safeReply(
      interaction,
      buildTextReply("This nomination deletion prompt is invalid. Run the command again.", true),
    );
    return;
  }
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  const removal = await removeGotyNomination(
    api,
    parsed.year,
    parsed.nominationId,
    interaction.user.id,
    interaction.fields.getTextInputValue(GOTY_NOM_DEL_REASON_INPUT_ID),
  );
  await replyOutcome(interaction, removal);
  if (!removal.announcement) return;
  try {
    const { year, content, nominations } = removal.announcement;
    await postGotyNominationChange(interaction.client, year, content, nominations);
  } catch (err: unknown) {
    logError("GotyAdmin.announceNominationRemoval", err);
    await safeFollowUpIfSettled(interaction, buildErrorReply(
      "The nomination was removed, but the notice could not be posted in the nomination " +
        "channel.",
      true,
    ));
  }
}

async function replyOutcome(
  interaction: CommandInteraction | ModalSubmitInteraction,
  outcome: IGotyAdminOutcome,
): Promise<void> {
  await safeReply(interaction, {
    ...(outcome.ok ? buildTextReply(outcome.text, true) : buildErrorReply(outcome.text, true)),
    allowedMentions: { parse: [] },
  });
  if (outcome.poll) requestVotingEventPoll();
}
