import type { ButtonInteraction, CommandInteraction } from "discord.js";
import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import {
  CheckboxGroupBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { TextInputStyle } from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
} from "discordx";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  createSuggestion,
  getSuggestionById,
  listSuggestions,
  countSuggestions,
} from "../classes/Suggestion.js";
import {
  deleteSuggestionReviewSession,
  getSuggestionReviewSession,
  type ISuggestionReviewSession,
} from "../classes/SuggestionReviewSession.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import {
  DEFAULT_SUGGESTION_TARGET_REPO,
  isSuggestionTargetRepo,
  SUGGESTION_TARGET_REPOS,
  type SuggestionTargetRepo,
} from "../config/suggestions.js";
import {
  reviewSuggestion,
  SUGGESTION_REVIEW_API,
} from "../services/SuggestionReviewService.js";
import { buildSuggestionSubmittedPing } from "../services/SuggestionNotices.js";
import {
  buildComponentsV2Flags,
  buildTextContainer,
  buildErrorReply,
  buildTextReply,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { formatStructuredLog, logError, logInfo, logWarn } from "../utilities/LogUtils.js";
import { isPositiveInt, truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { parseCustomIdSegments } from "../utilities/CustomIdUtils.js";
import { buildTextInputLabel } from "../functions/uiComponents.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { commandMention } from "../services/CommandMentionService.js";

const SUGGESTION_CREATE_MODAL_ID = "suggestion-create-modal";
const SUGGESTION_CREATE_TITLE_ID = "suggestion-create-title";
const SUGGESTION_CREATE_DETAILS_ID = "suggestion-create-details";
const SUGGESTION_CREATE_TYPE_ID = "suggestion-create-type";
const SUGGESTION_LABELS = ["New Feature", "Improvement", "Bug"] as const;
type SuggestionLabel = (typeof SUGGESTION_LABELS)[number];
const SUGGESTION_REVIEW_PREFIX = "suggestion-review";
const SUGGESTION_REVIEW_DECISION_MODAL_PREFIX = "suggestion-review-decision";
const SUGGESTION_REVIEW_SUMMARY_ID = "suggestion-review-summary";
const SUGGESTION_REVIEW_DECISION_ID = "suggestion-review-decision-choice";
const SUGGESTION_REVIEW_REASON_ID = "suggestion-review-decision-reason";
const SUGGESTION_REVIEW_REPO_ID = "suggestion-review-decision-repo";
type SuggestionReviewSession = ISuggestionReviewSession;
const MAX_MODAL_TEXT_INPUT_VALUE = 4000;

function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logSuggestion(
  level: "info" | "warn" | "error",
  event: string,
  meta: Record<string, unknown> = {},
): void {
  const line = formatStructuredLog({ event, ...meta });
  if (level === "error") {
    logError("suggestion", line);
    return;
  }
  if (level === "warn") {
    logWarn("suggestion", line);
    return;
  }
  logInfo("suggestion", line);
}

async function loadSuggestionReviewSession(
  sessionId: string,
  reviewerId: string,
): Promise<SuggestionReviewSession | null> {
  const session = await getSuggestionReviewSession(sessionId);
  if (!session) return null;
  if (session.reviewerId !== reviewerId) return null;
  return session;
}

function parseSuggestionReviewActionId(
  customId: string,
): { action: string; sessionId: string; reviewerId: string } | null {
  if (!customId.startsWith(`${SUGGESTION_REVIEW_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 3);
  if (!segs) return null;
  const [action, sessionId, reviewerId] = segs;
  return action && sessionId && reviewerId ? { action, sessionId, reviewerId } : null;
}

function buildSuggestionReviewDecisionModalId(
  reviewerId: string,
  suggestionId: number,
): string {
  return `${SUGGESTION_REVIEW_DECISION_MODAL_PREFIX}:${reviewerId}:${suggestionId}`;
}

function parseSuggestionReviewDecisionModalId(
  customId: string,
): { reviewerId: string; suggestionId: number } | null {
  if (!customId.startsWith(`${SUGGESTION_REVIEW_DECISION_MODAL_PREFIX}:`)) return null;
  const segs = parseCustomIdSegments(customId, 2);
  if (!segs) return null;
  const [reviewerId, suggestionIdStr] = segs;
  const suggestionId = Number(suggestionIdStr);
  if (!isPositiveInt(suggestionId)) return null;
  return reviewerId ? { reviewerId, suggestionId } : null;
}

export function buildSuggestionReviewDecisionModal(
  customId: string,
  summaryText: string,
): ModalBuilder {
  const summaryValue = truncateWithEllipsis(summaryText, MAX_MODAL_TEXT_INPUT_VALUE);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Suggestion Review Decision")
    .addLabelComponents(
      buildTextInputLabel({
        customId: SUGGESTION_REVIEW_SUMMARY_ID,
        label: "Suggestion Review",
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: MAX_MODAL_TEXT_INPUT_VALUE,
        value: summaryValue,
      }),
      new LabelBuilder()
        .setLabel("Review Decision")
        .setDescription("Choose one action")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(SUGGESTION_REVIEW_DECISION_ID)
            .setRequired(true)
            .setOptions(
              {
                label: "Accept",
                value: "accept",
                description: "Open a GitHub issue in the repository below",
              },
              {
                label: "Reject",
                value: "reject",
                description: "Reject and notify the suggestion author",
              },
            ),
        ),
      new LabelBuilder()
        .setLabel("Repository (used when Accept)")
        .setDescription("Where the GitHub issue is opened")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId(SUGGESTION_REVIEW_REPO_ID)
            .setRequired(true)
            .setOptions(
              ...SUGGESTION_TARGET_REPOS.map((repo) => ({
                label: repo.label,
                value: repo.value,
                description: repo.description,
                default: repo.value === DEFAULT_SUGGESTION_TARGET_REPO,
              })),
            ),
        ),
      buildTextInputLabel({
        customId: SUGGESTION_REVIEW_REASON_ID,
        label: "Rejection reason (required when Reject)",
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 1000,
      }),
    );
}

export function buildSuggestionCreateModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(SUGGESTION_CREATE_MODAL_ID)
    .setTitle("Submit Suggestion")
    .addLabelComponents(
      buildTextInputLabel({
        customId: SUGGESTION_CREATE_TITLE_ID,
        label: "Title",
        maxLength: 256,
      }),
      buildTextInputLabel({
        customId: SUGGESTION_CREATE_DETAILS_ID,
        label: "Description",
        style: TextInputStyle.Paragraph,
        maxLength: 4000,
      }),
      new LabelBuilder()
        .setLabel("Suggestion Type(s)")
        .setDescription("Select one or more suggestion types")
        .setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId(SUGGESTION_CREATE_TYPE_ID)
            .setMinValues(1)
            .setMaxValues(SUGGESTION_LABELS.length)
            .setOptions(
              ...SUGGESTION_LABELS.map((typeLabel) => ({
                label: typeLabel,
                value: typeLabel,
              })),
            ),
        ),
    );
}

async function openSuggestionReviewDecisionModal(
  interaction: ButtonInteraction,
  reviewerId: string,
  suggestionId: number,
  summaryText: string,
): Promise<void> {
  const customId = buildSuggestionReviewDecisionModalId(reviewerId, suggestionId);
  logSuggestion("info", "suggestion.review_modal.open_attempt", {
    feature: "suggestion",
    flow: "review-decision",
    userId: interaction.user.id,
    customId,
    reason: `suggestionId=${suggestionId} summaryLen=${summaryText.length}`,
  });

  try {
    await interaction.showModal(buildSuggestionReviewDecisionModal(customId, summaryText));
    logSuggestion("info", "suggestion.review_modal.open_success", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId,
    });
  } catch (error: unknown) {
    logSuggestion("error", "suggestion.review_modal.open_failed", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId,
      error: formatErrorForLog(error),
    });
    throw error;
  }
}

function formatSuggestionTimestampPlain(date: Date | null | undefined): string {
  if (!date) return "Unknown";
  return `<t:${toUnixTimestamp(date)}:F>`;
}

function buildSuggestionReviewSummaryText(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
  index: number,
  total: number,
): string {
  if (!suggestion) {
    return "No pending suggestions found.";
  }

  const labels = suggestion.labels ? suggestion.labels : "None";
  const authorLabel = suggestion.createdByName
    ? `${suggestion.createdByName} (${suggestion.createdBy ?? "Unknown"})`
    : (suggestion.createdBy ?? "Unknown");
  const details = suggestion.details ?? "No details provided.";

  return [
    `Suggestion: #${suggestion.suggestionId} - ${suggestion.title}`,
    `Labels: ${labels}`,
    `Submitted by: ${authorLabel}`,
    `Submitted: ${formatSuggestionTimestampPlain(suggestion.createdAt)}`,
    `Position: ${index + 1} of ${total}`,
    "",
    "Details:",
    details,
  ].join("\n");
}

function extractReviewDecisionFromInteraction(
  interaction: ModalSubmitInteraction,
): { decision: string | null; targetRepo: string | null; reason: string } {

  const components = (interaction.components ?? []) as Array<{
    type?: number;
    components?: Array<{ customId?: string; value?: unknown; values?: unknown }>;
    component?: { customId?: string; value?: unknown; values?: unknown };
  }>;

  const flatFields: Array<{ customId?: string; value?: unknown; values?: unknown }> = [];
  for (const topLevel of components) {
    if (!topLevel || typeof topLevel !== "object") {
      continue;
    }
    if (Array.isArray(topLevel.components)) {
      flatFields.push(...topLevel.components);
      continue;
    }
    if (topLevel.component && typeof topLevel.component === "object") {
      flatFields.push(topLevel.component);
    }
  }

  const radioValue = (customId: string): string | null => {
    for (const field of flatFields) {
      if (!field || field.customId !== customId) continue;
      if (typeof field.value === "string") return field.value;
      if (Array.isArray(field.values) && typeof field.values[0] === "string") {
        return field.values[0];
      }
    }
    return null;
  };
  const decision = radioValue(SUGGESTION_REVIEW_DECISION_ID);
  const targetRepo = radioValue(SUGGESTION_REVIEW_REPO_ID);

  let reason: string;
  try {
    const rawReason = interaction.fields.getTextInputValue(SUGGESTION_REVIEW_REASON_ID);
    reason = sanitizeUserInput(rawReason, { preserveNewlines: true });
  } catch {
    reason = "";
  }

  return { decision, targetRepo, reason };
}

function buildSuggestionReviewContainer(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
  index: number,
  total: number,
  totalCount: number,
): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Suggestion Review"),
  );

  if (!suggestion) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No pending suggestions found."),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(buildSuggestionReviewSummaryText(suggestion, index, total), 1000),
    ),
  );

  if (totalCount > total) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(`Showing ${total} of ${totalCount} pending suggestions.`, 1000),
      ),
    );
  }
  return container;
}

