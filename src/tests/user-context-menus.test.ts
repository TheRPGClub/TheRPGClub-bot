import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MetadataStorage } from "discordx";
import "../commands/user-context-menus.command.js";

const DISCORD_USER_CONTEXT_MENU_LIMIT = 5;
const SRC_DIR = join(import.meta.dirname, "..");
const USER_CONTEXT_MENU_PATTERN =
  /@ContextMenu\(\{[^}]*type:\s*ApplicationCommandType\.User\b/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : listSourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

test("user context menus register by name", async () => {
  await MetadataStorage.instance.build();
  const names = MetadataStorage.instance.applicationCommandUsers.map((cmd) => cmd.name);

  for (const name of ["View profile", "Now playing", "Compare completions"]) {
    assert.ok(names.includes(name), `missing user context menu "${name}"`);
  }
});

test("user context menus across src stay within Discord's per-app limit", () => {
  const count = listSourceFiles(SRC_DIR)
    .map((file) => readFileSync(file, "utf8").match(USER_CONTEXT_MENU_PATTERN)?.length ?? 0)
    .reduce((sum, n) => sum + n, 0);

  assert.ok(count >= 3, `expected at least 3 user context menus, found ${count}`);
  assert.ok(
    count <= DISCORD_USER_CONTEXT_MENU_LIMIT,
    `${count} user context menus exceed Discord's limit of ${DISCORD_USER_CONTEXT_MENU_LIMIT}`,
  );
});
