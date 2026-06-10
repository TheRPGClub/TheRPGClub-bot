import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
  type CommandInteraction,
  userMention,
} from "discord.js";
import {
  extractErrorMessage,
  safeDeferUpdate,
  safeReply,
} from "../../functions/InteractionUtils.js";
import { buildTextReply } from "../../functions/ComponentsV2Utils.js";
import { type PromptChoiceOption } from "./admin.types.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";

export function buildChoiceRows(
  customIdPrefix: string,
  options: PromptChoiceOption[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((opt) =>
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}:${opt.value}`)
          .setLabel(opt.label)
          .setStyle(opt.style ?? ButtonStyle.Secondary),
      ),
    );
    rows.push(row);
  }
  return rows;
}

export function buildNumberChoiceOptions(min: number, max: number): PromptChoiceOption[] {
  const options: PromptChoiceOption[] = [];
  for (let i = min; i <= max; i++) {
    options.push({ label: String(i), value: String(i), style: ButtonStyle.Primary });
  }
  return options;
}

export function addCancelOption(options: PromptChoiceOption[]): PromptChoiceOption[] {
  return [...options, { label: "Cancel", value: "cancel", style: ButtonStyle.Danger }];
}

export async function promptUserForChoice(
  interaction: CommandInteraction,
  question: string,
  options: PromptChoiceOption[],
  timeoutMs = 120_000,
  cancelMessage = "Cancelled.",
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.send !== "function") {
    await safeReply(
      interaction,
      buildTextReply(
        "Cannot prompt for additional input; this command must be used in a text channel.",
        false,
      ),
    );
    return null;
  }

  const promptId = `admin-choice:${userId}`;
  const rows = buildChoiceRows(promptId, options);
  const content = `${userMention(userId)} ${question}`;

  let promptMessage: Message | null = null;
  try {
    const reply = await safeReply(interaction, {
      content,
      components: rows,
      __forceFollowUp: true,
    });
    if (reply && typeof (reply as Message).awaitMessageComponent === "function") {
      promptMessage = reply as Message;
    }
  } catch {
    // fall back to channel.send below
  }

  if (!promptMessage) {
    promptMessage = await channel.send({
      content,
      components: rows,
      allowedMentions: { users: [userId] },
    }).catch(() => null);
  }

  if (!promptMessage) {
    await safeReply(interaction, buildTextReply("Failed to send the prompt message.", false));
    return null;
  }

  try {
    const selection = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === userId && i.customId.startsWith(`${promptId}:`),
      time: timeoutMs,
    });
    await safeDeferUpdate(selection);
    const value = selection.customId.slice(promptId.length + 1);
    safeIgnore(promptMessage.edit({ components: [] }));
    if (value === "cancel") {
      await safeReply(interaction, buildTextReply(cancelMessage, false));
      return null;
    }
    return value;
  } catch {
    safeIgnore(promptMessage.edit({ components: [] }));
    await safeReply(interaction, buildTextReply("Timed out waiting for a selection. Cancelled.", false));
    return null;
  }
}

export async function promptUserForInput(
  interaction: CommandInteraction,
  question: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.awaitMessages !== "function") {
    await safeReply(
      interaction,
      buildTextReply(
        "Cannot prompt for additional input; this command must be used in a text channel.",
        false,
      ),
    );
    return null;
  }

  try {
    await safeReply(interaction, buildTextReply(`${userMention(userId)} ${question}`, false));
  } catch (err) {
    logError("AdminPromptUtils.sendPromptMessage", err);
  }

  try {
    const collected = await channel.awaitMessages({
      filter: (m: any) => m.author?.id === userId,
      max: 1,
      time: timeoutMs,
    });

    const first = collected?.first?.();
    if (!first) {
      await safeReply(interaction, buildTextReply("Timed out waiting for a response. Edit cancelled.", false));
      return null;
    }

    const content: string = (first.content ?? "").trim();
    if (!content) {
      await safeReply(interaction, buildTextReply("Empty response received. Edit cancelled.", false));
      return null;
    }

    if (/^cancel$/i.test(content)) {
      await safeReply(interaction, buildTextReply("Edit cancelled.", false));
      return null;
    }

    return content;
  } catch (err: any) {
    const msg = extractErrorMessage(err);
    try {
      await safeReply(interaction, buildTextReply(`Error while waiting for a response: ${msg}`, false));
    } catch {
      // ignore
    }
    return null;
  }
}
