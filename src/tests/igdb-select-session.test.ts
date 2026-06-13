import assert from "node:assert/strict";
import test from "node:test";
import {
  createIgdbSession,
  getIgdbSession,
  deleteIgdbSession,
  buildIgdbComponents,
  handleIgdbFirstMatchInteraction,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";

const OWNER = "111111111111111111";

const sampleOptions = (): IgdbSelectOption[] => [
  { id: 10, label: "Final Fantasy VII" },
  { id: 20, label: "Halo" },
];

function selectCustomId(components: ReturnType<typeof buildIgdbComponents>): string {
  const json = JSON.parse(JSON.stringify(components));
  for (const row of json) {
    for (const comp of row.components ?? []) {
      // eslint-disable-next-line local/igdb-session-id-built-centrally
      if (typeof comp.custom_id === "string" && comp.custom_id.startsWith("igdb-select:")) {
        return comp.custom_id;
      }
    }
  }
  throw new Error("no igdb-select custom id found");
}

test("createIgdbSession yields a unique id per call for the same owner", () => {
  const a = createIgdbSession(OWNER, sampleOptions(), async () => {});
  const b = createIgdbSession(OWNER, sampleOptions(), async () => {});

  assert.notEqual(a.sessionId, b.sessionId);
  assert.ok(getIgdbSession(a.sessionId), "first session should still exist");
  assert.ok(getIgdbSession(b.sessionId), "second session should still exist");

  deleteIgdbSession(a.sessionId);
  deleteIgdbSession(b.sessionId);
});

test("a second same-owner session does not clobber the first", () => {
  // Reproduces issue #861: two overlapping IGDB flows for one user must both resolve.
  const first = createIgdbSession(OWNER, sampleOptions(), async () => {});
  const second = createIgdbSession(OWNER, sampleOptions(), async () => {});

  // Completing/deleting the newer session must leave the older one intact.
  deleteIgdbSession(second.sessionId);
  assert.ok(getIgdbSession(first.sessionId), "older session should survive newer one");

  const customId = selectCustomId(buildIgdbComponents(first.sessionId, 0));
  assert.ok(customId.includes(first.sessionId), "custom id must embed the owning session id");
  assert.ok(!customId.includes(":igdb-" + OWNER + ":"), "id must not collapse to per-user key");

  deleteIgdbSession(first.sessionId);
});

test("session id never contains a colon (custom-id parser relies on it)", () => {
  const { sessionId } = createIgdbSession(OWNER, sampleOptions(), async () => {});
  assert.ok(!sessionId.includes(":"), "session id must be colon-free");
  deleteIgdbSession(sessionId);
});

test("Import First Match on a missing/expired session replies with the expired notice", async () => {
  const replies: any[] = [];
  // A custom id whose session was never registered (e.g. wiped by restart).
  const interaction: any = {
    // eslint-disable-next-line local/igdb-session-id-built-centrally
    customId: `igdb-first:igdb-${OWNER}-deadbeef`,
    user: { id: OWNER },
    replied: false,
    deferred: false,
    reply: async (opts: any) => {
      replies.push(opts);
      interaction.replied = true;
    },
    deferUpdate: async () => {},
  };

  const handled = await handleIgdbFirstMatchInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.match(JSON.stringify(replies[0]), /has expired/);
});

test("Import First Match on a live session imports the first sorted option", async () => {
  let importedId: number | null = null;
  const { sessionId } = createIgdbSession(
    OWNER,
    // "Halo" sorts before "Final Fantasy VII" (shorter label first).
    [{ id: 10, label: "Final Fantasy VII" }, { id: 20, label: "Halo" }],
    async (_interaction, gameId) => {
      importedId = gameId;
    },
  );

  const interaction: any = {
    // eslint-disable-next-line local/igdb-session-id-built-centrally
    customId: `igdb-first:${sessionId}`,
    user: { id: OWNER },
    replied: false,
    deferred: false,
    reply: async () => {},
    deferUpdate: async () => {},
  };

  const handled = await handleIgdbFirstMatchInteraction(interaction);

  assert.equal(handled, true);
  assert.equal(importedId, 20);
  assert.equal(getIgdbSession(sessionId), undefined, "session is consumed after import");
});
