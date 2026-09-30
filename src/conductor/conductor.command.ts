/**
 * The conductor's own slash command and buttons. Loaded only by
 * `src/conductor/main.ts`; the bot's importer never sees this directory.
 */
import {
  ApplicationCommandOptionType,
  type ButtonInteraction,
  type Client,
  type CommandInteraction,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type SendableChannels,
} from "discord.js";
import { ButtonComponent, Discord, ModalComponent, Slash, SlashOption } from "discordx";
import {
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_ACCEPT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
  CONDUCTOR_CONFIRM_PREFIX,
  CONDUCTOR_NOTE_PREFIX,
  CONDUCTOR_REPORT_PREFIX,
} from "../config/customIdPrefixes.js";
import {
  buildComponentsV2EditFlags,
  buildTextContainer,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import {
  getModalField,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
} from "../functions/InteractionUtils.js";
import { parsePreviewReadyAnnouncement } from "../config/previewMode.js";
import { checkAnnouncementSource, checkConductorAccess } from "./ConductorAccess.js";
import { conductorApiError, conductorDiscordError } from "./ConductorErrors.js";
import {
  checkConductorChannelAccess,
  formatChannelAccessProblem,
  type IChannelAccessProblem,
} from "./ConductorChannelAccess.js";
import {
  NOTE_INPUT_ID,
  NO_MENTIONS,
  buildCurrentStepMessage,
  buildNoteModal,
  buildReportRetryRow,
  buildStepMessage,
  buildStepResultText,
  parseNoteModalCustomId,
  parseRunCustomId,
  parseStepCustomId,
  type NoteModalMode,
} from "./ConductorMessages.js";
import {
  classifySnapshot,
  confirmedResult,
  failedResult,
  judgeStep,
  type IMessageSnapshot,
  type IObservedOutput,
  type IStepResult,
} from "./ConductorObservation.js";
import { buildRunReport, buildUnparseableReport } from "./ConductorReport.js";
import { getConductorRuntime } from "./ConductorRuntime.js";
import { checkStepButton, loadRun, saveRun, type IConductorRun } from "./ConductorState.js";
import { findUncheckedSteps, parseTestPlan } from "./TestPlanParser.js";

/** Newest messages read back per channel; a step's window is far smaller. */
const OBSERVATION_FETCH_LIMIT = 100;

type AnyConductorInteraction = CommandInteraction | ButtonInteraction | ModalSubmitInteraction;

/**
 * Whatever started or advanced a run: a slash command, a button, a modal, or the preview
 * bot's ready announcement. The run helpers need only this from it.
 */
interface IRunTrigger {
  client: Client<true>;
  /** The interaction's or message's snowflake; a run it starts takes this as its ID. */
  id: string;
  channelId: string | null;
  createdTimestamp: number;
  /** Answers the trigger itself when the run's channel cannot be posted in. */
  notify: (text: string) => Promise<void>;
}

/** Edits the message holding the current step's buttons. */
type StepMessageEditor = (payload: ReturnType<typeof buildStepMessage>) => Promise<unknown>;

function isAllowed(interaction: AnyConductorInteraction): boolean {
  const { settings } = getConductorRuntime();
  const decision = checkConductorAccess(
    {
      userId: interaction.user.id,
      isBot: interaction.user.bot,
      guildId: interaction.guildId,
    },
    {
      allowedUserId: settings.allowedUserId,
      selfId: interaction.client.user.id,
      testGuildId: settings.testGuildId,
    },
  );
  return decision.allowed;
}

function interactionTrigger(interaction: AnyConductorInteraction): IRunTrigger {
  return {
    client: interaction.client,
    id: interaction.id,
    channelId: interaction.channelId,
    createdTimestamp: interaction.createdTimestamp,
    notify: async (text) => {
      await safeFollowUpIfSettled(interaction, publicText(text));
    },
  };
}

/** The one private reply: it answers someone who is not the tester, not the run. */
async function denyAccess(interaction: AnyConductorInteraction): Promise<void> {
  await safeReply(interaction, buildTextReply("This conductor is restricted.", true));
}

/**
 * Every conductor message to the tester is public, in the channel `/conduct` ran in.
 * Error text can echo untrusted step text, so mentions stay off.
 */
function publicText(content: string): {
  components: ReturnType<typeof buildTextContainer>[];
  flags: number;
  allowedMentions: typeof NO_MENTIONS;
} {
  return {
    components: [buildTextContainer(content)],
    flags: buildComponentsV2EditFlags(),
    allowedMentions: NO_MENTIONS,
  };
}

export function snapshotMessage(message: Message): IMessageSnapshot {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    webhookId: message.webhookId ?? null,
    applicationId: message.applicationId ?? null,
    createdTimestamp: message.createdTimestamp,
    editedTimestamp: message.editedTimestamp,
    content: message.content,
    interactionUserId: message.interactionMetadata?.user.id ?? null,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    components: message.components.map((component) => component.toJSON()),
  };
}

