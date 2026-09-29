/**
 * Discord payloads the conductor sends the tester. Step text comes from the PR
 * body, so every payload disables mentions and the command sits in a code block.
 */
import { ButtonStyle } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ContainerBuilder } from "@discordjs/builders";
import {
  CONDUCTOR_ABORT_PREFIX,
  CONDUCTOR_CHECK_PREFIX,
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

export function parseCheckCustomId(customId: string): { runId: string; step: number } | null {
  const match = new RegExp(`^${CONDUCTOR_CHECK_PREFIX}:(\\d+):(\\d+)$`).exec(customId);
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
    "Press **Check** once the output has appeared.",
    "-# Step text comes from the PR body. Run only commands you recognize.",
  ].join("\n");
}

/** The DM for the run's current step, with its Check and Abort buttons. */
export function buildStepMessage(run: IConductorRun, testChannelId: string): {
  components: (ContainerBuilder | ActionRowBuilder<ButtonBuilder>)[];
  flags: number;
  allowedMentions: typeof NO_MENTIONS;
} {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCheckCustomId(run.runId, run.current))
      .setLabel("Check")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildAbortCustomId(run.runId))
      .setLabel("Abort run")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    components: [buildTextContainer(describeStep(run, testChannelId)), buttons],
    flags: buildComponentsV2EditFlags(),
    allowedMentions: NO_MENTIONS,
  };
}

/** Replaces a step DM once it is checked, so its buttons cannot fire twice. */
export function buildStepResultText(run: IConductorRun, result: IStepResult): string {
  const step = run.steps.find((entry) => entry.number === result.stepNumber);
  const label = step ? step.label : "";
  return [
    `**PR #${run.pr}, step ${result.stepNumber}: ${label}**`,
    `${VERDICT_LABELS[result.verdict]}: ${result.reason}`,
    `Observed ${result.observed.length} message(s) for this step.`,
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
