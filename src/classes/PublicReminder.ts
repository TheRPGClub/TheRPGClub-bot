import { apiGet, apiPost, apiPatch, apiDelete } from "../services/RpgClubApiClient.js";

export type RecurrenceUnit = "minutes" | "hours" | "days" | "weeks" | "months" | "years";

export interface IPublicReminder {
  reminderId: number;
  channelId: string;
  message: string;
  dueAt: Date;
  recurEvery: number | null;
  recurUnit: RecurrenceUnit | null;
  enabled: boolean;
  createdBy: string | null;
}

type PublicReminderApiData = {
  reminder_id: number;
  channel_id: string;
  message: string;
  due_at: string;
  recur_every: number | null;
  recur_unit: RecurrenceUnit | null;
  enabled: boolean;
  created_by: string | null;
};

type PublicReminderResponse = { data: PublicReminderApiData };
type PublicReminderListResponse = { data: PublicReminderApiData[] };

function mapReminder(d: PublicReminderApiData): IPublicReminder {
  return {
    reminderId: Number(d.reminder_id),
    channelId: d.channel_id,
    message: d.message,
    dueAt: new Date(d.due_at),
    recurEvery: d.recur_every ?? null,
    recurUnit: d.recur_unit ?? null,
    enabled: d.enabled,
    createdBy: d.created_by ?? null,
  };
}

export async function createReminder(
  channelId: string,
  message: string,
  dueAt: Date,
  recurEvery: number | null,
  recurUnit: RecurrenceUnit | null,
  createdBy: string | null,
): Promise<IPublicReminder> {
  const response = await apiPost<PublicReminderResponse>("/api/v1/public_reminders", {
    data: {
      channel_id: channelId,
      message,
      due_at: dueAt.toISOString(),
      recur_every: recurEvery,
      recur_unit: recurUnit,
      enabled: true,
      created_by: createdBy,
    },
  });
  if (!response) throw new Error("Failed to create public reminder.");
  return mapReminder(response.data);
}

export async function listUpcomingReminders(limit: number = 20): Promise<IPublicReminder[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const response = await apiGet<PublicReminderListResponse>("/api/v1/public_reminders", {
    params: { enabled: true, per: safeLimit },
  });
  if (!response) return [];
  return response.data.map(mapReminder);
}

export async function listDueReminders(limit: number = 20): Promise<IPublicReminder[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const response = await apiGet<PublicReminderListResponse>("/api/v1/public_reminders/due", {
    params: { per: safeLimit },
  });
  if (!response) return [];
  return response.data.map(mapReminder);
}

export async function deleteReminder(reminderId: number): Promise<boolean> {
  const response = await apiDelete<{ deleted: boolean }>(
    `/api/v1/public_reminders/${reminderId}`,
  );
  return response?.deleted === true;
}

export async function updateReminderDueDate(
  reminderId: number,
  nextDue: Date,
): Promise<void> {
  await apiPatch(`/api/v1/public_reminders/${reminderId}`, {
    data: { due_at: nextDue.toISOString() },
  });
}

export async function disableReminder(reminderId: number): Promise<void> {
  await apiPatch(`/api/v1/public_reminders/${reminderId}`, {
    data: { enabled: false },
  });
}