/** One line per channel, plus the full request and response of any fetch that failed. */
function describeAccessProblems(problems: IChannelAccessProblem[]): string {
  const lines = problems.map((problem) =>
    problem.error === undefined
      ? formatChannelAccessProblem(problem)
      : conductorDiscordError(formatChannelAccessProblem(problem), problem.error));
  return `The conductor cannot run until its channel access is fixed.\n${lines.join("\n")}`;
}

/** Reads back the test and mirror channels and keeps what the bot under test posted. */
async function collectObservations(client: Client<true>): Promise<IObservedOutput[]> {
  const { settings } = getConductorRuntime();
  const context = {
    selfId: client.user.id,
    allowedUserId: settings.allowedUserId,
    testChannelId: settings.testChannelId,
    mirrorChannelId: settings.mirrorChannelId,
  };
  const channelIds = [...new Set([settings.testChannelId, settings.mirrorChannelId])];
  const outputs: IObservedOutput[] = [];
  for (const channelId of channelIds) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || channel.isDMBased()) continue;
    if (channel.guildId !== settings.testGuildId) continue;
    const messages = await channel.messages.fetch({ limit: OBSERVATION_FETCH_LIMIT });
    for (const message of messages.values()) {
      const output = classifySnapshot(snapshotMessage(message), context);
      if (output) outputs.push(output);
    }
  }
  return outputs;
}

/**
 * The channel `/conduct` ran in. State saved before runs posted publicly has no
 * channel, so it falls back to wherever the button was pressed.
 */
async function fetchRunChannel(
  trigger: IRunTrigger,
  run: IConductorRun,
): Promise<SendableChannels> {
  const channelId = run.channelId ?? trigger.channelId;
  if (!channelId) throw new Error("The run has no channel to post in.");
  const channel = await trigger.client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${channelId} is not a channel the conductor can post in.`);
  }
  return channel;
}

/** Posts in the run's channel. Every payload keeps mentions off: step text is untrusted. */
async function postToRunChannel(
  trigger: IRunTrigger,
  run: IConductorRun,
  payload: MessageCreateOptions & { allowedMentions: typeof NO_MENTIONS },
): Promise<Message> {
  const channel = await fetchRunChannel(trigger, run);
  return channel.send(payload);
}

/**
 * Warns up front about steps the conductor cannot check, so a vague plan is seen
 * before the run and not only in the report.
 */
function describeUncheckedSteps(steps: IConductorRun["steps"]): string {
  const unchecked = findUncheckedSteps(steps);
  if (!unchecked.length) return "";
  return `\nStep(s) ${unchecked.join(", ")} quote no text to look for, so you will be ` +
    "asked to confirm their output by eye. Quote exact text in Expected to check it.";
}

/** Posts the current step and opens its observation window at the post's timestamp. */
async function sendCurrentStep(
  trigger: IRunTrigger,
  run: IConductorRun,
): Promise<void> {
  const { settings } = getConductorRuntime();
  const sent = await postToRunChannel(
    trigger,
    run,
    buildStepMessage(run, settings.testChannelId),
  );
  run.windowStart = sent.createdTimestamp;
}

/**
 * Posts in the run's channel. A channel the conductor can no longer post in falls back
 * to answering the trigger, so the handler still answers.
 */
async function postOrNotify(
  trigger: IRunTrigger,
  run: IConductorRun,
  text: string,
  retryRow?: ReturnType<typeof buildReportRetryRow>,
): Promise<void> {
  const components = [buildTextContainer(text), ...(retryRow ? [retryRow] : [])];
  try {
    await postToRunChannel(trigger, run, {
      components,
      flags: buildComponentsV2EditFlags(),
      allowedMentions: NO_MENTIONS,
    });
  } catch (err: unknown) {
    const failure = conductorDiscordError("Could not post in the run's channel", err);
    await trigger.notify(`${text}\n\n${failure}`);
  }
}

/** Posts the run's report, or offers a retry button when GitHub refuses it. */
async function postRunReport(
  trigger: IRunTrigger,
  run: IConductorRun,
): Promise<void> {
  const { github } = getConductorRuntime();
  const report = buildRunReport({
    pr: run.pr,
    headSha: run.headSha,
    runId: run.runId,
    steps: run.steps,
    results: run.results,
    notes: run.notes,
    aborted: run.status === "aborted",
  });
  let url: string;
  try {
    url = await github.postComment(run.pr, report);
  } catch (err: unknown) {
    const message = conductorApiError(`Posting the report to PR #${run.pr} failed`, err);
    await postOrNotify(trigger, run, message, buildReportRetryRow(run.runId));
    return;
  }
  await postOrNotify(trigger, run, `Report for PR #${run.pr} posted: ${url}`);
}

