import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reads the decorator source rather than discordx metadata: admin.command.ts imports the live
// bot from RPGClub_GameDB.ts, which exits without BOT_TOKEN when loaded in a test.
const COMMANDS_DIR = join(import.meta.dirname, "..", "commands");

const EXPECTED_GROUP_PERMISSIONS: [file: string, group: string, constant: string][] = [
  ["admin.command.ts", "admin", "ADMIN_COMMAND_PERMISSIONS"],
  ["mod.command.ts", "mod", "MOD_COMMAND_PERMISSIONS"],
  ["publicreminder.command.ts", "publicreminder", "ADMIN_COMMAND_PERMISSIONS"],
  ["superadmin.command.ts", "superadmin", "SUPERADMIN_COMMAND_PERMISSIONS"],
];

function findRootGroupOptions(source: string, group: string): string | undefined {
  const blocks = source.match(/@SlashGroup\(\{[^}]*\}\)/g) ?? [];
  return blocks.find((block) => block.includes(`name: "${group}"`));
}

test("staff command groups hide from members via default member permissions", () => {
  for (const [file, group, constant] of EXPECTED_GROUP_PERMISSIONS) {
    const source = readFileSync(join(COMMANDS_DIR, file), "utf8");
    const options = findRootGroupOptions(source, group);
    assert.ok(options, `missing root @SlashGroup for /${group} in ${file}`);
    assert.match(
      options,
      new RegExp(`defaultMemberPermissions:\\s*${constant}\\b`),
      `/${group} should set defaultMemberPermissions to ${constant}`,
    );
  }
});
