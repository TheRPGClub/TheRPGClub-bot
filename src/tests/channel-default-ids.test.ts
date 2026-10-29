import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CHANNELS_SOURCE = readFileSync(
  new URL("../config/channels.ts", import.meta.url),
  "utf8",
);

// Names that share one production channel on purpose.
const SHARED_DEFAULT_GROUPS: ReadonlySet<string>[] = [
  new Set(["BOT_DEV_CHANNEL_ID", "TEST_LOG_CHANNEL_ID"]),
  new Set(["COMPLETION_REACTION_DEV_CHANNEL_ID", "GAMEDB_UPDATES_CHANNEL_ID"]),
];

function readDefaults(): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const match of CHANNELS_SOURCE.matchAll(/resolveId\(\s*"(\w+)",\s*"(\d+)"/g)) {
    defaults.set(match[1]!, match[2]!);
  }
  return defaults;
}

test("production channel defaults are unique unless the names are meant to share one", () => {
  const namesById = new Map<string, string[]>();
  for (const [name, id] of readDefaults()) {
    namesById.set(id, [...(namesById.get(id) ?? []), name]);
  }
  for (const [id, names] of namesById) {
    if (names.length < 2) continue;
    const intended = SHARED_DEFAULT_GROUPS.some(
      (group) => group.size === names.length && names.every((name) => group.has(name)),
    );
    assert.ok(intended, `${names.join(", ")} share the default channel ID ${id}`);
  }
});

test("the announcements channel does not default to whatcha-playing", () => {
  const defaults = readDefaults();
  assert.notEqual(
    defaults.get("ANNOUNCEMENT_CHANNEL_ID"),
    defaults.get("WHATCHA_PLAYING_CHANNEL_ID"),
  );
});
