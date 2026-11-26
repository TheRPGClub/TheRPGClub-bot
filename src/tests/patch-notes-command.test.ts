import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, AxiosHeaders } from "axios";
import { MessageFlags } from "discord.js";

import { patchPageUrl } from "../config/website.js";
import {
  addPreviewNote,
  FEATURE_PREVIEW_NOTE,
  resolveFeatureGate,
  type FeatureState,
  type IFeatureGateSource,
} from "../functions/FeatureGate.js";
import {
  answerPublicOrPrivate,
  type IPublicAnswerIo,
  type PublicOrPrivateAnswer,
} from "../functions/PublicAnswer.js";
import {
  buildPatchNotesAnswer,
  patchNotesVersionsLine,
  type IClubVersions,
  type IPatchNotesApi,
} from "../services/PatchNotesCommand.js";
import { buildPatchPost, PATCH_POST_BUTTON_LABEL } from "../services/PatchPost.js";
import type { IPatchPostText } from "../services/PatchPost.js";

// /patch-notes [number] (spec api#510, bot#1594): the latest or a numbered Patch, posted
// publicly as its #patch-notes message plus the versions line; unknown numbers privately;
// gated by the patch_notes Feature.

const PATCHES: IPatchPostText[] = [
  {
    number: 4,
    title: "The Franchise update",
    cutBody: "Franchises got a page.\n## New\n- Series Line",
    publishedAt: "2026-11-26T15:00:00Z",
  },
  {
    number: 3,
    title: null,
    cutBody: "## Fixed\n- Sign-in stalls",
    publishedAt: "2026-11-20T15:00:00Z",
  },
];

const VERSIONS: IClubVersions = { api: "1.2.0", bot: "2.5.1", www: "1.4.0" };
const NO_VERSIONS: IClubVersions = { api: null, bot: null, www: null };

function fakeApi(
  options: { versions?: IClubVersions | Error; patches?: IPatchPostText[] } = {},
): IPatchNotesApi & { asked: string[] } {
  const patches = options.patches ?? PATCHES;
  const asked: string[] = [];
  return {
    asked,
    latest: async () => {
      asked.push("latest");
      return patches[0] ?? null;
    },
    byNumber: async (number) => {
      asked.push(`patch ${number}`);
      return patches.find((patch) => patch.number === number) ?? null;
    },
    versions: async () => {
      const versions = options.versions ?? VERSIONS;
      if (versions instanceof Error) throw versions;
      return versions;
    },
  };
}

function json(payload: object): Array<Record<string, unknown>> {
  const { components } = payload as { components: unknown[] };
  return components.map((component) => {
    const builder = component as { toJSON?: () => unknown };
    return (typeof builder.toJSON === "function" ? builder.toJSON() : component) as Record<
      string,
      unknown
    >;
  });
}

function textsOf(payload: object): string[] {
  const texts: string[] = [];
  const visit = (node: unknown): void => {
    const item = node as { content?: unknown; components?: unknown[] };
    if (typeof item.content === "string") texts.push(item.content);
    item.components?.forEach(visit);
  };
  json(payload).forEach(visit);
  return texts;
}

function isPrivate(payload: object): boolean {
  return (((payload as { flags?: number }).flags ?? 0) & MessageFlags.Ephemeral) !== 0;
}

function publicPost(answer: PublicOrPrivateAnswer): object {
  assert.ok("public" in answer, JSON.stringify(answer));
  return answer.public;
}

function privateReply(answer: PublicOrPrivateAnswer): object {
  assert.ok("private" in answer, JSON.stringify(answer));
  assert.ok(isPrivate(answer.private), "answered privately");
  return answer.private;
}

test("/patch-notes shows the latest Patch publicly: the post, then the versions line",
  async () => {
    const api = fakeApi();
    const post = publicPost(await buildPatchNotesAnswer(null, api));

    assert.deepEqual(api.asked, ["latest"]);
    assert.equal(isPrivate(post), false);
    assert.deepEqual((post as { allowedMentions?: unknown }).allowedMentions, { parse: [] });
    const components = json(post);
    const posted = json(buildPatchPost(PATCHES[0]));
    assert.deepEqual(components.slice(0, posted.length), posted, "the channel post's shape");
    assert.equal(components.length, posted.length + 1);
    assert.deepEqual(components.at(-1), {
      type: 10,
      content: "-# site 1.4.0 · api 1.2.0 · bot 2.5.1",
    });
    assert.deepEqual(textsOf(post).slice(0, 2), [
      "## Patch 4 · The Franchise update\n-# 26 November 2026",
      PATCHES[0].cutBody,
    ]);
    const row = components.find((component) => component.type === 1) as {
      components: Array<{ label: string; url: string }>;
    };
    assert.equal(row.components[0].label, PATCH_POST_BUTTON_LABEL);
    assert.equal(row.components[0].url, patchPageUrl(4));
  });

test("/patch-notes 3 shows that Patch publicly", async () => {
  const api = fakeApi();
  const post = publicPost(await buildPatchNotesAnswer(3, api));

  assert.deepEqual(api.asked, ["patch 3"]);
  assert.equal(textsOf(post)[0], "## Patch 3\n-# 20 November 2026");
  assert.equal(textsOf(post)[1], PATCHES[1].cutBody);
  assert.equal(textsOf(post).at(-1), "-# site 1.4.0 · api 1.2.0 · bot 2.5.1");
});

test("/patch-notes with an unknown number answers privately", async () => {
  const reply = privateReply(await buildPatchNotesAnswer(99, fakeApi()));
  assert.deepEqual(textsOf(reply), ["There is no Patch 99."]);
});