async function getCurrentSuggestionForReview(
  session: SuggestionReviewSession,
): Promise<{
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>;
  index: number;
  total: number;
}> {
  while (session.index < session.suggestionIds.length) {
    const suggestionId = session.suggestionIds[session.index];
    const suggestion = await getSuggestionById(suggestionId);
    // Reviewed and withdrawn suggestions are kept now, so skip them like deleted ones.
    if (suggestion?.status === "pending") {
      return {
        suggestion,
        index: session.index,
        total: session.suggestionIds.length,
      };
    }
    session.suggestionIds.splice(session.index, 1);
  }

  return {
    suggestion: null,
    index: Math.max(0, session.suggestionIds.length - 1),
    total: session.suggestionIds.length,
  };
}

async function openSuggestionCreateModal(interaction: CommandInteraction): Promise<void> {
  await interaction.showModal(buildSuggestionCreateModal());
}

function extractSuggestionCreateTypeValuesFromInteraction(
  interaction: ModalSubmitInteraction,
): string[] {
  const components = (interaction.components ?? []) as Array<{
    type?: number;
    components?: Array<{ customId?: string; values?: unknown; value?: unknown }>;
    component?: { customId?: string; values?: unknown; value?: unknown };
  }>;

  const values: string[] = [];
  for (const topLevel of components) {
    if (!topLevel || typeof topLevel !== "object") continue;
    const children = Array.isArray(topLevel.components)
      ? topLevel.components
      : topLevel.component
        ? [topLevel.component]
        : [];
    for (const child of children) {
      if (!child || child.customId !== SUGGESTION_CREATE_TYPE_ID) continue;
      if (Array.isArray(child.values)) {
        child.values.forEach((entry) => {
          if (typeof entry === "string") {
            values.push(entry);
          }
        });
      } else if (typeof child.value === "string") {
        values.push(child.value);
      }
    }
  }
  return values;
}

