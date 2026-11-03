import { apiGet, apiPatch } from "../services/RpgClubApiClient.js";

/** queued, thread_created once the forum thread exists, created once the event does too. */
export type LiveEventStatus = "queued" | "thread_created" | "created" | "failed";

/** A live event created on the website (GET /live_events/:id). */
export interface ILiveEvent {
  id: number;
  topic: string;
  startsAt: Date;
  endsAt: Date;
  imageUrl: string | null;
  status: LiveEventStatus;
  discordThreadId: string | null;
  discordEventId: string | null;
}

/** What PATCH /live_events/:id records: a step's Discord id and the new status. */
export interface ILiveEventStep {
  discordThreadId?: string;
  discordEventId?: string;
  status: LiveEventStatus;
}

type LiveEventApiData = {
  id: number;
  topic: string;
  starts_at: string;
  ends_at: string;
  image_url?: string | null;
  status: LiveEventStatus;
  discord_thread_id?: string | null;
  discord_event_id?: string | null;
};

type LiveEventResponse = { data: LiveEventApiData };

function mapLiveEvent(d: LiveEventApiData): ILiveEvent {
  return {
    id: d.id,
    topic: d.topic,
    startsAt: new Date(d.starts_at),
    endsAt: new Date(d.ends_at),
    imageUrl: d.image_url ?? null,
    status: d.status,
    discordThreadId: d.discord_thread_id ?? null,
    discordEventId: d.discord_event_id ?? null,
  };
}

/** GET /live_events/:id with the service token; null on 404. */
export async function getLiveEventById(liveEventId: number): Promise<ILiveEvent | null> {
  const response = await apiGet<LiveEventResponse>(`/api/v1/live_events/${liveEventId}`);
  return response ? mapLiveEvent(response.data) : null;
}

/**
 * PATCH /live_events/:id (service only): records a created thread or event and the
 * status. Throws the AxiosError on any non-2xx, and an Error on 404.
 */
export async function recordLiveEventStep(
  liveEventId: number,
  step: ILiveEventStep,
): Promise<void> {
  const data: Record<string, string> = { status: step.status };
  if (step.discordThreadId !== undefined) data.discord_thread_id = step.discordThreadId;
  if (step.discordEventId !== undefined) data.discord_event_id = step.discordEventId;
  const response = await apiPatch<LiveEventResponse>(
    `/api/v1/live_events/${liveEventId}`,
    { data },
  );
  if (!response) {
    throw new Error(
      `PATCH /api/v1/live_events/${liveEventId} with ${JSON.stringify({ data })} ` +
        "answered 404: the live event no longer exists.",
    );
  }
}