/** Aborts a run, keeping a failed check it was waiting on as that step's result. */
function markAborted(run: IConductorRun): void {
  if (run.pendingResult) run.results.push(run.pendingResult);
  run.pendingResult = null;
  run.status = "aborted";
}

/** Ends a still-running run that a new `/conduct` replaces, reporting what it got to. */
async function supersedeRun(trigger: IRunTrigger, statePath: string): Promise<void> {
  const previous = await loadRun(statePath);
  if (!previous || previous.status !== "running") return;
  markAborted(previous);
  await saveRun(statePath, previous);
  if (previous.results.length) await postRunReport(trigger, previous);
}

/**
 * Every handler reads, changes, and writes the one run file, so they take turns.
 * Without this, a double-clicked Check judges one step twice and skips the next.
 */
let runQueue: Promise<unknown> = Promise.resolve();

function withRunLock<T>(task: () => Promise<T>): Promise<T> {
  const next = runQueue.then(task, task);
  runQueue = next.catch(() => undefined);
  return next;
}

async function replyStale(interaction: ButtonInteraction, reason: string): Promise<void> {
  await safeFollowUpIfSettled(interaction, publicText(reason));
}

async function replyStaleUnacked(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  reason: string,
): Promise<void> {
  await safeReply(interaction, publicText(reason));
}

/** The running run, when `runId` and `step` name its current step. */
async function loadCurrentStep(
  runId: string,
  step: number,
): Promise<{ ok: true; run: IConductorRun } | { ok: false; reason: string }> {
  const { settings } = getConductorRuntime();
  return checkStepButton(await loadRun(settings.statePath), runId, step);
}

/** Loads the run a per-step button belongs to, answering stale presses. */
async function loadStepRun(
  interaction: ButtonInteraction,
  prefix: string,
): Promise<IConductorRun | null> {
  const parsed = parseStepCustomId(interaction.customId, prefix);
  const check = await loadCurrentStep(parsed?.runId ?? "", parsed?.step ?? -1);
  if (check.ok) return check.run;
  await replyStale(interaction, check.reason);
  return null;
}

/**
 * A modal opened from the step message edits that message directly: its deferred
 * reply is a separate public one. A failed edit is reported there, and the run
 * carries on so its state is still saved.
 */
function modalEditor(interaction: ModalSubmitInteraction): StepMessageEditor {
  return async (payload) => {
    try {
      await interaction.message?.edit(payload);
    } catch (err: unknown) {
      const message = conductorDiscordError("Could not update the step message", err);
      await safeFollowUpIfSettled(interaction, publicText(message));
    }
  };
}

/** A button pressed on the step message edits that message through its deferred update. */
function buttonEditor(interaction: ButtonInteraction): StepMessageEditor {
  return (payload) => safeEditReply(interaction, payload);
}

