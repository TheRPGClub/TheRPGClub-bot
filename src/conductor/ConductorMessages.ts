/**
 * Discord payloads the conductor sends the tester. Step text comes from the PR
 * body, so every payload disables mentions and the command sits in a code block.
 */
import { ButtonStyle, TextInputStyle } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_ACCEPT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
  CONDUCTOR_CONFIRM_PREFIX,
  CONDUCTOR_NOTE_MODAL_PREFIX,
  CONDUCTOR_NOTE_PREFIX,
  CONDUCTOR_REPORT_PREFIX,
} from "../config/customIdPrefixes.js";
import {
  buildComponentsV2EditFlags,
  buildTextContainer,
} from "../functions/ComponentsV2Utils.js";
import type { IStepResult } from "./ConductorObservation.js";
import type { IConductorRun } from "./ConductorState.js";
import { VERDICT_LABELS, fenceFor } from "./ConductorReport.js";

export const NO_MENTIONS = { parse: [] as never[] };

export function buildCheckCustomId(runId: string, stepIndex: number): string {
  return `${CONDUCTOR_CHECK_PREFIX}:${runId}:${stepIndex}`;
}

export function buildAbortCustomId(runId: string): string {
  return `${CONDUCTOR_ABORT_PREFIX}:${runId}`;
}

export function buildReportCustomId(runId: string): string {
  return `${CONDUCTOR_REPORT_PREFIX}:${runId}`;
}

export function buildAcceptCustomId(runId: string, stepIndex: number): string {
  return `${CONDUCTOR_ACCEPT_PREFIX}:${runId}:${stepIndex}`;
}

export function buildConfirmCustomId(runId: string, stepIndex: number): string {
  return `${CONDUCTOR_CONFIRM_PREFIX}:${runId}:${stepIndex}`;
}

export function buildNoteCustomId(runId: string, stepIndex: number): string {
  return `${CONDUCTOR_NOTE_PREFIX}:${runId}:${stepIndex}`;
}

/** `note` only saves the note; `fail` also records the step as failed. */
export type NoteModalMode = "note" | "fail";

export const NOTE_INPUT_ID = "conductor-note-text";
/** Keeps a report with a note on every step inside GitHub's comment cap. */
export const MAX_NOTE_LENGTH = 1000;

export function buildNoteModalCustomId(
  runId: string,
  stepIndex: number,
  mode: NoteModalMode,
): string {
  return `${CONDUCTOR_NOTE_MODAL_PREFIX}:${runId}:${stepIndex}:${mode}`;
}

export function parseNoteModalCustomId(
  customId: string,
): { runId: string; step: number; mode: NoteModalMode } | null {
  const match = new RegExp(`^${CONDUCTOR_NOTE_MODAL_PREFIX}:(\\d+):(\\d+):(note|fail)$`)
    .exec(customId);
  if (!match) return null;
  return { runId: match[1], step: Number(match[2]), mode: match[3] as NoteModalMode };
}

/** Reads `<prefix>:<runId>:<stepIndex>`, the shape of every per-step button ID. */
export function parseStepCustomId(
  customId: string,
  prefix: string,
): { runId: string; step: number } | null {
  const match = new RegExp(`^${prefix}:(\\d+):(\\d+)$`).exec(customId);
  return match ? { runId: match[1], step: Number(match[2]) } : null;
}

export function parseRunCustomId(customId: string, prefix: string): string | null {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(customId);
  return match ? match[1] : null;
}

function describeStep(run: IConductorRun, testChannelId: string): string {
  const step = run.steps[run.current];
  const where = step.ephemeral
    ? "an ephemeral reply, read back from the mirror channel"
    : `a public reply in <#${testChannelId}>`;
  return [
    `**PR #${run.pr}, step ${step.number} of ${run.steps.length}: ${step.label}**`,
    `Run this in <#${testChannelId}>:`,
    fenceFor(step.command),
    `Expected: ${step.expected}`,
    `Output lands as ${where}.`,
    ...noteLines(run),
    "Press **Check** once the output has appeared.",
    "-# Step text comes from the PR body. Run only commands you recognize.",
  ].join("\n");
}

function currentNote(run: IConductorRun): string | undefined {
  return run.notes?.[run.steps[run.current].number];
}

function noteLines(run: IConductorRun): string[] {
  const note = currentNote(run);
  return note ? [`Your note: ${note}`] : [];
}

type StepMessage = {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  flags: number;
  allowedMentions: typeof NO_MENTIONS;
};

function abortButton(runId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildAbortCustomId(runId))
    .setLabel("Abort run")
    .setStyle(ButtonStyle.Secondary);
}

function checkButton(run: IConductorRun, label: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildCheckCustomId(run.runId, run.current))
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
}

