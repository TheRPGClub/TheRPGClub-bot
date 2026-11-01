import test from "node:test";
import assert from "node:assert/strict";
import {
  runAchievementHighlightTick,
  type IAchievementHighlight,
  type IAchievementHighlightDeps,
  type IAchievementHubAlerts,
  type IHighlightChannel,
  type IHighlightMessage,
  type IPendingHighlights,
} from "../services/AchievementHighlightService.js";

const HEALTHY_ALERTS: IAchievementHubAlerts = {
  psn_auth_expired_at: null,
  psn_auth_alerted: false,
};

function highlight(id: number, overrides: Partial<IAchievementHighlight> = {}) {
  return {
    id,
    highlight: "rare",
    hardcore: false,
    unlocked_at: "2026-11-01T10:00:00Z",
    user_id: "191938640413327360",
    display_name: "Merph",
    url_path: "/members/191938640413327360/achievements/42",
    achievement: {
      id: 900 + id,
      name: `Achievement ${id}`,
      description: null,
      icon_url: `https://cdn.example/a${id}.png`,
      tier: null,
      points: null,
      rarity: 3.25,
    },
    achievement_set: {
      id: 42,
      title: "Chrono Trigger",
      provider: "steam",
      platform_label: null,
      icon_url: null,
    },
    ...overrides,
  } satisfies IAchievementHighlight;
}

function page(
  data: IAchievementHighlight[],
  alerts: IAchievementHubAlerts = HEALTHY_ALERTS,
): IPendingHighlights {
  return {
    data,
    meta: { cursor: 0, next_cursor: data.length ? data[data.length - 1]!.id : null },
    alerts,
  };
}

interface IFakeChannel extends IHighlightChannel {
  sent: IHighlightMessage[];
}

function fakeChannel(failOnCall?: number): IFakeChannel {
  const sent: IHighlightMessage[] = [];
  return {
    sent,
    send: async (message: IHighlightMessage) => {
      if (failOnCall === sent.length + 1) throw new Error("Discord rejected the message");
      sent.push(message);
      return {};
    },
  };
}

interface IHarness {
  deps: IAchievementHighlightDeps;
  highlightChannel: IFakeChannel;
  adminChannel: IFakeChannel;
  highlightAcks: number[];
  alertAcks: string[];
}

function harness(
  pages: IPendingHighlights[],
  options: { highlightChannel?: IFakeChannel; adminChannel?: IFakeChannel } = {},
): IHarness {
  const highlightChannel = options.highlightChannel ?? fakeChannel();
  const adminChannel = options.adminChannel ?? fakeChannel();
  const highlightAcks: number[] = [];
  const alertAcks: string[] = [];
  let fetches = 0;
  const deps: IAchievementHighlightDeps = {
    api: {
      fetchPending: async () => pages[fetches++] ?? page([]),
      ackHighlights: async (cursor: number) => {
        highlightAcks.push(cursor);
      },
      ackAlert: async (alert: string) => {
        alertAcks.push(alert);
      },
    },
    getHighlightChannel: async () => highlightChannel,
    getAdminChannel: async () => adminChannel,
    wwwBaseUrl: "https://club.example",
  };
  return { deps, highlightChannel, adminChannel, highlightAcks, alertAcks };
}

test("a pending Highlight is posted without mentions, then its cursor is acked", async () => {
  const h = harness([page([highlight(7)])]);

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.highlightChannel.sent.length, 1);
  assert.deepEqual(h.highlightChannel.sent[0]!.allowedMentions, { parse: [] });
  assert.deepEqual(h.highlightAcks, [7]);
});

function range(from: number, to: number): IAchievementHighlight[] {
  return Array.from({ length: to - from + 1 }, (_, index) => highlight(from + index));
}

test("more than 10 Highlights are split into messages of at most 10 cards", async () => {
  const h = harness([page(range(1, 25))]);

  await runAchievementHighlightTick(h.deps);

  assert.deepEqual(h.highlightChannel.sent.map((message) => message.components.length), [
    10, 10, 5,
  ]);
  assert.deepEqual(h.highlightAcks, [10, 20, 25]);
});

test("a message Discord rejects is not acked, and the tick stops there", async () => {
  const h = harness([page(range(1, 25))], { highlightChannel: fakeChannel(2) });

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.highlightChannel.sent.length, 1);
  assert.deepEqual(h.highlightAcks, [10]);
});

test("nothing is acked when the first message fails", async () => {
  const h = harness([page([highlight(3)])], { highlightChannel: fakeChannel(1) });

  await runAchievementHighlightTick(h.deps);

  assert.deepEqual(h.highlightAcks, []);
});

function cardText(message: IHighlightMessage, index = 0): string {
  return JSON.stringify(message.components[index]!.toJSON());
}

test("a card names the member without a mention and shows the Achievement", async () => {
  const h = harness([page([highlight(7, { display_name: "@everyone <@1>" })])]);

  await runAchievementHighlightTick(h.deps);

  const text = cardText(h.highlightChannel.sent[0]!);
  assert.ok(!text.includes("<@191938640413327360>"), "the member is never mentioned");
  assert.ok(text.includes("Achievement 7"));
  assert.ok(text.includes("Chrono Trigger"));
  assert.ok(text.includes("Steam"));
  assert.ok(text.includes("3.25%"));
  assert.ok(text.includes("https://cdn.example/a7.png"), "the Achievement icon is shown");
  assert.ok(
    text.includes("https://club.example/members/191938640413327360/achievements/42"),
    "the card links the www set page",
  );
});

test("a card shows the PSN tier and the RetroAchievements hardcore marker", async () => {
  const platinum = highlight(1, {
    highlight: "platinum",
    achievement: { ...highlight(1).achievement, tier: "platinum", rarity: 12.5 },
    achievement_set: { ...highlight(1).achievement_set, provider: "psn" },
  });
  const mastery = highlight(2, {
    highlight: "mastery",
    hardcore: true,
    achievement_set: { ...highlight(2).achievement_set, provider: "retroachievements" },
  });
  const h = harness([page([platinum, mastery])]);

  await runAchievementHighlightTick(h.deps);

  const message = h.highlightChannel.sent[0]!;
  assert.match(cardText(message, 0), /Platinum trophy/);
  assert.match(cardText(message, 0), /PlayStation Network/);
  assert.match(cardText(message, 1), /Mastery/);
  assert.match(cardText(message, 1), /Hardcore/);
  assert.match(cardText(message, 1), /RetroAchievements/);
});
