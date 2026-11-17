import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

import {
  birthDateReply,
  type IBirthDateApi,
  type IBirthDateDocument,
} from "../services/BirthDateService.js";

function apiError(status: number, body: unknown, userId = "42"): AxiosError {
  const config = {
    method: "put",
    url: `/api/v1/users/${userId}/birth_date`,
    headers: new AxiosHeaders(),
    data: JSON.stringify({ data: { birth_date: "1990-05-04", acting_user_id: "42" } }),
  };
  const response = {
    status,
    statusText: "",
    data: body,
    headers: {},
    config,
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, response);
}

function doc(overrides: Partial<IBirthDateDocument> = {}): IBirthDateDocument {
  return {
    userId: "42",
    birthDate: "1990-05-04",
    changesLeftThisMonth: 1,
    nextChangeOn: null,
    ...overrides,
  };
}

interface IFakeBirthDateApi extends IBirthDateApi {
  gets: { userId: string; actingUserId: string }[];
  puts: { userId: string; birthDate: string | null; actingUserId: string }[];
}

function fakeApi(options: {
  get?: IBirthDateDocument;
  put?: IBirthDateDocument;
  error?: unknown;
} = {}): IFakeBirthDateApi {
  const api: IFakeBirthDateApi = {
    gets: [],
    puts: [],
    getBirthDate: async (userId, actingUserId) => {
      api.gets.push({ userId, actingUserId });
      if (options.error) throw options.error;
      return options.get ?? doc();
    },
    setBirthDate: async (userId, birthDate, actingUserId) => {
      api.puts.push({ userId, birthDate, actingUserId });
      if (options.error) throw options.error;
      return options.put ?? doc();
    },
  };
  return api;
}

/** The friendly line, then the full request and response as JSON blocks (CLAUDE.md). */
function assertRefusal(text: string, friendly: string, status: number): void {
  assert.ok(text.startsWith(friendly), text);
  assert.match(text, /Request:\n```json/);
  assert.match(text, /"url": "\/api\/v1\/users\/\d+\/birth_date"/);
  assert.match(text, new RegExp(`Response:\\n\`\`\`json[\\s\\S]*"status": ${status}`));
}

test("birthDateReply: a member sets their own and is told how many changes are left",
  async () => {
    const api = fakeApi({ put: doc({ birthDate: "1990-05-04", changesLeftThisMonth: 1 }) });
    const text = await birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: " 1990-05-04 " } },
      { api },
    );
    assert.deepEqual(api.puts, [{ userId: "42", birthDate: "1990-05-04", actingUserId: "42" }]);
    assert.equal(
      text,
      "Your Birth Date is now **4 May 1990**. You can change it 1 more time this month.",
    );
  });

test("birthDateReply: the last change of the month names the date it opens again",
  async () => {
    const api = fakeApi({
      put: doc({ changesLeftThisMonth: 0, nextChangeOn: "2026-12-01" }),
    });
    const text = await birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: "1990-05-04" } },
      { api },
    );
    assert.equal(
      text,
      "Your Birth Date is now **4 May 1990**. You can change it again on 1 December 2026.",
    );
  });

test("birthDateReply: the limit refusal shows the API's message with the date, and the exchange",
  async () => {
    const message = "You can change your Birth Date twice a month, and you've already " +
      "changed it twice this month. You can change it again on 1 December 2026.";
    const api = fakeApi({
      error: apiError(422, { error: message, next_change_on: "2026-12-01" }),
    });
    const text = await birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: "1990-05-04" } },
      { api },
    );
    assertRefusal(text, message, 422);
    assert.match(text, /"next_change_on": "2026-12-01"/);
  });

test("birthDateReply: the limit refusal without a message still names the date", async () => {
  const api = fakeApi({ error: apiError(422, { next_change_on: "2026-12-01" }) });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: "1990-05-04" } },
    { api },
  );
  assertRefusal(
    text,
    "You've used this month's changes. You can change your Birth Date again on 1 December 2026.",
    422,
  );
});

