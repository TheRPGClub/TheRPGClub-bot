import assert from "node:assert/strict";
import test from "node:test";
import type { ICodexEntry, IFunFactApi } from "../services/CodexApi.js";
import {
  addFunFactReply,
  deleteFunFactQuestion,
  deleteFunFactReply,
  editFunFactReply,
  funFactChoices,
  type CodexReplyResult,
} from "../services/CodexFunFacts.js";
import {
  buildCodexFunFactId,
  parseCodexFunFactId,
} from "../functions/CodexCustomIds.js";
import { apiError, buttonsOf, textOf } from "./challengeFixtures.js";

// /codex fun-fact add, edit and delete (bot#1561), through /api/v1/codex/fun_facts, with a
// fake API client. The API decides who may do what; the bot passes the member it acts for.

const REGULAR = "222";
const MENTIONED = "333";

function funFact(overrides: Partial<ICodexEntry> = {}): ICodexEntry {
  return {
    id: 5,
    part: "fun_fact",
    title: null,
    rich_body: null,
    body: `<@${MENTIONED}> was first called Sir Grindsalot.`,
    occurred_on: null,
    date_precision: null,
    kind: null,
    author: { user_id: REGULAR, name: "Lufia", avatar_url: `/api/v1/users/${REGULAR}/avatar` },
    mentions: {
      [MENTIONED]: {
        user_id: MENTIONED,
        name: "Kaiserkaze",
        avatar_url: `/api/v1/users/${MENTIONED}/avatar`,
      },
    },
    images: [],
    links: [],
    viewer: { can_edit: true, can_delete: true },
    created_at: "2026-11-18T14:00:00.000Z",
    updated_at: "2026-11-18T14:00:00.000Z",
    ...overrides,
  };
}

interface IFakeFunFactApi extends IFunFactApi {
  calls: string[];
}

function fakeApi(options: {
  facts?: ICodexEntry[];
  error?: unknown;
} = {}): IFakeFunFactApi {
  const facts = options.facts ?? [];
  const fail = (): void => {
    if (options.error) throw options.error;
  };
  const api: IFakeFunFactApi = {
    calls: [],
    list: async (actingUserId, page, per) => {
      api.calls.push(`list ${actingUserId} ${page} ${per}`);
      fail();
      return facts;
    },
    get: async (id, actingUserId) => {
      api.calls.push(`get ${id} ${actingUserId}`);
      fail();
      return facts.find((f) => f.id === id) ?? null;
    },
    create: async (body, actingUserId) => {
      api.calls.push(`create ${actingUserId} ${body}`);
      fail();
      return funFact({ id: 9, body });
    },
    edit: async (id, body, actingUserId) => {
      api.calls.push(`edit ${id} ${actingUserId} ${body}`);
      fail();
      return funFact({ id, body });
    },
    remove: async (id, actingUserId) => {
      api.calls.push(`remove ${id} ${actingUserId}`);
      fail();
      return facts.some((f) => f.id === id);
    },
  };
  return api;
}

function shown(result: CodexReplyResult): string {
  return "error" in result ? result.error : textOf(result.view.components);
}

