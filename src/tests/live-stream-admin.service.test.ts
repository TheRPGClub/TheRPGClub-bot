import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveStreamModalCustomId,
  parseLiveStreamModalInput,
} from "../commands/admin/live-stream-admin.service.js";

test("buildLiveStreamModalCustomId includes prefix and user id", () => {
  const customId = buildLiveStreamModalCustomId("123456789012345678");
  assert.equal(customId, "admin-live-stream-create:123456789012345678");
});

test("parseLiveStreamModalInput accepts valid iana timezone and datetime", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: "https://example.com/banner.png",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.topic, "Nintendo Direct");
    assert.equal(parsed.value.timeZone, "America/New_York");
    assert.equal(Boolean(parsed.value.imageUrl), true);
    assert.equal(parsed.value.endsAt.getTime() > parsed.value.startsAt.getTime(), true);
  }
});

test("parseLiveStreamModalInput rejects invalid timezone", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    start: "2026-05-01 21:30",
    timeZone: "Mars/Olympus",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});

test("parseLiveStreamModalInput rejects invalid time format", () => {
  const parsed = parseLiveStreamModalInput({
    end: "9pm",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});

test("parseLiveStreamModalInput rejects invalid image url protocol", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: "ftp://example.com/banner.png",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "Optional Thread Image URL must use http or https.");
  }
});

test("parseLiveStreamModalInput rejects a malformed image url", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: "not a url",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error, "Optional Thread Image URL must be a valid URL.");
  }
});

test("parseLiveStreamModalInput rejects end before start", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 20:30",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});

test("parseLiveStreamModalInput keeps image url characters markdown sanitizing strips", () => {
  const imageUrl = "https://example.com/key_art/~user/banner--wide_1.png?size=large_2";
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl,
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.imageUrl, imageUrl);
  }
});

test("parseLiveStreamModalInput unwraps an angle-bracketed image url", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: " <https://example.com/key_art.png> ",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.imageUrl, "https://example.com/key_art.png");
  }
});

test("parseLiveStreamModalInput treats a blank image url as absent", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: "   ",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.imageUrl, undefined);
  }
});

test("parseLiveStreamModalInput strips invisible characters pasted into the image url", () => {
  const parsed = parseLiveStreamModalInput({
    end: "2026-05-01 23:30",
    imageUrl: "https://example.com/key​_art.png﻿",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.imageUrl, "https://example.com/key_art.png");
  }
});
