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
import axios from "axios";
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
import { checkConductorAccess } from "./ConductorAccess.js";
import {
  conductorAnyError,
  conductorApiError,
  conductorDiscordError,
} from "./ConductorErrors.js";
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
  mirrorAttachmentUrl,
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

/** How long one mirror payload attachment may take to download. */
const MIRROR_ATTACHMENT_TIMEOUT_MS = 10_000;

type AnyConductorInteraction = CommandInteraction | ButtonInteraction | ModalSubmitInteraction;

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
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
    })),
  };
}

/** Downloads a mirror post's full payload, kept as text for the parser to read. */
async function downloadMirrorAttachment(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    responseType: "text",
    transformResponse: [(data: string) => data],
    timeout: MIRROR_ATTACHMENT_TIMEOUT_MS,
  });
  return response.data;
}

/** One line per channel, plus the full request and response of any fetch that failed. */
function describeAccessProblems(problems: IChannelAccessProblem[]): string {
  const lines = problems.map((problem) =>
    problem.error === undefined
      ? formatChannelAccessProblem(problem)
      : conductorDiscordError(formatChannelAccessProblem(problem), problem.error));
  return `The conductor cannot run until its channel access is fixed.\n${lines.join("\n")}`;
}

/**
 * Reads back the test and mirror channels and keeps what the bot under test posted.
 * Mirror payload attachments are downloaded only for posts newer than `since`, the
 * step window's start; older posts cannot belong to the step being checked.
 */
async function collectObservations(
  client: Client<true>,
  since: number,
): Promise<IObservedOutput[]> {
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
      const snapshot = snapshotMessage(message);
      const url = message.createdTimestamp > since
        ? mirrorAttachmentUrl(snapshot, context)
        : null;
      if (url) snapshot.mirrorAttachment = await downloadMirrorAttachment(url);
      const output = classifySnapshot(snapshot, context);
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
  interaction: AnyConductorInteraction,
  run: IConductorRun,
): Promise<SendableChannels> {
  const channelId = run.channelId ?? interaction.channelId;
  if (!channelId) throw new Error("The run has no channel to post in.");
  const channel = await interaction.client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${channelId} is not a channel the conductor can post in.`);
  }
  return channel;
}

/** Posts in the run's channel. Every payload keeps mentions off: step text is untrusted. */
async function postToRunChannel(
  interaction: AnyConductorInteraction,
  run: IConductorRun,
  payload: MessageCreateOptions & { allowedMentions: typeof NO_MENTIONS },
): Promise<Message> {
  const channel = await fetchRunChannel(interaction, run);
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
  interaction: AnyConductorInteraction,
  run: IConductorRun,
): Promise<void> {
  const { settings } = getConductorRuntime();
  const sent = await postToRunChannel(
    interaction,
    run,
    buildStepMessage(run, settings.testChannelId),
  );
  run.windowStart = sent.createdTimestamp;
}

/**
 * Posts in the run's channel. A channel the conductor can no longer post in falls back
 * to a follow-up on the interaction, so the handler still answers.
 */
async function postOrNotify(
  interaction: AnyConductorInteraction,
  run: IConductorRun,
  text: string,
  retryRow?: ReturnType<typeof buildReportRetryRow>,
): Promise<void> {
  const components = [buildTextContainer(text), ...(retryRow ? [retryRow] : [])];
  try {
    await postToRunChannel(interaction, run, {
      components,
      flags: buildComponentsV2EditFlags(),
      allowedMentions: NO_MENTIONS,
    });
  } catch (err: unknown) {
    const failure = conductorDiscordError("Could not post in the run's channel", err);
    await safeFollowUpIfSettled(interaction, publicText(`${text}\n\n${failure}`));
  }
}

/** Posts the run's report, or offers a retry button when GitHub refuses it. */
async function postRunReport(
  interaction: AnyConductorInteraction,
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
    await postOrNotify(interaction, run, message, buildReportRetryRow(run.runId));
    return;
  }
  await postOrNotify(interaction, run, `Report for PR #${run.pr} posted: ${url}`);
}

/** Aborts a run, keeping a failed check it was waiting on as that step's result. */
function markAborted(run: IConductorRun): void {
  if (run.pendingResult) run.results.push(run.pendingResult);
  run.pendingResult = null;
  run.status = "aborted";
}

/** Ends a still-running run that a new `/conduct` replaces, reporting what it got to. */
async function supersedeRun(
  interaction: AnyConductorInteraction,
  statePath: string,
): Promise<void> {
  const previous = await loadRun(statePath);
  if (!previous || previous.status !== "running") return;
  markAborted(previous);
  await saveRun(statePath, previous);
  if (previous.results.length) await postRunReport(interaction, previous);
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
    outputs = await collectObservations(interaction.client, run.windowStart);
  } catch (err: unknown) {
    const message = conductorAnyError("Reading back the test channels failed", err);
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
      await sendCurrentStep(interaction, run);
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
  await postRunReport(interaction, run);
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
  await postRunReport(interaction, run);
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
  await postRunReport(interaction, run);
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
    const { settings, github } = getConductorRuntime();

    const accessProblems = await checkConductorChannelAccess(interaction.client, settings);
    if (accessProblems.length) {
      await safeEditReply(interaction, publicText(describeAccessProblems(accessProblems)));
      return;
    }

    let pull;
    try {
      pull = await github.getPullRequest(pr);
    } catch (err: unknown) {
      const message = conductorApiError(`Could not read PR #${pr}`, err);
      await safeEditReply(interaction, publicText(message));
      return;
    }
    if (pull.state !== "open") {
      await safeEditReply(interaction, publicText(`PR #${pr} is ${pull.state}, not open.`));
      return;
    }

    const plan = parseTestPlan(pull.body);
    if (plan.kind === "absent" || plan.kind === "empty") {
      await safeEditReply(
        interaction,
        publicText(`PR #${pr} has no Testing steps, so there is nothing to run.`),
      );
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
      await safeEditReply(interaction, publicText(
        `Cannot parse the Testing section of PR #${pr}: ${plan.reason}\n` +
          `Please test it manually.${posted}`,
      ));
      return;
    }

    await withRunLock(async () => {
      await supersedeRun(interaction, settings.statePath);
      const run: IConductorRun = {
        runId: interaction.id,
        pr,
        headSha: pull.headSha,
        steps: plan.steps,
        channelId: interaction.channelId,
        current: 0,
        windowStart: interaction.createdTimestamp,
        results: [],
        status: "running",
      };
      try {
        await sendCurrentStep(interaction, run);
      } catch (err: unknown) {
        const message = conductorDiscordError("Could not post the script in this channel", err);
        await safeEditReply(interaction, publicText(message));
        return;
      }
      await saveRun(settings.statePath, run);
      await safeEditReply(
        interaction,
        publicText(`Posted step 1 of ${run.steps.length} for PR #${pr} in this channel.` +
          describeUncheckedSteps(run.steps)),
      );
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
