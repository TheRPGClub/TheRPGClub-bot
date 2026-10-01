import { DateTime } from "luxon";
import {
  ButtonStyle,
  ModalBuilder,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  getModalField,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
  withErrorReply,
} from "../../functions/InteractionUtils.js";
import {
  buildComponentsV2EditFlags,
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../../functions/ComponentsV2Utils.js";
import { buildCaughtErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { resolveSessionOrReply } from "../../functions/ResumableSessionReplies.js";
import { assertCustomIdSegments } from "../../utilities/CustomIdUtils.js";
import { listNominationsForRound } from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import { calculateNextVoteDateEt } from "../../functions/VoteDateUtils.js";
import { ADMIN_CHANNEL_ID, ANNOUNCEMENT_CHANNEL_NAME } from "../../config/channels.js";
import { formatMonthYear } from "../../functions/DateFormatUtils.js";
import {
  ADMIN_VOTING_TITLES_MODAL_PREFIX,
  ADMIN_VOTING_TITLES_PREFIX,
} from "../../config/customIdPrefixes.js";
import { DISCORD_SELECT_LABEL_MAX } from "../../config/textLimits.js";
import {
  buildOwnedSessionId,
  createResumableSessionRegistry,
  parseOwnedSessionOwnerId,
} from "../../services/PersistedInteractionSessionStore.js";
import {
  buildActionButton,
  buildButtonRow,
  buildTextInputLabel,
} from "../../functions/uiComponents.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { VOTING_TITLE_MAX_LEN } from "./admin.types.js";

type VotingKind = "GOTM" | "NR-GOTM";

// A modal holds at most five inputs, so long titles are shortened five at a time.
const TITLES_PER_MODAL = 5;
const VOTING_TITLES_SESSION_PREFIX = "votetitles";
const VOTING_TITLES_EXPIRED_MESSAGE =
  "This voting setup has expired. Run the legacy voting setup command again.";

export type VotingSetupState = {
  roundNumber: number;
  monthLabel: string;
  answers: Record<VotingKind, string[]>;
  /** Shortened titles keyed by `<kind>-<index>` into `answers`. */
  overrides: Record<string, string>;
};

type PendingTitle = { key: string; kind: VotingKind; title: string };

const votingSetupSessions = new Map<string, VotingSetupState>();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function votingSetupFromState(state: unknown): VotingSetupState | null {
  if (!state || typeof state !== "object") return null;
  const raw = state as Partial<VotingSetupState>;
  const answers = raw.answers as Partial<Record<VotingKind, unknown>> | undefined;
  const overrides = raw.overrides;
  if (
    typeof raw.roundNumber !== "number" ||
    typeof raw.monthLabel !== "string" ||
    !answers ||
    !isStringArray(answers.GOTM) ||
    !isStringArray(answers["NR-GOTM"]) ||
    !overrides ||
    typeof overrides !== "object" ||
    !Object.values(overrides).every((v) => typeof v === "string")
  ) {
    return null;
  }
  return {
    roundNumber: raw.roundNumber,
    monthLabel: raw.monthLabel,
    answers: { "GOTM": answers.GOTM, "NR-GOTM": answers["NR-GOTM"] },
    overrides: { ...overrides },
  };
}

const votingSetupRegistry = createResumableSessionRegistry<VotingSetupState>({
  kind: "admin-voting-titles",
  sessions: votingSetupSessions,
  fromState: (state) => votingSetupFromState(state),
});

function isTitleTooLong(title: string): boolean {
  return title.length > VOTING_TITLE_MAX_LEN;
}

export function listPendingTitles(state: VotingSetupState): PendingTitle[] {
  const pending: PendingTitle[] = [];
  for (const kind of ["GOTM", "NR-GOTM"] as const) {
    state.answers[kind].forEach((title, index) => {
      const key = `${kind}-${index}`;
      if (isTitleTooLong(title) && !(key in state.overrides)) {
        pending.push({ key, kind, title });
      }
    });
  }
  return pending;
}

export function resolveAnswers(state: VotingSetupState, kind: VotingKind): string[] {
  return state.answers[kind].map((title, index) =>
    state.overrides[`${kind}-${index}`] ?? title);
}

function buildPoll(
  kindLabel: VotingKind,
  answers: string[],
  roundNumber: number,
  monthLabel: string,
): string {
  if (!answers.length) {
    return `${kindLabel}: (no nominations found for Round ${roundNumber})`;
  }
  const maxSelect = Math.max(1, Math.floor(answers.length / 2));
  const answersJoined = answers.join(";");
  const pollName =
    kindLabel === "GOTM"
      ? `GOTM_Round_${roundNumber}`
      : `NR-GOTM_Round_${roundNumber}`;
  const question =
    kindLabel === "GOTM"
      ? `What Roleplaying Game(s) would you like to discuss in ${monthLabel}?`
      : `What Non-Roleplaying Game(s) would you like to discuss in ${monthLabel}?`;

  // Calculate time until 8 PM Eastern
  const nowInEastern = DateTime.now().setZone("America/New_York");
  const today8pm = nowInEastern.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

  let startOutput: string;
  let timeLimitOutput: string;

  if (nowInEastern < today8pm) {
    const diff = today8pm.diff(nowInEastern).shiftTo("hours", "minutes", "seconds");
    startOutput = diff.toFormat("h'h'm'm's's");
    timeLimitOutput = "48h";
  } else {
    startOutput = "1m";
    // End at 8 PM on (Today + 2 days)
    const targetEnd = today8pm.plus({ days: 2 });
    const actualStart = nowInEastern.plus({ minutes: 1 });
    const diff = targetEnd.diff(actualStart).shiftTo("hours", "minutes", "seconds");
    timeLimitOutput = diff.toFormat("h'h'm'm's's");
  }

  return `/poll question:${question} answers:${answersJoined} max_select:${maxSelect} start:${startOutput} time_limit:${timeLimitOutput} vote_change:Yes realtime_results:🙈 Hidden privacy:🤐 Semi-private role_required:@members channel:#${ANNOUNCEMENT_CHANNEL_NAME} name:${pollName} final_reveal:Yes chart_emoji:🟩 voting_button:Full Answer`;
}

async function postVotingSetup(
  interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  state: VotingSetupState,
): Promise<void> {
  const gotmPoll = buildPoll(
    "GOTM", resolveAnswers(state, "GOTM"), state.roundNumber, state.monthLabel,
  );
  const nrPoll = buildPoll(
    "NR-GOTM", resolveAnswers(state, "NR-GOTM"), state.roundNumber, state.monthLabel,
  );

  const adminChannel = ADMIN_CHANNEL_ID
    ? await interaction.client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null)
    : null;

  const messageContent = `GOTM:\n\`\`\`\n${gotmPoll}\n\`\`\`\nNR-GOTM:\n\`\`\`\n${nrPoll}\n\`\`\``;

  if (adminChannel && (adminChannel as any).send) {
    await (adminChannel as any).send({ content: messageContent });
    await safeReply(
      interaction,
      buildTextReply("Voting setup commands posted to #admin.", true),
    );
  } else {
    await safeReply(interaction, buildTextReply(messageContent, true));
  }
}

function buildShortenPrompt(sessionId: string, pending: PendingTitle[]) {
  const listed = pending
    .map((item, i) => `${i + 1}. ${item.kind}: "${item.title}" (${item.title.length})`)
    .join("\n");
  const reply = buildTextReply(
    `${pending.length} title(s) are longer than ${VOTING_TITLE_MAX_LEN} characters ` +
      `and need a shorter version before the poll commands can be built:\n${listed}`,
    true,
  );
  const nextCount = Math.min(TITLES_PER_MODAL, pending.length);
  return {
    ...reply,
    components: [
      ...reply.components,
      buildButtonRow(buildActionButton({
        customId: `${ADMIN_VOTING_TITLES_PREFIX}:${sessionId}`,
        label: `Shorten ${nextCount} title(s)`,
        style: ButtonStyle.Primary,
      })),
    ],
  };
}

export async function handleLegacyVotingSetup(
  interaction: CommandInteraction,
): Promise<void> {
  await withErrorReply(interaction, async () => {
    const window = await getUpcomingNominationWindow();
    const roundNumber = window.targetRound;
    const nextMonth = (() => {
      const base = new Date();
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
      return formatMonthYear(d);
    })();
    const monthLabel = nextMonth || "the upcoming month";

    const gotmNoms = await listNominationsForRound("gotm", roundNumber);
    const nrNoms = await listNominationsForRound("nr-gotm", roundNumber);
    const toAnswers = (noms: Array<{ gameTitle: string }>): string[] =>
      noms.map((n) => n.gameTitle.trim()).filter(Boolean);

    const state: VotingSetupState = {
      roundNumber,
      monthLabel,
      answers: { "GOTM": toAnswers(gotmNoms), "NR-GOTM": toAnswers(nrNoms) },
      overrides: {},
    };

    const pending = listPendingTitles(state);
    if (!pending.length) {
      await postVotingSetup(interaction, state);
      return;
    }

    const sessionId = buildOwnedSessionId(VOTING_TITLES_SESSION_PREFIX, interaction.user.id);
    votingSetupRegistry.create({
      sessionId,
      session: state,
      ownerId: interaction.user.id,
      location: { channelId: interaction.channelId, guildId: interaction.guildId },
      state,
    });
    await safeReply(interaction, buildShortenPrompt(sessionId, pending));
  }, "Could not generate vote commands");
}

function readSessionId(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): { sessionId: string; ownerId: string } | null {
  const [sessionId] = assertCustomIdSegments(interaction, 1) ?? [];
  const ownerId = sessionId
    ? parseOwnedSessionOwnerId(VOTING_TITLES_SESSION_PREFIX, sessionId)
    : null;
  return sessionId && ownerId ? { sessionId, ownerId } : null;
}

function resolveVotingSession(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  sessionId: string,
  ownerId: string,
): Promise<VotingSetupState | undefined> {
  return resolveSessionOrReply(
    votingSetupRegistry,
    interaction,
    sessionId,
    { ownerId, channelId: interaction.channelId },
    {
      expired: VOTING_TITLES_EXPIRED_MESSAGE,
      restoreFailed: "Could not restore this voting setup.",
      logContext: "VotingAdmin.restoreSession",
    },
  );
}

export async function handleVotingTitlesButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = readSessionId(interaction);
  if (!parsed) {
    await safeReply(interaction, buildTextReply(VOTING_TITLES_EXPIRED_MESSAGE, true));
    return;
  }
  const { sessionId, ownerId } = parsed;

  let state = votingSetupRegistry.get(sessionId);
  if (!state) {
    // A modal must be the first response, but restoring after a restart reads the
    // API and can outlast Discord's 3 second window. Ack, restore into memory, and
    // re-offer the button: the next click finds the session in memory.
    await safeDeferUpdate(interaction);
    state = await resolveVotingSession(interaction, sessionId, ownerId);
    if (!state) return;
    await safeReply(interaction, {
      ...buildShortenPrompt(sessionId, listPendingTitles(state)),
      __forceFollowUp: true,
    });
    return;
  }

  const batch = listPendingTitles(state).slice(0, TITLES_PER_MODAL);
  if (!batch.length) {
    await safeReply(interaction, buildTextReply("Every title is already shortened.", true));
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${ADMIN_VOTING_TITLES_MODAL_PREFIX}:${sessionId}`)
    .setTitle("Shorten voting titles")
    .addLabelComponents(...batch.map((item, i) => buildTextInputLabel({
      customId: item.key,
      label: `${item.kind} title ${i + 1} (max ${VOTING_TITLE_MAX_LEN})`,
      placeholder: item.title.slice(0, DISCORD_SELECT_LABEL_MAX),
      maxLength: VOTING_TITLE_MAX_LEN,
    })));
  safeIgnore(interaction.showModal(modal));
}

export async function handleVotingTitlesModal(interaction: ModalSubmitInteraction): Promise<void> {
  // The modal opens from the shorten prompt, so acking it as an update lets the next
  // prompt or the final result replace that prompt in place.
  await safeDeferUpdate(interaction);
  const parsed = readSessionId(interaction);
  if (!parsed) {
    await safeFollowUpIfSettled(interaction, buildTextReply(VOTING_TITLES_EXPIRED_MESSAGE, true));
    return;
  }
  const { sessionId, ownerId } = parsed;
  const state = await resolveVotingSession(interaction, sessionId, ownerId);
  if (!state) return;

  const overrides = { ...state.overrides };
  for (const item of listPendingTitles(state)) {
    if (!interaction.fields.fields.has(item.key)) continue;
    const value = getModalField(interaction, item.key).trim();
    if (!value || isTitleTooLong(value)) {
      await safeFollowUpIfSettled(interaction, buildTextReply(
        `The ${item.kind} title for "${item.title}" must be 1 to ` +
          `${VOTING_TITLE_MAX_LEN} characters. Nothing was saved; use the button again.`,
        true,
      ));
      return;
    }
    overrides[item.key] = value;
  }

  const nextState: VotingSetupState = { ...state, overrides };
  const pending = listPendingTitles(nextState);
  if (pending.length) {
    votingSetupRegistry.setInMemory(sessionId, nextState);
    votingSetupRegistry.persist({
      sessionId,
      ownerId,
      location: { channelId: interaction.channelId, guildId: interaction.guildId },
      state: nextState,
    });
    await safeEditReply(interaction, {
      ...buildShortenPrompt(sessionId, pending),
      flags: buildComponentsV2EditFlags(),
    });
    return;
  }

  // A second submit while the first is still posting must not post twice.
  if (!votingSetupRegistry.claim(sessionId)) return;
  try {
    // Retire the prompt's button; the result below then lands as a follow-up.
    await safeEditReply(interaction, {
      components: [buildTextContainer("All titles shortened.")],
      flags: buildComponentsV2EditFlags(),
    });
    await postVotingSetup(interaction, nextState);
  } catch (err: unknown) {
    await safeFollowUpIfSettled(interaction, buildErrorReply(
      buildCaughtErrorMessage("Could not generate vote commands", err),
      true,
    ));
  } finally {
    votingSetupRegistry.finish(sessionId);
  }
}

export function calculateNextVoteDate(): Date {
  return calculateNextVoteDateEt();
}
