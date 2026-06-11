import {
  ButtonStyle,
} from "discord.js";
import { toUnixTimestamp } from "./DateFormatUtils.js";
import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import { buildActionButton, buildButtonRow } from "./uiComponents.js";
import type { IReminderRecord } from "../classes/Reminder.js";

export const REMINDER_DONE_PREFIX = "remind-done-";
export const REMINDER_SNOOZE_PREFIX = "remind-snooze-";

export type ReminderButton =
  | { kind: "done"; reminderId: number }
  | { kind: "snooze"; reminderId: number; minutes: number };

export function formatReminderTime(date: Date): string {
  const seconds = toUnixTimestamp(date);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

export function buildReminderButtons(reminderId: number): ActionRowBuilder<ButtonBuilder>[] {
  const row = buildButtonRow(
    buildActionButton({ customId: formatSnoozeId(60, reminderId), label: "Snooze 1h", style: ButtonStyle.Secondary }),
    buildActionButton({ customId: formatSnoozeId(1440, reminderId), label: "Snooze 1d", style: ButtonStyle.Secondary }),
    buildActionButton("confirm", formatDoneId(reminderId), "Mark done"),
  );

  return [row];
}

export function parseReminderButton(customId: string): ReminderButton | null {
  if (customId.startsWith(REMINDER_DONE_PREFIX)) {
    const idPart = customId.slice(REMINDER_DONE_PREFIX.length);
    const reminderId = Number(idPart);
    if (Number.isFinite(reminderId) && reminderId > 0) {
      return { kind: "done", reminderId };
    }
  }

  if (customId.startsWith(REMINDER_SNOOZE_PREFIX)) {
    const remaining = customId.slice(REMINDER_SNOOZE_PREFIX.length);
    const [minutesRaw, idRaw] = remaining.split("-");
    const minutes = Number(minutesRaw);
    const reminderId = Number(idRaw);
    if (Number.isFinite(minutes) && Number.isFinite(reminderId)) {
      return { kind: "snooze", minutes, reminderId };
    }
  }

  return null;
}

export function buildReminderMessage(reminder: IReminderRecord): string {
  const time = formatReminderTime(reminder.remindAt);
  const extra = reminder.isNoisy
    ? "\n\n**This is a noisy reminder.** It will repeat every 15 minutes until you click 'Mark done' or delete it."
    : "";

  return (
    `You asked me to remind you: ${reminder.content}\n` +
    `Scheduled for ${time}.${extra}\n` +
    "Use the buttons below to snooze or remove this reminder."
  );
}

function formatDoneId(reminderId: number): string {
  return `${REMINDER_DONE_PREFIX}${reminderId}`;
}

function formatSnoozeId(minutes: number, reminderId: number): string {
  return `${REMINDER_SNOOZE_PREFIX}${minutes}-${reminderId}`;
}
