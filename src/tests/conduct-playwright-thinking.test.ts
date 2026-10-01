import test from "node:test";
import assert from "node:assert/strict";

type DiscordModule = { isThinkingPlaceholder: (text: string) => boolean };

// A runtime path keeps tsc from pulling the runner script, outside src, into the build.
const DISCORD_MODULE =
  new URL("../../scripts/conduct-playwright/discord.ts", import.meta.url).href;
const { isThinkingPlaceholder } = await import(DISCORD_MODULE) as DiscordModule;

test("isThinkingPlaceholder spots a deferred reply's placeholder", () => {
  assert.equal(isThinkingPlaceholder("RPGClubbot (Preview) is thinking..."), true);
  assert.equal(isThinkingPlaceholder("RPGClubbot (Preview) is thinking…"), true);
  assert.equal(
    isThinkingPlaceholder("RPGClubbot (Preview) is thinking...\nOnly you can see this"),
    true,
  );
});

test("isThinkingPlaceholder leaves a real reply alone", () => {
  assert.equal(isThinkingPlaceholder("Completed Games\nSelect a completion to delete"), false);
  assert.equal(isThinkingPlaceholder("Who is thinking about Chrono Trigger"), false);
  assert.equal(isThinkingPlaceholder(""), false);
});