function parseSuggestionLabels(values: readonly string[]): SuggestionLabel[] {
  const validValues = new Set(SUGGESTION_LABELS);
  return values
    .filter((value): value is SuggestionLabel => validValues.has(value as SuggestionLabel))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

@Discord()
export class SuggestionCommand {
  @Slash({ description: "Submit a bot suggestion", name: "suggestion" })
  async suggestion(interaction: CommandInteraction): Promise<void> {
    await openSuggestionCreateModal(interaction).catch(async (error: unknown) => {
      logSuggestion("error", "suggestion.create_modal.open_failed", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: SUGGESTION_CREATE_MODAL_ID,
        error: formatErrorForLog(error),
      });
      await safeReply(interaction, buildTextReply("Unable to open the suggestion form.", true));
    });
  }

  @ModalComponent({ id: /^suggestion-create-modal$/ })
  async submitSuggestionCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(SUGGESTION_CREATE_TITLE_ID);
    const rawDetails = interaction.fields.getTextInputValue(SUGGESTION_CREATE_DETAILS_ID);
    const selectedLabels = parseSuggestionLabels(
      extractSuggestionCreateTypeValuesFromInteraction(interaction),
    );
    const trimmedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, buildTextReply("Title cannot be empty.", true));
      return;
    }

    const trimmedDetails = sanitizeUserInput(rawDetails, { preserveNewlines: true });
    if (!trimmedDetails) {
      await safeReply(interaction, buildTextReply("Details cannot be empty.", true));
      return;
    }

    if (selectedLabels.length === 0) {
      await safeReply(interaction, buildTextReply("Select at least one suggestion type.", true));
      return;
    }

    const suggestion = await createSuggestion(
      trimmedTitle,
      trimmedDetails,
      selectedLabels.join(", "),
      interaction.user.id,
      interaction.user.username,
    );

    await safeReply(interaction, buildTextReply(`Thanks! Suggestion #${suggestion.suggestionId} submitted.`, true));

    // The API queues no `suggestion_submitted` job for the bot's own (service) creates,
    // so the bot dev is pinged here.
    try {
      const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID);
      if (channel?.isSendable()) {
        await channel.send({
          content: buildSuggestionSubmittedPing(interaction.user.username),
        });
      }
    } catch {
      // ignore notification failures
    }
  }

  @ButtonComponent({ id: /^todo-review-suggestions$/ })
  async reviewSuggestionsFromTodo(interaction: ButtonInteraction): Promise<void> {
    logSuggestion("info", "suggestion.review_button.clicked", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId: interaction.customId,
      reason: `guildId=${interaction.guildId ?? "none"} channelId=${interaction.channelId ?? "none"}`,
    });

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isBotDev = interaction.user.id === BOT_DEV_PING_USER_ID;
    if (!isOwner && !isBotDev) {
      logSuggestion("warn", "suggestion.review_button.denied", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: "not_owner_or_bot_dev",
      });
      await safeReply(interaction, buildTextReply("Only the server owner or bot dev can review suggestions.", true));
      return;
    }

    const [suggestions, totalCount] = await Promise.all([
      listSuggestions(1),
      countSuggestions(),
    ]);

    if (!suggestions.length) {
      logSuggestion("info", "suggestion.review_button.no_pending", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
      });
      await safeReply(interaction, buildTextReply("No pending suggestions to review.", true));
      return;
    }

    const currentSuggestion = suggestions[0];
    if (!currentSuggestion) {
      logSuggestion("warn", "suggestion.review_button.missing_first", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: `totalCount=${totalCount}`,
      });
      await safeReply(interaction, buildTextReply("No pending suggestions to review.", true));
      return;
    }

    const summaryText = buildSuggestionReviewSummaryText(
      currentSuggestion,
      0,
      Math.max(totalCount, 1),
    );

    try {
      await openSuggestionReviewDecisionModal(
        interaction,
        interaction.user.id,
        currentSuggestion.suggestionId,
        summaryText,
      );
    } catch (error: unknown) {
      logSuggestion("error", "suggestion.review_button.open_failed", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: `suggestionId=${currentSuggestion.suggestionId}`,
        error: formatErrorForLog(error),
      });
      await safeReply(interaction, buildTextReply("Unable to open the review decision form.", true));
    }
  }

  // Retired: approving needs a repository choice now, which only the review form offers.
  // Kept so a button left on an old message answers instead of failing.
  @ButtonComponent({ id: /^suggestion-approve:\d+$/ })
  async approveSuggestion(interaction: ButtonInteraction): Promise<void> {
    await safeReply(interaction, buildTextReply(
      `This button is retired. Review suggestions from ${commandMention("todo")} ` +
        "with Review Suggestions.",
      true,
    ));
  }

  @ButtonComponent({ id: /^suggestion-review:.+$/ })
  async reviewSuggestionAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseSuggestionReviewActionId(interaction.customId);
    if (!parsed) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    if (parsed.reviewerId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This review prompt isn't for you.", true));
      return;
    }

    const session = await loadSuggestionReviewSession(parsed.sessionId, parsed.reviewerId);
    if (!session) {
      const container = buildTextContainer(
          `This review session is no longer available. Start again from ${commandMention("todo")}.`,
        );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "cancel") {
      await deleteSuggestionReviewSession(parsed.sessionId);
      const container = buildTextContainer("Suggestion review closed.");
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "decide") {
      const current = await getCurrentSuggestionForReview(session);
      if (!current.suggestion) {
        const container = buildSuggestionReviewContainer(null, 0, 0, session.totalCount);
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      try {
        await openSuggestionReviewDecisionModal(
          interaction,
          parsed.reviewerId,
          current.suggestion.suggestionId,
          buildSuggestionReviewSummaryText(
            current.suggestion,
            current.index,
            Math.max(current.total, 1),
          ),
        );
      } catch (error: unknown) {
        logSuggestion("error", "suggestion.review_action.open_failed", {
          feature: "suggestion",
          flow: "review-decision",
          userId: interaction.user.id,
          customId: interaction.customId,
          reason: `suggestionId=${current.suggestion.suggestionId}`,
          error: formatErrorForLog(error),
        });
        await safeReply(interaction, buildTextReply("Unable to open the review decision form.", true));
      }
      return;
    }
  }

  @ModalComponent({ id: /^suggestion-review-decision:.+:\d+$/ })
  async submitSuggestionReviewDecision(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseSuggestionReviewDecisionModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, buildTextReply("This review decision form expired.", true));
      return;
    }

    if (parsed.reviewerId !== interaction.user.id) {
      await safeReply(interaction, buildTextReply("This review prompt isn't for you.", true));
      return;
    }

    const extracted = extractReviewDecisionFromInteraction(interaction);
    const decision = extracted.decision;
    if (decision !== "accept" && decision !== "reject") {
      await safeReply(interaction, buildTextReply("Select Accept or Reject.", true));
      return;
    }

    const reason = extracted.reason;

    if (decision === "reject" && !reason) {
      await safeReply(interaction, buildTextReply("Rejection reason cannot be empty when Reject is selected.", true));
      return;
    }

    const targetRepo: SuggestionTargetRepo = isSuggestionTargetRepo(extracted.targetRepo)
      ? extracted.targetRepo
      : DEFAULT_SUGGESTION_TARGET_REPO;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    // The API queues the `suggestion_outcome` job for this review too, and that job is
    // what tells the author, so nothing is posted here (it would post twice).
    const result = await reviewSuggestion(
      SUGGESTION_REVIEW_API,
      decision === "accept"
        ? {
          decision,
          suggestionId: parsed.suggestionId,
          reviewerId: interaction.user.id,
          targetRepo,
        }
        : {
          decision,
          suggestionId: parsed.suggestionId,
          reviewerId: interaction.user.id,
          reason,
        },
    );
    if (!result.ok) {
      await safeReply(interaction, buildErrorReply(result.message, true));
      return;
    }

    const remainingCount = await countSuggestions();
    await safeReply(interaction, buildTextReply(remainingCount > 0
        ? `${result.message}\n${remainingCount} suggestion(s) remain. ` +
          `Use Review Suggestions again from ${commandMention("todo")}.`
        : `${result.message}\nNo pending suggestions remain.`, true));
  }

}
