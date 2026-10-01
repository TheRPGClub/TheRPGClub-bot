import test from "node:test";
import assert from "node:assert/strict";

type DiscordModule = {
  optionValueMatches: (pillValue: string, value: string) => boolean;
  pillValueFromText: (pillText: string, name: string) => string;
};

// A runtime path keeps tsc from pulling the runner script, outside src, into the build.
const DISCORD_MODULE =
  new URL("../../scripts/conduct-playwright/discord.ts", import.meta.url).href;
const { optionValueMatches, pillValueFromText } = await import(DISCORD_MODULE) as DiscordModule;

test("optionValueMatches rejects an option name typed into the value", () => {
  assert.equal(optionValueMatches("private:true", "true"), false);
  assert.equal(optionValueMatches("private: true", "true"), false);
});

test("optionValueMatches accepts the exact value in any case", () => {
  assert.equal(optionValueMatches("true", "true"), true);
  assert.equal(optionValueMatches("True", "true"), true);
  assert.equal(optionValueMatches(" Nintendo Switch ", "Nintendo Switch"), true);
});

test("optionValueMatches rejects an empty or partial value", () => {
  assert.equal(optionValueMatches("", "true"), false);
  assert.equal(optionValueMatches("tru", "true"), false);
});

test("pillValueFromText drops the label but keeps a name typed into the value", () => {
  assert.equal(pillValueFromText("private\nTrue", "private"), "True");
  assert.equal(pillValueFromText("private:\nTrue", "private"), "True");
  assert.equal(pillValueFromText("private\nprivate:true", "private"), "private:true");
});
