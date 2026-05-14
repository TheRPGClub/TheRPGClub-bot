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
    endTime: "23:30",
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
    endTime: "23:30",
    start: "2026-05-01 21:30",
    timeZone: "Mars/Olympus",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});

test("parseLiveStreamModalInput rejects invalid time format", () => {
  const parsed = parseLiveStreamModalInput({
    endTime: "9pm",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});

test("parseLiveStreamModalInput rejects invalid image url protocol", () => {
  const parsed = parseLiveStreamModalInput({
    endTime: "23:30",
    imageUrl: "ftp://example.com/banner.png",
    start: "2026-05-01 21:30",
    timeZone: "America/New_York",
    topic: "Nintendo Direct",
  });

  assert.equal(parsed.ok, false);
});
