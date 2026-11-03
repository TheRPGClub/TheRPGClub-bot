import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { DiscordAPIError } from "discord.js";
import { mapBotJobClaim, type IBotJob, type IBotJobApi } from "../classes/BotJobs.js";
import {
  BOT_JOB_HANDLERS,
  type BotJobHandlers,
  type IBotJobSurface,
} from "../services/BotJobHandlers.js";
import {
  createBotJobDeliveryState,
  pollBotJobsOnce,
  processBotJobs,
} from "../services/BotJobService.js";
import {
  BOT_JOB_CLAIM_LIMIT,
  BOT_JOB_ERROR_MESSAGE_MAX,
  BOT_JOB_MAX_ATTEMPTS,
  BOT_JOB_POLL_INTERVAL_MS,
  BOT_JOB_RESULT_TEXT_MAX,
} from "../config/botJobs.js";

type Ack =
  | { id: number; status: "done"; resultText?: string }
  | { id: number; status: "failed"; error: string };

interface IFakeApi extends IBotJobApi {
  acks: Ack[];
  claims: number[];
}

function fakeApi(
  batches: IBotJob[][] = [],
  overrides: Partial<IBotJobApi> = {},
): IFakeApi {
  const acks: Ack[] = [];
  const claims: number[] = [];
  return {
    acks,
    claims,
    claim: async (limit) => {
      claims.push(limit);
      return batches.shift() ?? [];
    },
    done: async (id, resultText) => {
      acks.push(
        resultText === undefined ? { id, status: "done" } : { id, status: "done", resultText },
      );
    },
    failed: async (id, error) => {
      acks.push({ id, status: "failed", error });
    },
    ...overrides,
  };
}

interface IFakeSurface extends IBotJobSurface {
  wakeups: number;
}

function fakeSurface(): IFakeSurface {
  const surface: IFakeSurface = {
    wakeups: 0,
    requestVotingEventPoll: () => {
      surface.wakeups++;
    },
    fetchGameKey: async () => null,
    runGiveawayClaimSideEffects: async () => "",
    sendDm: async () => {},
    refreshGiveawayHub: async () => {},
    fetchSuggestion: async () => null,
    sendChannelMessage: async () => {},
    reloadGotmRound: async () => {},
    announceNominationChange: async () => {},
  };
  return surface;
}

function job(
  id: number,
  kind: string,
  payload: Record<string, unknown> = {},
  attempts = 1,
): IBotJob {
  return { id, kind, payload, attempts, requestedByUserId: null };
}

function apiError(status = 500): AxiosError {
  const request = { method: "get", url: "/api/v1/giveaways/7", data: undefined };
  const response: any = {
    status,
    data: { error: "boom" },
    headers: {},
    statusText: "Internal Server Error",
    config: { headers: new AxiosHeaders() },
  };
  const config: any = { method: "get", url: "/api/v1/giveaways/7", headers: new AxiosHeaders() };
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, request, response);
}

test("voting_poll_wakeup requests a voting event poll and acks done", async () => {
  const api = fakeApi();
  const surface = fakeSurface();
  await processBotJobs([job(1, "voting_poll_wakeup")], BOT_JOB_HANDLERS, surface, api);
  assert.equal(surface.wakeups, 1);
  assert.deepEqual(api.acks, [{ id: 1, status: "done" }]);
});

test("an unknown kind acks failed without running any handler", async () => {
  const api = fakeApi();
  const surface = fakeSurface();
  await processBotJobs([job(2, "teleport_member")], BOT_JOB_HANDLERS, surface, api);
  assert.equal(surface.wakeups, 0);
  assert.equal(api.acks.length, 1);
  const [ack] = api.acks;
  assert.equal(ack.status, "failed");
  assert.match(ack.status === "failed" ? ack.error : "", /unknown kind "teleport_member"/);
});

test("a kind named like an Object property is still unknown", async () => {
  const api = fakeApi();
  await processBotJobs([job(3, "constructor")], BOT_JOB_HANDLERS, fakeSurface(), api);
  assert.equal(api.acks[0]?.status, "failed");
});