async function checkStepLocked(interaction: ButtonInteraction): Promise<void> {
  const run = await loadStepRun(interaction, CONDUCTOR_CHECK_PREFIX);
  if (!run) return;
  const { settings } = getConductorRuntime();

  const step = run.steps[run.current];
  let outputs: IObservedOutput[];
  try {
    outputs = await collectObservations(interaction.client);
  } catch (err: unknown) {
    const message = conductorDiscordError("Reading back the test channels failed", err);
    await safeFollowUpIfSettled(interaction, publicText(message));
    return;
  }
  const result = judgeStep(step, outputs, {
    start: run.windowStart,
    end: interaction.createdTimestamp,
  });
  if (result.verdict !== "pass") {
    run.pendingResult = result;
    await saveRun(settings.statePath, run);
    await safeEditReply(interaction, buildCurrentStepMessage(run, settings.testChannelId));
    return;
  }
  await advanceRun(interaction, run, result, buttonEditor(interaction));
}

/** "Looks right": the tester vouches for output the conductor had nothing to check in. */
async function confirmStepLocked(interaction: ButtonInteraction): Promise<void> {
  const run = await loadStepRun(interaction, CONDUCTOR_CONFIRM_PREFIX);
  if (!run) return;
  const pending = run.pendingResult;
  if (pending?.verdict !== "unverified") {
    await replyStale(interaction, "This step has no output waiting for your eyes.");
    return;
  }
  await advanceRun(interaction, run, confirmedResult(pending), buttonEditor(interaction));
}

/**
 * Opens the note modal for the current step. A modal has to be the button's first
 * response, so this checks the run without the lock; the submit checks it again.
 */
async function openNoteModal(
  interaction: ButtonInteraction,
  prefix: string,
  mode: NoteModalMode,
): Promise<void> {
  const parsed = parseStepCustomId(interaction.customId, prefix);
  const check = await loadCurrentStep(parsed?.runId ?? "", parsed?.step ?? -1);
  if (!check.ok) {
    await replyStaleUnacked(interaction, check.reason);
    return;
  }
  if (mode === "fail" && !check.run.pendingResult) {
    await replyStaleUnacked(interaction, "This step has no check to record as failed.");
    return;
  }
  await interaction.showModal(buildNoteModal(check.run, mode));
}

function setNote(run: IConductorRun, note: string): void {
  const stepNumber = run.steps[run.current].number;
  const notes = { ...run.notes };
  if (note) notes[stepNumber] = note;
  else delete notes[stepNumber];
  run.notes = notes;
}

async function submitNoteLocked(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseNoteModalCustomId(interaction.customId);
  const check = await loadCurrentStep(parsed?.runId ?? "", parsed?.step ?? -1);
  if (!parsed || !check.ok) {
    await safeEditReply(interaction, publicText(check.ok ? "Unknown note." : check.reason));
    return;
  }
  const { run } = check;
  const { settings } = getConductorRuntime();
  const note = getModalField(interaction, NOTE_INPUT_ID).trim();
  const editStep = modalEditor(interaction);

  if (parsed.mode === "note") {
    setNote(run, note);
    await saveRun(settings.statePath, run);
    await editStep(buildCurrentStepMessage(run, settings.testChannelId));
    await safeEditReply(interaction, publicText(note ? "Note saved." : "Note cleared."));
    return;
  }

  if (!run.pendingResult) {
    await safeEditReply(interaction, publicText("This step has no check to record as failed."));
    return;
  }
  if (note) setNote(run, note);
  await advanceRun(interaction, run, failedResult(run.pendingResult), editStep);
  await safeEditReply(interaction, publicText(`Step ${parsed.step + 1} recorded as failed.`));
}

/** Records the step's result, then posts the next step or finishes the run. */
async function advanceRun(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  run: IConductorRun,
  result: IStepResult,
  editStep: StepMessageEditor,
): Promise<void> {
  const { settings } = getConductorRuntime();
  run.pendingResult = null;
  run.results.push(result);
  run.current += 1;
  await editStep(publicText(buildStepResultText(run, result)));

  if (run.current < run.steps.length) {
    try {
      await sendCurrentStep(interactionTrigger(interaction), run);
    } catch (err: unknown) {
      run.windowStart = interaction.createdTimestamp;
      await saveRun(settings.statePath, run);
      const message = conductorDiscordError("Could not post the next step", err);
      await safeFollowUpIfSettled(interaction, publicText(message));
      return;
    }
    await saveRun(settings.statePath, run);
    return;
  }

  run.status = "finished";
  await saveRun(settings.statePath, run);
  await postRunReport(interactionTrigger(interaction), run);
}

