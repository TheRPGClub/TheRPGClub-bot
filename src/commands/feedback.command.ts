import type {
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags, StringSelectMenuBuilder } from "discord.js";
import {
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { TextInputStyle } from "discord-api-types/v10";
import { Discord, ModalComponent, SelectMenuComponent, Slash } from "discordx";
import {
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { createFeedback, type FeedbackDraft } from "../classes/Feedback.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import {
  FEEDBACK_CUSTOM_ID_PREFIX,
  FEEDBACK_KINDS,
  FEEDBACK_WHERES,
  feedbackKindLabel,
  feedbackKindNoun,
  isFeedbackKind,
  isFeedbackWhere,
  type FeedbackKind,
} from "../config/feedback.js";
import { feedbackBoardUrl } from "../config/website.js";
import { buildFeedbackSubmittedPing } from "../services/FeedbackNotices.js";
import {
  buildComponentsV2Flags,
  buildErrorReply,
  buildMaskedLink,
  buildTextReply,
} from "../functions/ComponentsV2Utils.js";
import { buildSelectRow, buildTextInputLabel } from "../functions/uiComponents.js";
import { buildApiErrorMessage } from "../utilities/ApiErrorUtils.js";
import { logUnexpectedCustomId } from "../utilities/CustomIdUtils.js";

/** The kind picker /feedback (and /suggestion) replies with; stateless, so restart-safe. */
export const FEEDBACK_KIND_SELECT_ID = `${FEEDBACK_CUSTOM_ID_PREFIX}kind`;
/** A kind's modal: `feedback-create:<kind>`. */
const FEEDBACK_MODAL_PREFIX = `${FEEDBACK_CUSTOM_ID_PREFIX}create`;

const FEEDBACK_TITLE_ID = "feedback-title";
const FEEDBACK_DETAILS_ID = "feedback-details";
const FEEDBACK_WHERE_ID = "feedback-where";
const FEEDBACK_WHAT_HAPPENED_ID = "feedback-what-happened";
const FEEDBACK_EXPECTED_ID = "feedback-expected";
const FEEDBACK_STEPS_ID = "feedback-steps";

const FEEDBACK_TITLE_MAX = 256;
const FEEDBACK_TEXT_MAX = 4000;

export function buildFeedbackModalId(kind: FeedbackKind): string {
  return `${FEEDBACK_MODAL_PREFIX}:${kind}`;
}

export function parseFeedbackModalId(customId: string): FeedbackKind | null {
  const prefix = `${FEEDBACK_MODAL_PREFIX}:`;
  if (!customId.startsWith(prefix)) return null;
  const kind = customId.slice(prefix.length);
  return isFeedbackKind(kind) ? kind : null;
}

/** The ephemeral reply with the kind picker. */
export function buildFeedbackKindPrompt(): { components: ContainerBuilder[]; flags: number } {
  const select = new StringSelectMenuBuilder()
    .setCustomId(FEEDBACK_KIND_SELECT_ID)
    .setPlaceholder("What kind of feedback?")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(FEEDBACK_KINDS.map((kind) => ({
      label: kind.label,
      value: kind.value,
      description: kind.description,
    })));
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Feedback\nPick a kind, then fill in the form.",
      ),
    )
    .addActionRowComponents(buildSelectRow(select).toJSON());
  return { components: [container], flags: buildComponentsV2Flags(true) };
}

/**
 * A kind's modal. Feature Requests and Suggestions take a title and details; a Bug Report
 * takes a title, where, what happened, what was expected and optional steps (five inputs,
 * Discord's maximum, so its screenshot is added on the website).
 */
export function buildFeedbackModal(kind: FeedbackKind): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildFeedbackModalId(kind))
    .setTitle(`Submit a ${feedbackKindLabel(kind)}`);
  const title = buildTextInputLabel({
    customId: FEEDBACK_TITLE_ID,
    label: "Title",
    maxLength: FEEDBACK_TITLE_MAX,
  });
  if (kind !== "bug_report") {
    return modal.addLabelComponents(
      title,
      buildTextInputLabel({
        customId: FEEDBACK_DETAILS_ID,
        label: "Details",
        style: TextInputStyle.Paragraph,
        maxLength: FEEDBACK_TEXT_MAX,
      }),
    );
  }
  return modal.addLabelComponents(
    title,
    new LabelBuilder()
      .setLabel("Where")
      .setDescription("Where it happened")
      .setRadioGroupComponent(
        new RadioGroupBuilder()
          .setCustomId(FEEDBACK_WHERE_ID)
          .setRequired(true)
          .setOptions(...FEEDBACK_WHERES.map((where) => ({
            label: where.label,
            value: where.value,
          }))),
      ),
    buildTextInputLabel({
      customId: FEEDBACK_WHAT_HAPPENED_ID,
      label: "What happened",
      style: TextInputStyle.Paragraph,
      maxLength: FEEDBACK_TEXT_MAX,
    }),
    buildTextInputLabel({
      customId: FEEDBACK_EXPECTED_ID,
      label: "What you expected",
      style: TextInputStyle.Paragraph,
      maxLength: FEEDBACK_TEXT_MAX,
    }),
    buildTextInputLabel({
      customId: FEEDBACK_STEPS_ID,
      label: "Steps to reproduce (optional)",
      style: TextInputStyle.Paragraph,
      required: false,
      maxLength: FEEDBACK_TEXT_MAX,
    }),
  );
}