test("fun-fact add sends the text with its mention token unchanged, as the member", async () => {
  const api = fakeApi();
  const text = `<@${MENTIONED}> was first called Sir Grindsalot.`;
  const result = await addFunFactReply({ text, actingUserId: REGULAR }, { api });

  assert.deepEqual(api.calls, [`create ${REGULAR} ${text}`]);
  assert.ok("view" in result);
  assert.match(shown(result), /^## Fun Fact added$/m);
  assert.ok(shown(result).includes(`> <@${MENTIONED}> was first called Sir Grindsalot.`));
  assert.deepEqual(result.view.allowedMentions, { parse: [] });
});

test("fun-fact add by a plain member shows the API's refusal privately", async () => {
  const text = "Lufia once named every save file Crono.";
  const error = apiError(
    403,
    { error: "forbidden", message: "You need the Regulars role to add to the Club Codex." },
    {
      method: "post",
      url: "/api/v1/codex/fun_facts",
      data: { data: { body: text, acting_user_id: "444" } },
    },
  );
  const result = await addFunFactReply({ text, actingUserId: "444" }, {
    api: fakeApi({ error }),
  });

  assert.ok("error" in result);
  assert.match(result.error, /^You need the Regulars role to add to the Club Codex\./);
  assert.match(result.error, /\/api\/v1\/codex\/fun_facts/);
  assert.match(result.error, /"forbidden"/);
});

test("fun-fact autocomplete lists only the Fun Facts the member may edit", async () => {
  const api = fakeApi({
    facts: [
      funFact({ id: 7, body: "The club began as a forum thread." }),
      funFact({
        id: 6,
        body: "Someone else's fact.",
        author: { user_id: "999", name: "Terra", avatar_url: "/api/v1/users/999/avatar" },
        viewer: { can_edit: false, can_delete: false },
      }),
      funFact({ id: 5 }),
    ],
  });
  const choices = await funFactChoices(
    { actingUserId: REGULAR, query: "", action: "edit" },
    { api },
  );

  assert.deepEqual(api.calls, [`list ${REGULAR} 1 100`]);
  assert.deepEqual(choices, [
    { name: "The club began as a forum thread.", value: "7" },
    { name: "@Kaiserkaze was first called Sir Grindsalot.", value: "5" },
  ]);
});

test("fun-fact autocomplete lists every Fun Fact for a Moderator", async () => {
  const others = [8, 7, 6].map((id) => funFact({
    id,
    body: `Fact number ${id}.`,
    author: { user_id: "999", name: "Terra", avatar_url: "/api/v1/users/999/avatar" },
    viewer: { can_edit: true, can_delete: true },
  }));
  const choices = await funFactChoices(
    { actingUserId: "555", query: "", action: "delete" },
    { api: fakeApi({ facts: others }) },
  );

  assert.deepEqual(choices.map((c) => c.value), ["8", "7", "6"]);
});

test("fun-fact autocomplete narrows to what the member typed, names included", async () => {
  const api = fakeApi({
    facts: [funFact({ id: 7, body: "The club began as a forum thread." }), funFact({ id: 5 })],
  });
  const choices = await funFactChoices(
    { actingUserId: REGULAR, query: "kaiser", action: "edit" },
    { api },
  );

  assert.deepEqual(choices.map((c) => c.value), ["5"]);
});

test("fun-fact autocomplete offers nothing when the API fails", async () => {
  const error = apiError(500, { error: "boom" }, { method: "get", url: "/api/v1/codex/fun_facts" });
  const choices = await funFactChoices(
    { actingUserId: REGULAR, query: "", action: "edit" },
    { api: fakeApi({ error }) },
  );

  assert.deepEqual(choices, []);
});

test("fun-fact edit replaces the picked Fun Fact's text, as the member", async () => {
  const api = fakeApi({ facts: [funFact()] });
  const text = `<@${MENTIONED}> was first called Sir Grindsalot, in 2016.`;
  const result = await editFunFactReply({ factRaw: "5", text, actingUserId: REGULAR }, { api });

  assert.deepEqual(api.calls, [`edit 5 ${REGULAR} ${text}`]);
  assert.match(shown(result), /^## Fun Fact edited$/m);
  assert.ok(shown(result).includes(`> ${text}`));
});

test("fun-fact edit of someone else's Fun Fact shows the API's refusal", async () => {
  const error = apiError(
    403,
    { error: "forbidden", message: "Only its author or a Moderator can edit this." },
    { method: "patch", url: "/api/v1/codex/fun_facts/6", data: { data: { body: "x" } } },
  );
  const result = await editFunFactReply(
    { factRaw: "6", text: "x", actingUserId: REGULAR },
    { api: fakeApi({ error }) },
  );

  assert.ok("error" in result);
  assert.match(result.error, /^Only its author or a Moderator can edit this\./);
  assert.match(result.error, /fun_facts\/6/);
});

test("fun-fact edit and delete ask for a pick from the list when given junk", async () => {
  const api = fakeApi({ facts: [funFact()] });
  const edit = await editFunFactReply({ factRaw: "nope", text: "x", actingUserId: REGULAR }, {
    api,
  });
  const del = await deleteFunFactQuestion({ factRaw: "", actingUserId: REGULAR }, { api });

  assert.deepEqual(api.calls, []);
  assert.match(shown(edit), /Pick a Fun Fact from the list\./);
  assert.match(shown(del), /Pick a Fun Fact from the list\./);
});

test("fun-fact delete asks first, with Delete and Keep buttons, and deletes nothing", async () => {
  const api = fakeApi({ facts: [funFact()] });
  const result = await deleteFunFactQuestion({ factRaw: "5", actingUserId: REGULAR }, { api });

  assert.deepEqual(api.calls, [`get 5 ${REGULAR}`]);
  assert.ok("view" in result);
  assert.match(shown(result), /^## Delete this Fun Fact\?$/m);
  assert.ok(shown(result).includes(`> <@${MENTIONED}> was first called Sir Grindsalot.`));
  assert.deepEqual(
    buttonsOf(result.view.components).map((b) => [b.label, b.customId]),
    [
      ["Delete", buildCodexFunFactId("delete", 5)],
      ["Keep it", buildCodexFunFactId("keep", 5)],
    ],
  );
});

test("fun-fact delete of a Fun Fact the member can't delete is refused up front", async () => {
  const fact = funFact({ viewer: { can_edit: false, can_delete: false } });
  const api = fakeApi({ facts: [fact] });
  const result = await deleteFunFactQuestion({ factRaw: "5", actingUserId: "444" }, { api });

  assert.equal(buttonsOf("view" in result ? result.view.components : []).length, 0);
  assert.match(shown(result), /Only its author or a Moderator can delete this\./);
});

test("fun-fact delete of a missing Fun Fact says so", async () => {
  const result = await deleteFunFactQuestion(
    { factRaw: "41", actingUserId: REGULAR },
    { api: fakeApi({ facts: [funFact()] }) },
  );

  assert.match(shown(result), /There is no Fun Fact 41\. It may have been deleted\./);
});

test("fun-fact delete, confirmed, deletes it as the member", async () => {
  const api = fakeApi({ facts: [funFact()] });
  const result = await deleteFunFactReply({ factId: 5, actingUserId: REGULAR }, { api });

  assert.deepEqual(api.calls, [`remove 5 ${REGULAR}`]);
  assert.match(shown(result), /^## Fun Fact deleted$/m);

  const gone = await deleteFunFactReply({ factId: 41, actingUserId: REGULAR }, { api });
  assert.match(shown(gone), /already deleted/);
});

test("fun-fact delete, confirmed, shows the API's refusal", async () => {
  const error = apiError(
    403,
    { error: "forbidden", message: "Only its author or a Moderator can delete this." },
    { method: "delete", url: "/api/v1/codex/fun_facts/5?acting_user_id=444" },
  );
  const result = await deleteFunFactReply(
    { factId: 5, actingUserId: "444" },
    { api: fakeApi({ error }) },
  );

  assert.ok("error" in result);
  assert.match(result.error, /^Only its author or a Moderator can delete this\./);
  assert.match(result.error, /acting_user_id=444/);
});

test("fun-fact button IDs carry the action and Fun Fact ID, so they work after a restart",
  () => {
    assert.deepEqual(parseCodexFunFactId(buildCodexFunFactId("delete", 5)), {
      action: "delete",
      factId: 5,
    });
    assert.deepEqual(parseCodexFunFactId(buildCodexFunFactId("keep", 12)), {
      action: "keep",
      factId: 12,
    });
    assert.equal(parseCodexFunFactId("codex-fun-fact:explode:5"), null);
    assert.equal(parseCodexFunFactId("codex-fun-fact:delete:x"), null);
    assert.equal(parseCodexFunFactId("codex-fun-fact:delete:5:extra"), null);
    assert.equal(parseCodexFunFactId("challenge-run:delete:5"), null);
  });