function noteButton(run: IConductorRun): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildNoteCustomId(run.runId, run.current))
    .setLabel(currentNote(run) ? "Edit note" : "Add note")
    .setStyle(ButtonStyle.Secondary);
}

/** The public message for the run's current step, with its Check and Abort buttons. */
export function buildStepMessage(run: IConductorRun, testChannelId: string): StepMessage {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    checkButton(run, "Check"),
    noteButton(run),
    abortButton(run.runId),
  );
  return {
    components: [buildTextContainer(describeStep(run, testChannelId)), buttons],
    flags: buildComponentsV2EditFlags(),
    allowedMentions: NO_MENTIONS,
  };
}

/**
 * The same step after a failed check. The step stays open, so output that lands
 * after an early press can still be checked; the window keeps its start.
 */
export function buildFailedStepMessage(
  run: IConductorRun,
  result: IStepResult,
  testChannelId: string,
): StepMessage {
  const text = `${describeStep(run, testChannelId)}\n\n` +
    `**${VERDICT_LABELS[result.verdict]}**: ${result.reason}\n` +
    "Press **Check again** once the output lands, or continue with this step failed.";
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    checkButton(run, "Check again"),
    new ButtonBuilder()
      .setCustomId(buildAcceptCustomId(run.runId, run.current))
      .setLabel("Continue as failed")
      .setStyle(ButtonStyle.Danger),
    noteButton(run),
    abortButton(run.runId),
  );
  return {
    components: [buildTextContainer(text), buttons],
    flags: buildComponentsV2EditFlags(),
    allowedMentions: NO_MENTIONS,
  };
}

/**
 * The step after output arrived that the conductor cannot check: `Expected:` asks
 * for no text. The tester compares it by eye and says whether it matches.
 */
export function buildUnverifiedStepMessage(
  run: IConductorRun,
  result: IStepResult,
  testChannelId: string,
): StepMessage {
  const text = `${describeStep(run, testChannelId)}\n\n` +
    `**${VERDICT_LABELS[result.verdict]}**: ${result.reason}\n` +
    `Observed ${result.observed.length} message(s). Compare them with Expected above.`;
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildConfirmCustomId(run.runId, run.current))
      .setLabel("Looks right")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildAcceptCustomId(run.runId, run.current))
      .setLabel("Doesn't match")
      .setStyle(ButtonStyle.Danger),
    checkButton(run, "Check again"),
    noteButton(run),
    abortButton(run.runId),
  );
  return {
    components: [buildTextContainer(text), buttons],
    flags: buildComponentsV2EditFlags(),
    allowedMentions: NO_MENTIONS,
  };
}

/** The current step as it stands: awaiting a check, a failure, or the tester's eyes. */
export function buildCurrentStepMessage(run: IConductorRun, testChannelId: string): StepMessage {
  const pending = run.pendingResult;
  if (pending?.verdict === "fail") return buildFailedStepMessage(run, pending, testChannelId);
  if (pending?.verdict === "unverified") {
    return buildUnverifiedStepMessage(run, pending, testChannelId);
  }
  return buildStepMessage(run, testChannelId);
}

/**
 * Asks for the tester's note. In `fail` mode it is the reason the step failed and
 * may be left blank; in `note` mode it replaces the step's note.
 */
export function buildNoteModal(run: IConductorRun, mode: NoteModalMode): ModalBuilder {
  const step = run.steps[run.current];
  const input = new TextInputBuilder()
    .setCustomId(NOTE_INPUT_ID)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(mode === "note")
    .setMaxLength(MAX_NOTE_LENGTH);
  const note = currentNote(run);
  if (note) input.setValue(note);
  return new ModalBuilder()
    .setCustomId(buildNoteModalCustomId(run.runId, run.current, mode))
    .setTitle(`Step ${step.number} ${mode === "fail" ? "failed" : "note"}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(mode === "fail" ? "Why or how did it fail?" : "Note for the PR report")
        .setDescription("Posted on the pull request with this step's result.")
        .setTextInputComponent(input),
    );
}

/** Replaces a step message once it is checked, so its buttons cannot fire twice. */
export function buildStepResultText(run: IConductorRun, result: IStepResult): string {
  const step = run.steps.find((entry) => entry.number === result.stepNumber);
  const label = step ? step.label : "";
  const note = run.notes?.[result.stepNumber];
  return [
    `**PR #${run.pr}, step ${result.stepNumber}: ${label}**`,
    `${VERDICT_LABELS[result.verdict]}: ${result.reason}`,
    `Observed ${result.observed.length} message(s) for this step.`,
    ...(note ? [`Your note: ${note}`] : []),
  ].join("\n");
}

/** Offered when posting the report failed, so the tester can retry it later. */
export function buildReportRetryRow(runId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildReportCustomId(runId))
      .setLabel("Post report")
      .setStyle(ButtonStyle.Primary),
  );
}