async function abortRunLocked(interaction: ButtonInteraction): Promise<void> {
  const runId = parseRunCustomId(interaction.customId, CONDUCTOR_ABORT_PREFIX);
  const { settings } = getConductorRuntime();
  const run = await loadRun(settings.statePath);
  if (!run || run.runId !== runId || run.status !== "running") {
    await replyStale(interaction, "This run is no longer active.");
    return;
  }
  markAborted(run);
  await saveRun(settings.statePath, run);
  await safeEditReply(interaction, publicText(`Run for PR #${run.pr} aborted.`));
  await postRunReport(interactionTrigger(interaction), run);
}

async function retryReportLocked(interaction: ButtonInteraction): Promise<void> {
  const runId = parseRunCustomId(interaction.customId, CONDUCTOR_REPORT_PREFIX);
  const { settings } = getConductorRuntime();
  const run = await loadRun(settings.statePath);
  if (!run || run.runId !== runId || run.status === "running") {
    await replyStale(interaction, "That run's report is not available.");
    return;
  }
  await safeEditReply(interaction, publicText(`Retrying the report for PR #${run.pr}.`));
  await postRunReport(interactionTrigger(interaction), run);
}

/**
 * Checks the PR and starts its run in the trigger's channel, as `/conduct` does. An
 * announced start carries the sha the preview was built from: a stale one, or a PR that
 * already has a run going, starts nothing. `answer` tells whoever started it how it went.
 */
async function startRun(
  trigger: IRunTrigger,
  pr: number,
  answer: (text: string) => Promise<void>,
  announcedSha?: string,
): Promise<void> {
  const { settings, github } = getConductorRuntime();

  const accessProblems = await checkConductorChannelAccess(trigger.client, settings);
  if (accessProblems.length) {
    await answer(describeAccessProblems(accessProblems));
    return;
  }

  let pull;
  try {
    pull = await github.getPullRequest(pr);
  } catch (err: unknown) {
    await answer(conductorApiError(`Could not read PR #${pr}`, err));
    return;
  }
  if (pull.state !== "open") {
    await answer(`PR #${pr} is ${pull.state}, not open.`);
    return;
  }
  if (announcedSha !== undefined && pull.headSha !== announcedSha) {
    await answer(
      `The preview of PR #${pr} was built from ${announcedSha}, but the PR's head is now ` +
        `${pull.headSha}, so no run started. Redeploy it to test the new head.`,
    );
    return;
  }

  const plan = parseTestPlan(pull.body);
  if (plan.kind === "absent" || plan.kind === "empty") {
    await answer(`PR #${pr} has no Testing steps, so there is nothing to run.`);
    return;
  }
  if (plan.kind === "malformed") {
    let posted: string;
    try {
      const url = await github.postComment(pr, buildUnparseableReport(pr, plan.reason));
      posted = `\nNoted on the PR: ${url}`;
    } catch (err: unknown) {
      posted = `\n${conductorApiError("Noting it on the PR failed", err)}`;
    }
    await answer(
      `Cannot parse the Testing section of PR #${pr}: ${plan.reason}\n` +
        `Please test it manually.${posted}`,
    );
    return;
  }

  await withRunLock(async () => {
    if (announcedSha !== undefined) {
      const current = await loadRun(settings.statePath);
      // A new head supersedes the run below: its preview has just been replaced.
      if (current?.status === "running" && current.pr === pr && current.headSha === pull.headSha) {
        await answer(`PR #${pr} already has a run in progress, so no second run started.`);
        return;
      }
    }
    await supersedeRun(trigger, settings.statePath);
    const run: IConductorRun = {
      runId: trigger.id,
      pr,
      headSha: pull.headSha,
      steps: plan.steps,
      channelId: trigger.channelId ?? undefined,
      current: 0,
      windowStart: trigger.createdTimestamp,
      results: [],
      status: "running",
    };
    try {
      await sendCurrentStep(trigger, run);
    } catch (err: unknown) {
      await answer(conductorDiscordError("Could not post the script in this channel", err));
      return;
    }
    await saveRun(settings.statePath, run);
    const lead = announcedSha === undefined ? "" : `The preview of PR #${pr} is ready. `;
    await answer(
      `${lead}Posted step 1 of ${run.steps.length} for PR #${pr} in this channel.` +
        describeUncheckedSteps(run.steps),
    );
  });
}

