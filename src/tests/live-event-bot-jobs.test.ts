import assert from "node:assert/strict";
import test from "node:test";
import { DiscordAPIError } from "discord.js";
import { BOT_JOB_HANDLERS, type IBotJobSurface } from "../services/BotJobHandlers.js";
import { processBotJobs } from "../services/BotJobService.js";
import type { IBotJob, IBotJobApi } from "../classes/BotJobs.js";
import type { ILiveEvent, ILiveEventStep } from "../classes/LiveEvent.js";
import type {
  ILiveEventScheduleInput,
  ILiveEventThreadInput,
} from "../services/LiveEventService.js";
import { HOME_GUILD_ID } from "../config/guilds.js";

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

function fakeApi(): IBotJobApi & { acks: Ack[] } {
  const acks: Ack[] = [];
  return {
    acks,
    claim: async () => [],
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
  };
}

function storedEvent(overrides: Partial<ILiveEvent> = {}): ILiveEvent {
  return {
    id: 7,
    topic: "Nintendo Direct",
    startsAt: new Date("2026-12-01T21:00:00Z"),
    endsAt: new Date("2026-12-01T23:00:00Z"),
    imageUrl: "https://cdn.example.com/live-events/direct.png",
    status: "queued",
    discordThreadId: null,
    discordEventId: null,
    ...overrides,
  };
}

const imageBytes = Buffer.from("png-bytes");

interface ILiveEventSurface extends IBotJobSurface {
  calls: string[];
  steps: { id: number; step: ILiveEventStep }[];
  threads: ILiveEventThreadInput[];
  schedules: ILiveEventScheduleInput[];
}

function fakeSurface(options: {
  event?: ILiveEvent | null;
  imageError?: unknown;
  threadError?: unknown;
  scheduleError?: unknown;
  recordError?: (step: ILiveEventStep) => unknown;
} = {}): ILiveEventSurface {
  const event = options.event === undefined ? storedEvent() : options.event;
  const surface: ILiveEventSurface = {
    calls: [],
    steps: [],
    threads: [],
    schedules: [],
    requestVotingEventPoll: () => {},
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    fetchCompletionForUser: async () => null,
    fetchGame: async () => null,
    announceCompletion: async () => {},
    fetchLiveEvent: async (id) => {
      surface.calls.push(`fetch ${id}`);
      return event;
    },
    recordLiveEventStep: async (id, step) => {
      surface.calls.push(`record ${step.status}`);
      const err = options.recordError?.(step);
      if (err) throw err;
      surface.steps.push({ id, step });
    },
    fetchLiveEventImage: async (url) => {
      surface.calls.push(`image ${url}`);
      if (options.imageError) throw options.imageError;
      return imageBytes;
    },
    createLiveEventThread: async (input) => {
      surface.calls.push("thread");
      if (options.threadError) throw options.threadError;
      surface.threads.push(input);
      return "900";
    },
    createLiveEventScheduledEvent: async (input) => {
      surface.calls.push("schedule");
      if (options.scheduleError) throw options.scheduleError;
      surface.schedules.push(input);
      return "800";
    },
  };
  return surface;
}

function job(id: number, payload: Record<string, unknown>, attempts = 1): IBotJob {
  return { id, kind: "live_event_create", payload, attempts, requestedByUserId: null };
}

async function run(surface: IBotJobSurface, jobs: IBotJob[]): Promise<Ack[]> {
  const api = fakeApi();
  await processBotJobs(jobs, BOT_JOB_HANDLERS, surface, api);
  return api.acks;
}

function failure(acks: Ack[]): string {
  const [ack] = acks;
  assert.equal(ack?.status, "failed");
  return ack.status === "failed" ? ack.error : "";
}

const threadUrl = `https://discord.com/channels/${HOME_GUILD_ID}/900`;
const eventUrl = `https://discord.com/events/${HOME_GUILD_ID}/800`;
const doneText = `Thread: ${threadUrl}\nEvent: ${eventUrl}`;

test("creates the thread, then the event, recording each, and links both", async () => {
  const surface = fakeSurface();
  const acks = await run(surface, [job(1, { live_event_id: 7 })]);
  assert.deepEqual(acks, [{ id: 1, status: "done", resultText: doneText }]);
  assert.deepEqual(surface.calls, [
    "fetch 7",
    "image https://cdn.example.com/live-events/direct.png",
    "thread",
    "record thread_created",
    "schedule",
    "record created",
  ]);
  assert.deepEqual(surface.threads, [{
    topic: "Nintendo Direct",
    imageUrl: "https://cdn.example.com/live-events/direct.png",
  }]);
  assert.deepEqual(surface.schedules, [{
    topic: "Nintendo Direct",
    startsAt: new Date("2026-12-01T21:00:00Z"),
    endsAt: new Date("2026-12-01T23:00:00Z"),
    location: threadUrl,
    image: imageBytes,
  }]);
  assert.deepEqual(surface.steps, [
    { id: 7, step: { discordThreadId: "900", status: "thread_created" } },
    { id: 7, step: { discordEventId: "800", status: "created" } },
  ]);
});

test("a retry after the thread was recorded only creates the event", async () => {
  const surface = fakeSurface({
    event: storedEvent({ status: "thread_created", discordThreadId: "900" }),
  });
  const acks = await run(surface, [job(1, { live_event_id: 7 }, 2)]);
  assert.deepEqual(acks, [{ id: 1, status: "done", resultText: doneText }]);
  assert.deepEqual(surface.calls, [
    "fetch 7",
    "image https://cdn.example.com/live-events/direct.png",
    "schedule",
    "record created",
  ]);
  assert.equal(surface.schedules[0]?.location, threadUrl);
});

test("a retry after both were recorded creates nothing and still links both", async () => {
  const surface = fakeSurface({
    event: storedEvent({ status: "created", discordThreadId: "900", discordEventId: "800" }),
  });
  const acks = await run(surface, [job(1, { live_event_id: 7 }, 2)]);
  assert.deepEqual(acks, [{ id: 1, status: "done", resultText: doneText }]);
  assert.deepEqual(surface.calls, ["fetch 7"]);
});

test("an event with no image is created without one", async () => {
  const surface = fakeSurface({ event: storedEvent({ imageUrl: null }) });
  const acks = await run(surface, [job(1, { live_event_id: 7 })]);
  assert.equal(acks[0]?.status, "done");
  assert.ok(!surface.calls.some((call) => call.startsWith("image")));
  assert.equal(surface.threads[0]?.imageUrl, null);
  assert.equal(surface.schedules[0]?.image, null);
});