test("birthDateReply: a date the API won't take shows its reason and the exchange",
  async () => {
    const api = fakeApi({
      error: apiError(422, { error: "birth_date must be a date (YYYY-MM-DD)" }),
    });
    const text = await birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: "4 May 1990" } },
      { api },
    );
    assertRefusal(
      text,
      "That Birth Date wasn't saved: birth_date must be a date (YYYY-MM-DD). " +
        "Enter it as YYYY-MM-DD, for example 1990-05-04.",
      422,
    );
  });

test("birthDateReply: staff set another member's, acting as themselves", async () => {
  const api = fakeApi({ put: doc({ userId: "7", birthDate: "1985-12-31" }) });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "7", action: { kind: "set", date: "1985-12-31" } },
    { api },
  );
  assert.deepEqual(api.puts, [{ userId: "7", birthDate: "1985-12-31", actingUserId: "42" }]);
  assert.equal(
    text,
    "<@7>'s Birth Date is now **31 December 1985**. " +
      "Staff changes don't count toward the member's two a month.",
  );
});

test("birthDateReply: a member naming someone else gets the staff-only refusal", async () => {
  const api = fakeApi({ error: apiError(403, { error: "forbidden" }, "7") });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "7", action: { kind: "set", date: "1990-05-04" } },
    { api },
  );
  assertRefusal(text, "Only staff can see or set another member's Birth Date.", 403);
});

test("birthDateReply: staff naming a member the API doesn't know are told so", async () => {
  const api = fakeApi({ error: apiError(404, { error: "not found" }, "7") });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "7", action: { kind: "set", date: "1990-05-04" } },
    { api },
  );
  assertRefusal(text, "<@7> isn't in the club's member records yet.", 404);
});

test("birthDateReply: other API errors are thrown for the command's error reply", async () => {
  const error = apiError(500, { error: "boom" });
  const api = fakeApi({ error });
  await assert.rejects(
    birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "set", date: "1990-05-04" } },
      { api },
    ),
    (err) => err === error,
  );
});

test("birthDateReply: viewing your own shows the date privately with changes left",
  async () => {
    const api = fakeApi({ get: doc({ changesLeftThisMonth: 2 }) });
    const text = await birthDateReply(
      { actingUserId: "42", targetUserId: "42", action: { kind: "view" } },
      { api },
    );
    assert.deepEqual(api.gets, [{ userId: "42", actingUserId: "42" }]);
    assert.equal(
      text,
      "Your Birth Date is **4 May 1990**. Only you and staff can see it. " +
        "You can change it 2 more times this month.",
    );
  });

test("birthDateReply: viewing without one says how to enter it", async () => {
  const api = fakeApi({ get: doc({ birthDate: null, changesLeftThisMonth: 2 }) });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "42", action: { kind: "view" } },
    { api },
  );
  assert.equal(
    text,
    "You haven't entered a Birth Date. Set it with `/profile birth-date date:YYYY-MM-DD`. " +
      "You can change it 2 more times this month.",
  );
});

test("birthDateReply: staff viewing another member's see their changes left", async () => {
  const api = fakeApi({
    get: doc({ userId: "7", changesLeftThisMonth: 0, nextChangeOn: "2026-12-01" }),
  });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "7", action: { kind: "view" } },
    { api },
  );
  assert.deepEqual(api.gets, [{ userId: "7", actingUserId: "42" }]);
  assert.equal(
    text,
    "<@7>'s Birth Date is **4 May 1990**. " +
      "They can change it again on 1 December 2026.",
  );
});

test("birthDateReply: removing sends null and counts as a change", async () => {
  const api = fakeApi({ put: doc({ birthDate: null, changesLeftThisMonth: 1 }) });
  const text = await birthDateReply(
    { actingUserId: "42", targetUserId: "42", action: { kind: "remove" } },
    { api },
  );
  assert.deepEqual(api.puts, [{ userId: "42", birthDate: null, actingUserId: "42" }]);
  assert.equal(
    text,
    "Your Birth Date is removed. You can change it 1 more time this month.",
  );
});
