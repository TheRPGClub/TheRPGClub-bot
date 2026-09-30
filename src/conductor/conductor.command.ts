/**
 * The conductor's own slash command and buttons. Loaded only by
 * `src/conductor/main.ts`; the bot's importer never sees this directory.
 */
import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type CommandInteraction,
  type Message,
  type MessageCreateOptions,
  type SendableChannels,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashOption } from "discordx";
import {
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_ACCEPT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
  CONDUCTOR_REPORT_PREFIX,
} from "../config/customIdPrefixes.js";
import {
  buildComponentsV2EditFlags,
  buildErrorReply,
  buildTextContainer,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import {
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  safeReply,
} from "../functions/InteractionUtils.js";
import { buildApiErrorMessage, buildDiscordErrorMessage } from "../utilities/ApiErrorUtils.js";
import { checkConductorAccess } from "./ConductorAccess.js";
import {
  NO_MENTIONS,
  buildFailedStepMessage,
  buildReportRetryRow,
  buildStepMessage,
  buildStepResultText,
  parseRunCustomId,
  parseStepCustomId,
} from "./ConductorMessages.js";
import {
  classifySnapshot,
  judgeStep,
  type IMessageSnapshot,
  type IObservedOutput,
  type IStepResult,
} from "./ConductorObservation.js";
import { buildRunReport, buildUnparseableReport } from "./ConductorReport.js";
import { getConductorRuntime } from "./ConductorRuntime.js";
import { checkStepButton, loadRun, saveRun, type IConductorRun } from "./ConductorState.js";
import { parseTestPlan } from "./TestPlanParser.js";

/** Newest messages read back per channel; a step's window is far smaller. */
const OBSERVATION_FETCH_LIMIT = 100;

type AnyConductorInteraction = CommandInteraction | ButtonInteraction;

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

async function denyAccess(interaction: AnyConductorInteraction): Promise<void> {
  await safeReply(interaction, buildTextReply("This conductor is restricted.", true));
}

function textEdit(content: string): {
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
    createdTimestamp: message.createdTimestamp,
    editedTimestamp: message.editedTimestamp,
    content: message.content,
    interactionUserId: message.interactionMetadata?.user.id ?? null,
    embeds: message.embeds.map((embed) => embed.toJSON()),
    components: message.components.map((component) => component.toJSON()),
  };
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
  interaction: AnyConductorInteraction,
  run: IConductorRun,
): Promise<SendableChannels> {
  const channelId = run.channelId ?? interaction.channelId;
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
 * to a private note to the tester, so the handler still answers.
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
    const failure = buildDiscordErrorMessage("Could not post in the run's channel", err);
    await safeFollowUpIfSettled(interaction, buildErrorReply(`${text}\n\n${failure}`, true));
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
    aborted: run.status === "aborted",
  });
  let url: string;
  try {
    url = await github.postComment(run.pr, report);
  } catch (err: unknown) {
    const message = buildApiErrorMessage(`Posting the report to PR #${run.pr} failed`, err);
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
  await safeFollowUpIfSettled(interaction, buildTextReply(reason, true));
}

/** Loads the run a Check or Accept button belongs to, answering stale presses. */
async function loadStepRun(
  interaction: ButtonInteraction,
  prefix: string,
): Promise<IConductorRun | null> {
  const parsed = parseStepCustomId(interaction.customId, prefix);
  const { settings } = getConductorRuntime();
  const check = checkStepButton(
    await loadRun(settings.statePath),
    parsed?.runId ?? "",
    parsed?.step ?? -1,
  );
  if (check.ok) return check.run;
  await replyStale(interaction, check.reason);
  return null;
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
    const message = buildDiscordErrorMessage("Reading back the test channels failed", err);
    await safeFollowUpIfSettled(interaction, buildErrorReply(message, true));
    return;
  }
  const result = judgeStep(step, outputs, {
    start: run.windowStart,
    end: interaction.createdTimestamp,
  });
  if (result.verdict === "fail") {
    run.pendingResult = result;
    await saveRun(settings.statePath, run);
    await safeEditReply(
      interaction,
      buildFailedStepMessage(run, result, settings.testChannelId),
    );
    return;
  }
  await advanceRun(interaction, run, result);
}

async function acceptFailLocked(interaction: ButtonInteraction): Promise<void> {
  const run = await loadStepRun(interaction, CONDUCTOR_ACCEPT_PREFIX);
  if (!run) return;
  if (!run.pendingResult) {
    await replyStale(interaction, "This step has no failed check to accept.");
    return;
  }
  await advanceRun(interaction, run, run.pendingResult);
}

/** Records the step's result, then posts the next step or finishes the run. */
async function advanceRun(
  interaction: ButtonInteraction,
  run: IConductorRun,
  result: IStepResult,
): Promise<void> {
  const { settings } = getConductorRuntime();
  run.pendingResult = null;
  run.results.push(result);
  run.current += 1;
  await safeEditReply(interaction, textEdit(buildStepResultText(run, result)));

  if (run.current < run.steps.length) {
    try {
      await sendCurrentStep(interaction, run);
    } catch (err: unknown) {
      run.windowStart = interaction.createdTimestamp;
      await saveRun(settings.statePath, run);
      const message = buildDiscordErrorMessage("Could not post the next step", err);
      await safeFollowUpIfSettled(interaction, buildErrorReply(message, true));
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
  await safeEditReply(interaction, textEdit(`Run for PR #${run.pr} aborted.`));
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
  await safeEditReply(interaction, textEdit(`Retrying the report for PR #${run.pr}.`));
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
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const { settings, github } = getConductorRuntime();

    let pull;
    try {
      pull = await github.getPullRequest(pr);
    } catch (err: unknown) {
      const message = buildApiErrorMessage(`Could not read PR #${pr}`, err);
      await safeEditReply(interaction, textEdit(message));
      return;
    }
    if (pull.state !== "open") {
      await safeEditReply(interaction, textEdit(`PR #${pr} is ${pull.state}, not open.`));
      return;
    }

    const plan = parseTestPlan(pull.body);
    if (plan.kind === "absent" || plan.kind === "empty") {
      await safeEditReply(
        interaction,
        textEdit(`PR #${pr} has no Testing steps, so there is nothing to run.`),
      );
      return;
    }
    if (plan.kind === "malformed") {
      let posted: string;
      try {
        const url = await github.postComment(pr, buildUnparseableReport(pr, plan.reason));
        posted = `\nNoted on the PR: ${url}`;
      } catch (err: unknown) {
        posted = `\n${buildApiErrorMessage("Noting it on the PR failed", err)}`;
      }
      await safeEditReply(interaction, textEdit(
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
        const message = buildDiscordErrorMessage("Could not post the script in this channel", err);
        await safeEditReply(interaction, textEdit(message));
        return;
      }
      await saveRun(settings.statePath, run);
      await safeEditReply(
        interaction,
        textEdit(`Posted step 1 of ${run.steps.length} for PR #${pr} in this channel.`),
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
    await safeDeferUpdate(interaction);
    await withRunLock(() => acceptFailLocked(interaction));
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