/**
 * A message trigger answers in its own channel. When that fails too, the log is the only
 * place left to say so.
 */
function messageTrigger(message: Message<true>): IRunTrigger {
  return {
    client: message.client,
    id: message.id,
    channelId: message.channelId,
    createdTimestamp: message.createdTimestamp,
    notify: async (text) => {
      try {
        await message.channel.send(publicText(text));
      } catch (err: unknown) {
        console.error(`[conductor] could not answer in ${message.channelId}: ${text}`, err);
      }
    },
  };
}

/**
 * Starts a run when the preview bot announces it is ready, as if `/conduct pr:<n>` had
 * been run in the dev channel. Any other message, or the same text from anyone else,
 * does nothing.
 */
export async function startRunFromAnnouncement(message: Message): Promise<void> {
  const announcement = parsePreviewReadyAnnouncement(message.content);
  if (!announcement || !message.inGuild()) return;
  const { settings } = getConductorRuntime();
  const decision = checkAnnouncementSource(
    {
      authorId: message.author.id,
      webhookId: message.webhookId,
      guildId: message.guildId,
      channelId: message.channelId,
    },
    {
      previewBotId: settings.previewBotId,
      selfId: message.client.user.id,
      testGuildId: settings.testGuildId,
      testChannelId: settings.testChannelId,
    },
  );
  if (!decision.allowed) {
    console.log(`[conductor] ignored a ready announcement: ${decision.reason}`);
    return;
  }
  const trigger = messageTrigger(message);
  await startRun(trigger, announcement.pr, trigger.notify, announcement.sha);
}

@Discord()
export class ConductorCommand {
  @Slash({ name: "conduct", description: "Run a pull request's Testing steps" })
  async conduct(
    @SlashOption({
      description: "Pull request number",
      name: "pr",
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
    })
    pr: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferReply(interaction);
    await startRun(interactionTrigger(interaction), pr, async (text) => {
      await safeEditReply(interaction, publicText(text));
    });
  }

  @ButtonComponent({ id: /^conductor-check-v1:\d+:\d+$/ })
  async checkStep(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferUpdate(interaction);
    await withRunLock(() => checkStepLocked(interaction));
  }

  @ButtonComponent({ id: /^conductor-accept-v1:\d+:\d+$/ })
  async acceptFail(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await openNoteModal(interaction, CONDUCTOR_ACCEPT_PREFIX, "fail");
  }

  @ButtonComponent({ id: /^conductor-confirm-v1:\d+:\d+$/ })
  async confirmStep(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferUpdate(interaction);
    await withRunLock(() => confirmStepLocked(interaction));
  }

  @ButtonComponent({ id: /^conductor-note-v1:\d+:\d+$/ })
  async addNote(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await openNoteModal(interaction, CONDUCTOR_NOTE_PREFIX, "note");
  }

  @ModalComponent({ id: /^conductor-note-modal-v1:\d+:\d+:(?:note|fail)$/ })
  async submitNote(interaction: ModalSubmitInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferReply(interaction);
    await withRunLock(() => submitNoteLocked(interaction));
  }

  @ButtonComponent({ id: /^conductor-abort-v1:\d+$/ })
  async abortRun(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferUpdate(interaction);
    await withRunLock(() => abortRunLocked(interaction));
  }

  @ButtonComponent({ id: /^conductor-report-v1:\d+$/ })
  async retryReport(interaction: ButtonInteraction): Promise<void> {
    if (!isAllowed(interaction)) {
      await denyAccess(interaction);
      return;
    }
    await safeDeferUpdate(interaction);
    await withRunLock(() => retryReportLocked(interaction));
  }
}
