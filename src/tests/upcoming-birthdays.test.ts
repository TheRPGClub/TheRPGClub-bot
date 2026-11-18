import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUpcomingBirthdaysView,
  type IBirthdaysApi,
  type IUpcomingBirthday,
} from "../services/UpcomingBirthdaysService.js";
import { textOf } from "./challengeFixtures.js";

// Wednesday 18 November 2026, 14:32 in New York (club time).
const NOW = new Date("2026-11-18T19:32:00Z");

function entry(userId: string, on: string, today = false): IUpcomingBirthday {
  const [, month, day] = on.split("-").map(Number);
  return { userId, displayName: `Member ${userId}`, month, day, on, today };
}

interface IFakeBirthdaysApi extends IBirthdaysApi {
  calls: string[];
}

function fakeApi(options: {
  upcoming?: IUpcomingBirthday[];
  own?: string | null;
  upcomingError?: unknown;
  ownError?: unknown;
} = {}): IFakeBirthdaysApi {
  const api: IFakeBirthdaysApi = {
    calls: [],
    listUpcoming: async () => {
      api.calls.push("upcoming");
      if (options.upcomingError) throw options.upcomingError;
      return options.upcoming ?? [];
    },
    getSharedBirthday: async (userId) => {
      api.calls.push(`shared birthday of ${userId}`);
      if (options.ownError) throw options.ownError;
      return options.own ?? null;
    },
  };
  return api;
}

const UPCOMING = [
  entry("1", "2026-11-18", true),
  entry("2", "2026-11-20"),
  entry("3", "2026-11-26"),
  entry("4", "2026-12-05"),
  entry("5", "2026-12-05"),
  entry("6", "2026-12-05"),
  entry("7", "2026-12-14"),
];

test("/birthdays: groups Today, This week, Next week and Later with a countdown", async () => {
  const api = fakeApi({ upcoming: UPCOMING });
  const view = await buildUpcomingBirthdaysView("42", { api, now: () => NOW });
  const text = textOf(view.components);

  assert.equal(text, [
    "## Upcoming Birthdays",
    "### 🎂 Today\n<@1>",
    "### This week\n<@2> · Fri 20 Nov · in 2 days",
    "### Next week\n<@3> · Thu 26 Nov · in 8 days",
    "### Later\n<@4>, <@5> and <@6> · Sat 5 Dec · in 17 days\n<@7> · Mon 14 Dec · in 26 days",
    "-# You're not sharing your Birthday. Turn it on with `/profile birth-date share:True`.",
  ].join("\n"));
});

test("/birthdays: the empty state says nobody's Birthday falls in the next 30 days",
  async () => {
    const api = fakeApi({ upcoming: [] });
    const view = await buildUpcomingBirthdaysView("42", { api, now: () => NOW });

    assert.equal(textOf(view.components), [
      "## Upcoming Birthdays",
      "Nobody's Birthday falls in the next 30 days.",
      "-# You're not sharing your Birthday. Turn it on with `/profile birth-date share:True`.",
    ].join("\n"));
  });

test("/birthdays: a member who shares sees their own Birthday in the footer", async () => {
  const api = fakeApi({ upcoming: UPCOMING, own: "05-04" });
  const view = await buildUpcomingBirthdaysView("42", { api, now: () => NOW });

  assert.deepEqual(api.calls.toSorted(), ["shared birthday of 42", "upcoming"]);
  assert.match(textOf(view.components), /\n-# You're sharing yours: 4 May\.$/);
});

test("/birthdays: mentions in the reply don't ping", async () => {
  const view = await buildUpcomingBirthdaysView("42", {
    api: fakeApi({ upcoming: UPCOMING }),
    now: () => NOW,
  });
  assert.deepEqual(view.allowedMentions, { parse: [] });
});

test("/birthdays: weeks run Monday to Sunday, so on a Sunday tomorrow is next week",
  async () => {
    // Sunday 22 November 2026, 09:00 in New York.
    const sunday = new Date("2026-11-22T14:00:00Z");
    const api = fakeApi({
      upcoming: [entry("1", "2026-11-23"), entry("2", "2026-11-29"), entry("3", "2026-11-30")],
    });
    const view = await buildUpcomingBirthdaysView("42", { api, now: () => sunday });
    const text = textOf(view.components);

    assert.ok(!text.includes("This week"), text);
    assert.ok(text.includes(
      "### Next week\n<@1> · Mon 23 Nov · tomorrow\n<@2> · Sun 29 Nov · in 7 days\n" +
        "### Later\n<@3> · Mon 30 Nov · in 8 days",
    ), text);
  });

test("/birthdays: today follows the API's club day, even just after midnight UTC", async () => {
  // 23:30 on 18 November in New York is already 19 November in UTC.
  const lateEvening = new Date("2026-11-19T04:30:00Z");
  const api = fakeApi({ upcoming: [entry("1", "2026-11-18", true), entry("2", "2026-11-19")] });
  const view = await buildUpcomingBirthdaysView("42", { api, now: () => lateEvening });

  assert.ok(textOf(view.components).includes(
    "### 🎂 Today\n<@1>\n### This week\n<@2> · Thu 19 Nov · tomorrow",
  ));
});

test("/birthdays: without the member's Birth Date the footer is left out", async () => {
  const api = fakeApi({ upcoming: UPCOMING, ownError: new Error("API down") });
  const view = await buildUpcomingBirthdaysView("42", { api, now: () => NOW });
  const text = textOf(view.components);

  assert.ok(text.endsWith("<@7> · Mon 14 Dec · in 26 days"), text);
});

test("/birthdays: a failed Upcoming Birthdays read is thrown for the error reply", async () => {
  const failure = new Error("API down");
  const api = fakeApi({ upcomingError: failure });
  await assert.rejects(buildUpcomingBirthdaysView("42", { api, now: () => NOW }), failure);
});

test("/birthdays: a list too long for one message ends with how many more there are",
  async () => {
    // 250 members on the ten days from 5 December, 25 a day.
    const many = Array.from({ length: 250 }, (_, index) => {
      const day = String(5 + Math.floor(index / 25)).padStart(2, "0");
      return entry(String(100_000_000_000_000_000n + BigInt(index)), `2026-12-${day}`);
    });
    const api = fakeApi({ upcoming: many });
    const view = await buildUpcomingBirthdaysView("42", { api, now: () => NOW });
    const text = textOf(view.components);

    assert.ok(text.length <= 4000, String(text.length));
    assert.match(text, /\nand \d+ more Birthdays\.\n-# You're not sharing/);
    const shown = text.match(/<@\d+>/g)?.length ?? 0;
    const more = Number(text.match(/and (\d+) more Birthdays/)?.[1]);
    assert.equal(shown + more, 250);
  });