test("a failing job acks failed and the rest of the batch still runs", async () => {
  const api = fakeApi();
  const seen: unknown[] = [];
  const handlers: BotJobHandlers = {
    boom: async () => {
      throw new Error("Cannot send messages to this user");
    },
    ok: async (payload) => {
      seen.push(payload);
    },
  };
  const jobs = [job(4, "boom"), job(5, "ok", { giveaway_id: 9 })];
  await processBotJobs(jobs, handlers, fakeSurface(), api, createBotJobDeliveryState());
  assert.deepEqual(seen, [{ giveaway_id: 9 }]);
  assert.equal(api.acks.length, 2);
  assert.equal(api.acks[0].status, "failed");
  assert.match(api.acks[0].status === "failed" ? api.acks[0].error : "", /this user/);
  assert.deepEqual(api.acks[1], { id: 5, status: "done" });
});

test("an API failure acks with the full request and response", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = {
    fetches: async () => {
      throw apiError();
    },
  };
  await processBotJobs([job(6, "fetches", {}, BOT_JOB_MAX_ATTEMPTS)], handlers, fakeSurface(),
    api);
  const ack = api.acks[0];
  assert.equal(ack.status, "failed");
  const error = ack.status === "failed" ? ack.error : "";
  assert.match(error, /Bot job 6 \(fetches\) failed/);
  assert.match(error, /"url": "\/api\/v1\/giveaways\/7"/);
  assert.match(error, /"status": 500/);
  assert.match(error, /"error": "boom"/);
  assert.doesNotMatch(error, /<@&/);
});

test("a failed job's error message fits the API's limit", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = {
    long: async () => {
      throw new Error("x".repeat(5000));
    },
  };
  await processBotJobs([job(7, "long")], handlers, fakeSurface(), api);
  const ack = api.acks[0];
  assert.ok(ack.status === "failed" && ack.error.length <= BOT_JOB_ERROR_MESSAGE_MAX);
});

test("an ack that fails does not stop the batch", async () => {
  let doneCalls = 0;
  const api = fakeApi([], {
    done: async (id) => {
      doneCalls++;
      if (id === 8) throw new Error("API down");
    },
  });
  const jobs = [job(8, "voting_poll_wakeup"), job(9, "voting_poll_wakeup")];
  const surface = fakeSurface();
  await processBotJobs(jobs, BOT_JOB_HANDLERS, surface, api, createBotJobDeliveryState());
  assert.equal(surface.wakeups, 2);
  assert.equal(doneCalls, 2);
});

test("a performed job whose done ack failed is only acked when it comes back", async () => {
  const state = createBotJobDeliveryState();
  let failDone = true;
  const acked: number[] = [];
  const api = fakeApi([], {
    done: async (id) => {
      if (failDone) throw new Error("API down");
      acked.push(id);
    },
  });
  const surface = fakeSurface();
  await processBotJobs([job(10, "voting_poll_wakeup")], BOT_JOB_HANDLERS, surface, api, state);
  failDone = false;
  await processBotJobs([job(10, "voting_poll_wakeup")], BOT_JOB_HANDLERS, surface, api, state);
  assert.equal(surface.wakeups, 1);
  assert.deepEqual(acked, [10]);
});

test("a poll claims a batch, works it and waits the poll interval", async () => {
  const api = fakeApi([[job(11, "voting_poll_wakeup")]]);
  const surface = fakeSurface();
  const state = createBotJobDeliveryState();
  const delay = await pollBotJobsOnce(BOT_JOB_HANDLERS, surface, api, state);
  assert.deepEqual(api.claims, [BOT_JOB_CLAIM_LIMIT]);
  assert.equal(surface.wakeups, 1);
  assert.deepEqual(api.acks, [{ id: 11, status: "done" }]);
  assert.equal(delay, BOT_JOB_POLL_INTERVAL_MS);
});

