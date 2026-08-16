import assert from "node:assert/strict";
import test from "node:test";
import { extractFirstUrl, isBlockedPreviewUrl } from "../functions/LinkPreviewEmbeds.js";

const JUMP_LINK
  = "https://discord.com/channels/191941851757019136/360819470836695042/742474880666173503";
const POST_URL = "https://xcancel.com/ReticentY2K/status/2082451207650488402";

test("blocks a Discord message jump link", () => {
  assert.equal(isBlockedPreviewUrl(JUMP_LINK), true);
});

test("blocks Discord invites, CDN hosts and subdomains", () => {
  const blocked = [
    "https://discord.gg/rpgclub",
    "https://cdn.discordapp.com/attachments/1/2/file.png",
    "https://media.discordapp.net/attachments/1/2/file.png",
    "https://ptb.discord.com/channels/1/2/3",
    "https://canary.discord.com/channels/1/2/3",
    "https://discordstatus.com/",
  ];
  for (const url of blocked) {
    assert.equal(isBlockedPreviewUrl(url), true, url);
  }
});

test("allows non-Discord hosts, including lookalike domains", () => {
  const allowed = [
    POST_URL,
    "https://store.steampowered.com/app/1/",
    "https://notdiscord.com/channels/1/2/3",
    "https://discord.com.evil.example/channels/1/2/3",
  ];
  for (const url of allowed) {
    assert.equal(isBlockedPreviewUrl(url), false, url);
  }
});

test("extractFirstUrl skips a Discord link and returns the next eligible URL", () => {
  assert.equal(extractFirstUrl(`see ${JUMP_LINK} and also ${POST_URL}`), POST_URL);
});

test("extractFirstUrl returns undefined when every URL is blocked", () => {
  assert.equal(extractFirstUrl(`${JUMP_LINK} https://discord.gg/rpgclub`), undefined);
});

test("extractFirstUrl still returns a lone eligible URL", () => {
  assert.equal(extractFirstUrl(`check this out ${POST_URL}`), POST_URL);
});

test("extractFirstUrl is not stateful across calls", () => {
  assert.equal(extractFirstUrl(POST_URL), POST_URL);
  assert.equal(extractFirstUrl(POST_URL), POST_URL);
});