test("/patch-notes with no published Patch yet answers privately", async () => {
  const reply = privateReply(await buildPatchNotesAnswer(null, fakeApi({ patches: [] })));
  assert.deepEqual(textsOf(reply), ["No Patch has been published yet."]);
});

test("/patch-notes leaves the versions line out before versioning starts", async () => {
  const post = publicPost(await buildPatchNotesAnswer(null, fakeApi({ versions: NO_VERSIONS })));
  assert.deepEqual(json(post), json(buildPatchPost(PATCHES[0])));
});

test("/patch-notes leaves the versions line out when the versions read fails", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const api = fakeApi({ versions: new Error("down") });
  const post = publicPost(await buildPatchNotesAnswer(null, api));
  assert.deepEqual(json(post), json(buildPatchPost(PATCHES[0])));
});

test("versions line names only the repos with a version, in the website's order", () => {
  assert.equal(patchNotesVersionsLine(VERSIONS), "-# site 1.4.0 · api 1.2.0 · bot 2.5.1");
  assert.equal(
    patchNotesVersionsLine({ api: "1.0.0", bot: null, www: "1.0.0" }),
    "-# site 1.0.0 · api 1.0.0",
  );
  assert.equal(patchNotesVersionsLine(NO_VERSIONS), null);
  assert.equal(patchNotesVersionsLine(null), null);
});

test("/patch-notes keeps the body whole: the versions line goes when it would not fit",
  async () => {
    const long = { ...PATCHES[0], cutBody: "x".repeat(3990) };
    const post = publicPost(await buildPatchNotesAnswer(null, fakeApi({ patches: [long] })));
    assert.deepEqual(textsOf(post), [long.cutBody], "no heading, no versions, body whole");
  });

test("/patch-notes shows a failed Patch read privately with its request and response",
  async () => {
    const request = { method: "get", url: "/patches/5", baseURL: "http://api/api/v1" };
    const err = new AxiosError("Request failed with status code 500", "ERR_BAD_RESPONSE",
      { ...request, headers: new AxiosHeaders() }, null, {
        status: 500,
        statusText: "Internal Server Error",
        data: { error: "boom" },
        headers: {},
        config: { ...request, headers: new AxiosHeaders() },
      });
    const api: IPatchNotesApi = {
      ...fakeApi(),
      byNumber: async () => {
        throw err;
      },
    };
    const reply = privateReply(await buildPatchNotesAnswer(5, api));
    const text = textsOf(reply).join("\n");
    assert.match(text, /^Could not read Patch 5\./);
    assert.match(text, /\/patches\/5/);
    assert.match(text, /"boom"/);
  });

/** A /patch-notes interaction that records each step, and a wait that ends on `slow`. */
function answerIo(options: { slow: boolean }): IPublicAnswerIo & { steps: string[] } {
  const steps: string[] = [];
  const shown = (payload: object) =>
    `${isPrivate(payload) ? "private" : "public"} ${textsOf(payload)[0].split("\n")[0]}`;
  return {
    steps,
    reply: async (payload) => { steps.push(`reply ${shown(payload)}`); },
    deferPublicly: async () => { steps.push("defer public"); },
    editReply: async (payload) => { steps.push(`edit ${shown(payload)}`); },
    replaceWithPrivate: async (payload) => { steps.push(`replace ${shown(payload)}`); },
    wait: () => (options.slow ? Promise.resolve() : new Promise(() => undefined)),
  };
}

async function late(answer: Promise<PublicOrPrivateAnswer>): Promise<PublicOrPrivateAnswer> {
  const value = await answer;
  await new Promise((resolve) => setImmediate(resolve));
  return value;
}

test("/patch-notes answers an unknown number privately, even after a public defer",
  async () => {
    const quick = answerIo({ slow: false });
    await answerPublicOrPrivate(buildPatchNotesAnswer(99, fakeApi()), quick, 1500);
    assert.deepEqual(quick.steps, ["reply private There is no Patch 99."]);

    const slow = answerIo({ slow: true });
    await answerPublicOrPrivate(late(buildPatchNotesAnswer(99, fakeApi())), slow, 1500);
    assert.deepEqual(slow.steps, ["defer public", "replace private There is no Patch 99."]);
  });

test("/patch-notes posts a slow read in the public deferred reply", async () => {
  const io = answerIo({ slow: true });
  await answerPublicOrPrivate(late(buildPatchNotesAnswer(null, fakeApi())), io, 1500);
  assert.deepEqual(io.steps, ["defer public", "edit public ## Patch 4 · The Franchise update"]);
});

function gate(state: FeatureState, staffIds: string[] = []): IFeatureGateSource {
  return {
    flags: async () => [{ key: "patch_notes", name: "Patch Notes", state }],
    isStaff: async (id) => staffIds.includes(id),
  };
}

const COMMAND = { type: "command", name: "patch-notes" } as const;

test("/patch-notes is refused for everyone while Patch Notes is Off", async () => {
  assert.equal(await resolveFeatureGate(COMMAND, "admin", gate("off", ["admin"])),
    "not_available");
  assert.equal(await resolveFeatureGate(COMMAND, "member", gate("off")), "not_available");
});

test("/patch-notes in Preview: staff only, with the Preview note on the post", async () => {
  const source = gate("preview", ["admin"]);
  assert.equal(await resolveFeatureGate(COMMAND, "admin", source), "preview_note");
  assert.equal(await resolveFeatureGate(COMMAND, "member", source), "not_available");

  const post = publicPost(await buildPatchNotesAnswer(null, fakeApi()));
  assert.equal(textsOf(addPreviewNote(post)).at(-1), FEATURE_PREVIEW_NOTE);
});

test("/patch-notes runs for every member when Patch Notes is Live", async () => {
  assert.equal(await resolveFeatureGate(COMMAND, "member", gate("live")), "run");
});