test("an empty poll waits the poll interval", async () => {
  const delay = await pollBotJobsOnce(BOT_JOB_HANDLERS, fakeSurface(), fakeApi());
  assert.equal(delay, BOT_JOB_POLL_INTERVAL_MS);
});

test("a full batch polls again at once", async () => {
  const full = Array.from({ length: BOT_JOB_CLAIM_LIMIT }, (_, i) =>
    job(100 + i, "voting_poll_wakeup"));
  const api = fakeApi([full]);
  const delay = await pollBotJobsOnce(
    BOT_JOB_HANDLERS, fakeSurface(), api, createBotJobDeliveryState(),
  );
  assert.equal(delay, 0);
});

test("a failed claim throws so the poller backs off", async () => {
  const api = fakeApi([], {
    claim: async () => {
      throw apiError();
    },
  });
  await assert.rejects(pollBotJobsOnce(BOT_JOB_HANDLERS, fakeSurface(), api));
});

test("a claimed job maps from the API's shape, a null payload as empty", () => {
  const mapped = mapBotJobClaim({
    id: 12,
    kind: "voting_poll_wakeup",
    payload: null,
    attempts: 2,
    requested_by_user_id: "123",
  });
  assert.deepEqual(mapped, {
    id: 12,
    kind: "voting_poll_wakeup",
    payload: {},
    attempts: 2,
    requestedByUserId: "123",
  });
});

test("a Discord failure's request body never reaches the failed ack", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = {
    posts: async () => {
      throw Object.assign(new Error("Internal Server Error"), {
        method: "POST",
        url: "https://discord.com/api/v10/channels/555/messages",
        status: 500,
        rawError: { message: "Internal Server Error", code: 0 },
        requestBody: { json: { content: "secret-content" } },
      });
    },
  };
  await processBotJobs([job(30, "posts")], handlers, fakeSurface(), api);
  const ack = api.acks[0];
  const error = ack.status === "failed" ? ack.error : "";
  assert.doesNotMatch(error, /secret-content/);
  assert.match(error, /"status": 500/);
  assert.match(error, /channels\/555\/messages/);
});

test(
  "a failed job whose failed ack missed is only re-acked failed when it comes back",
  async () => {
    const state = createBotJobDeliveryState();
    let failAck = true;
    let runs = 0;
    const failedAcks: { id: number; error: string }[] = [];
    const api = fakeApi([], {
      failed: async (id, error) => {
        if (failAck) throw new Error("API down");
        failedAcks.push({ id, error });
      },
    });
    const handlers: BotJobHandlers = {
      breaks: async () => {
        runs++;
        throw new Error("Missing Access");
      },
    };
    await processBotJobs([job(31, "breaks")], handlers, fakeSurface(), api, state);
    failAck = false;
    await processBotJobs([job(31, "breaks")], handlers, fakeSurface(), api, state);
    assert.equal(runs, 1);
    assert.equal(failedAcks.length, 1);
    assert.equal(failedAcks[0].id, 31);
    assert.match(failedAcks[0].error, /Missing Access/);
  },
);

function throwing(err: unknown): BotJobHandlers {
  return {
    flaky: async () => {
      throw err;
    },
  };
}

test("a temporary API failure is left unacked so the lease retries the job", async () => {
  const api = fakeApi();
  const state = createBotJobDeliveryState();
  await processBotJobs([job(20, "flaky")], throwing(apiError(503)), fakeSurface(), api, state);
  assert.deepEqual(api.acks, []);
  assert.equal(state.pendingAcks.size, 0);
});

test("an API request with no response (timeout) is left for the lease", async () => {
  const api = fakeApi();
  const config: any = { method: "get", url: "/api/v1/game_keys/1", headers: new AxiosHeaders() };
  const err = new AxiosError("timeout of 20000ms exceeded", "ECONNABORTED", config, {});
  await processBotJobs([job(21, "flaky")], throwing(err), fakeSurface(), api);
  assert.deepEqual(api.acks, []);
});