type ModalField = { customId?: string; value?: unknown; values?: unknown };

/** A radio group's chosen value in a submitted modal, or null. */
export function readModalChoice(
  components: readonly unknown[],
  customId: string,
): string | null {
  for (const topLevel of components as Array<{
    components?: ModalField[];
    component?: ModalField;
  } | null>) {
    if (!topLevel || typeof topLevel !== "object") continue;
    const fields = Array.isArray(topLevel.components)
      ? topLevel.components
      : topLevel.component
        ? [topLevel.component]
        : [];
    for (const field of fields) {
      if (!field || field.customId !== customId) continue;
      if (typeof field.value === "string") return field.value;
      if (Array.isArray(field.values) && typeof field.values[0] === "string") {
        return field.values[0];
      }
    }
  }
  return null;
}

function readText(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return sanitizeUserInput(interaction.fields.getTextInputValue(customId), {
      preserveNewlines: true,
    });
  } catch {
    return "";
  }
}

/** The draft a submitted modal describes, or the message saying what is missing. */
export function buildFeedbackDraft(
  kind: FeedbackKind,
  read: (customId: string) => string,
  where: string | null,
): FeedbackDraft | string {
  const title = read(FEEDBACK_TITLE_ID).replace(/\s+/g, " ").trim();
  if (!title) return "Title cannot be empty.";
  if (kind !== "bug_report") {
    const details = read(FEEDBACK_DETAILS_ID);
    if (!details) return "Details cannot be empty.";
    return { kind, title, details };
  }
  if (!isFeedbackWhere(where)) return "Choose where it happened: Bot or Website.";
  const whatHappened = read(FEEDBACK_WHAT_HAPPENED_ID);
  if (!whatHappened) return "What happened cannot be empty.";
  const expected = read(FEEDBACK_EXPECTED_ID);
  if (!expected) return "What you expected cannot be empty.";
  const steps = read(FEEDBACK_STEPS_ID);
  return {
    kind,
    title,
    bug: { where, whatHappened, expected, steps: steps || null },
  };
}

/** The reply once Feedback is filed, linking to it on the Feedback Board. */
export function buildFeedbackFiledText(kind: FeedbackKind, feedbackId: number): string {
  const link = buildMaskedLink("View it on the Feedback Board", feedbackBoardUrl(feedbackId));
  const lines = [`Thanks! Your ${feedbackKindNoun(kind)} #${feedbackId} is filed.`, link];
  if (kind === "bug_report") {
    lines.push("You can add a screenshot there.");
  }
  return lines.join("\n");
}

async function replyWithKindPicker(interaction: CommandInteraction): Promise<void> {
  await safeReply(interaction, buildFeedbackKindPrompt());
}

@Discord()
export class FeedbackCommand {
  @Slash({ description: "Send feedback: a feature request, suggestion or bug report",
    name: "feedback" })
  async feedback(interaction: CommandInteraction): Promise<void> {
    await replyWithKindPicker(interaction);
  }

  /** Kept as an alias of /feedback for now (spec api#498). */
  @Slash({ description: "Send feedback (same as /feedback)", name: "suggestion" })
  async suggestion(interaction: CommandInteraction): Promise<void> {
    await replyWithKindPicker(interaction);
  }

  @SelectMenuComponent({ id: FEEDBACK_KIND_SELECT_ID })
  async pickFeedbackKind(interaction: StringSelectMenuInteraction): Promise<void> {
    const [kind] = interaction.values;
    if (!isFeedbackKind(kind)) {
      logUnexpectedCustomId(interaction.customId);
      await safeReply(interaction, buildTextReply("That kind of feedback is unknown.", true));
      return;
    }
    try {
      await interaction.showModal(buildFeedbackModal(kind));
    } catch {
      await safeReply(interaction, buildTextReply("Unable to open the feedback form.", true));
    }
  }

  @ModalComponent({ id: new RegExp(`^${FEEDBACK_MODAL_PREFIX}:[a-z_]+$`) })
  async submitFeedback(interaction: ModalSubmitInteraction): Promise<void> {
    const kind = parseFeedbackModalId(interaction.customId);
    if (!kind) {
      logUnexpectedCustomId(interaction.customId);
      await safeReply(interaction, buildTextReply("This feedback form is invalid.", true));
      return;
    }
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const draft = buildFeedbackDraft(
      kind,
      (customId) => readText(interaction, customId),
      readModalChoice(interaction.components ?? [], FEEDBACK_WHERE_ID),
    );
    if (typeof draft === "string") {
      await safeReply(interaction, buildTextReply(draft, true));
      return;
    }

    let feedbackId: number;
    try {
      const feedback = await createFeedback(
        draft,
        interaction.user.id,
        interaction.user.username,
      );
      feedbackId = feedback.feedbackId;
    } catch (err: unknown) {
      await safeReply(interaction, buildErrorReply(
        buildApiErrorMessage(`Could not file your ${feedbackKindNoun(kind)}.`, err),
        true,
      ));
      return;
    }

    await safeReply(interaction, buildTextReply(buildFeedbackFiledText(kind, feedbackId), true));

    // The API queues no `feedback_submitted` job for the bot's own (service) creates,
    // so the bot dev is pinged here.
    try {
      const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID);
      if (channel?.isSendable()) {
        await channel.send({ content: buildFeedbackSubmittedPing(interaction.user.username) });
      }
    } catch {
      // ignore notification failures
    }
  }
}