test("a Discord server error is left for the lease", async () => {
  const api = fakeApi();
  const err = new DiscordAPIError(
    { code: 0, message: "Internal Server Error" }, 0, 502, "POST",
    "https://discord.com/api/v10/channels/1/messages", { body: {} },
  );
  await processBotJobs([job(23, "flaky")], throwing(err), fakeSurface(), api);
  assert.deepEqual(api.acks, []);
});

test("a temporary failure on the last attempt acks failed with the error", async () => {
  const api = fakeApi();
  await processBotJobs(
    [job(24, "flaky", {}, BOT_JOB_MAX_ATTEMPTS)], throwing(apiError(503)), fakeSurface(), api,
  );
  assert.equal(api.acks[0]?.status, "failed");
  assert.match(api.acks[0]?.status === "failed" ? api.acks[0].error : "", /"status": 503/);
});

test("a permanent API failure (404) acks failed on the first attempt", async () => {
  const api = fakeApi();
  await processBotJobs([job(25, "flaky")], throwing(apiError(404)), fakeSurface(), api);
  assert.equal(api.acks[0]?.status, "failed");
});

test("an error wrapping a temporary failure is still final", async () => {
  // Handlers wrap an error on purpose when a retry would repeat a side effect (the claim
  // DM runs after the claim log post and donor DM), so only the thrown error is classed.
  const api = fakeApi();
  const err = new Error("Could not DM the claimer their key", { cause: apiError(503) });
  await processBotJobs([job(26, "flaky")], throwing(err), fakeSurface(), api);
  assert.equal(api.acks[0]?.status, "failed");
});

test("a handler's result text goes with the done ack", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = {
    scan: async () => "Scanned 120 members: 3 joined, 1 left.",
  };
  await processBotJobs([job(40, "scan")], handlers, fakeSurface(), api);
  assert.deepEqual(api.acks, [
    { id: 40, status: "done", resultText: "Scanned 120 members: 3 joined, 1 left." },
  ]);
});

test("a handler that returns nothing acks done with no result text", async () => {
  const api = fakeApi();
  await processBotJobs([job(41, "voting_poll_wakeup")], BOT_JOB_HANDLERS, fakeSurface(), api);
  assert.deepEqual(api.acks, [{ id: 41, status: "done" }]);
});

test("a blank result text acks done with no result text", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = { quiet: async () => "   " };
  await processBotJobs([job(42, "quiet")], handlers, fakeSurface(), api);
  assert.deepEqual(api.acks, [{ id: 42, status: "done" }]);
});

test("a long result text is cut to the API's limit", async () => {
  const api = fakeApi();
  const handlers: BotJobHandlers = { chatty: async () => "y".repeat(5000) };
  await processBotJobs([job(43, "chatty")], handlers, fakeSurface(), api);
  const ack = api.acks[0];
  const text = ack.status === "done" ? ack.resultText ?? "" : "";
  assert.equal(text.length, BOT_JOB_RESULT_TEXT_MAX);
  assert.ok(text.endsWith("..."));
});

test("a missed done ack is re-sent with its result text, not re-run", async () => {
  const state = createBotJobDeliveryState();
  let failDone = true;
  let runs = 0;
  const sent: { id: number; resultText?: string | null }[] = [];
  const api = fakeApi([], {
    done: async (id, resultText) => {
      if (failDone) throw new Error("API down");
      sent.push({ id, resultText });
    },
  });
  const handlers: BotJobHandlers = {
    scan: async () => {
      runs++;
      return "Thread: https://discord.com/channels/1/2";
    },
  };
  await processBotJobs([job(44, "scan")], handlers, fakeSurface(), api, state);
  failDone = false;
  await processBotJobs([job(44, "scan")], handlers, fakeSurface(), api, state);
  assert.equal(runs, 1);
  assert.deepEqual(sent, [{ id: 44, resultText: "Thread: https://discord.com/channels/1/2" }]);
});
