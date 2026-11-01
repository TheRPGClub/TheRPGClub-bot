import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discordx";
import {
  HIGHLIGHT_MESSAGE_TEXT_BUDGET,
  HIGHLIGHTS_PER_MESSAGE,
  resolveAchievementHighlightConfig,
  runAchievementHighlightTick,
  startAchievementHighlightService,
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
  return { data, alerts };
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
  highlightAcks: number[][];
  alertAcks: string[];
}

function harness(
  pages: IPendingHighlights[],
  options: {
    highlightChannel?: IFakeChannel;
    adminChannel?: IFakeChannel;
  } = {},
): IHarness {
  const highlightChannel = options.highlightChannel ?? fakeChannel();
  const adminChannel = options.adminChannel ?? fakeChannel();
  const highlightAcks: number[][] = [];
  const alertAcks: string[] = [];
  let fetches = 0;
  const deps: IAchievementHighlightDeps = {
    api: {
      fetchPending: async () => pages[fetches++] ?? page([]),
      ackHighlights: async (ids: number[]) => {
        highlightAcks.push(ids);
      },
      ackAlert: async (alert: string) => {
        alertAcks.push(alert);
      },
    },
    getHighlightChannel: async () => highlightChannel,
    getAdminChannel: async () => adminChannel,
    wwwBaseUrl: "https://club.example",
    ackRetryDelayMs: 0,
  };
  return { deps, highlightChannel, adminChannel, highlightAcks, alertAcks };
}

test("a pending Highlight is posted without mentions, then its id is acked", async () => {
  const h = harness([page([highlight(7)])]);

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.highlightChannel.sent.length, 1);
  assert.deepEqual(h.highlightChannel.sent[0]!.allowedMentions, { parse: [] });
  assert.deepEqual(h.highlightAcks, [[7]]);
});

function range(from: number, to: number): IAchievementHighlight[] {
  return Array.from({ length: to - from + 1 }, (_, index) => highlight(from + index));
}

function ids(items: IAchievementHighlight[]): number[] {
  return items.map((item) => item.id);
}

test("more than 10 Highlights are split into messages of at most 10 cards", async () => {
  const h = harness([page(range(1, 25))]);

  await runAchievementHighlightTick(h.deps);

  assert.deepEqual(
    h.highlightChannel.sent.map((message) => message.components.length),
    [10, 10, 5],
  );
  assert.deepEqual(h.highlightAcks, [range(1, 10), range(11, 20), range(21, 25)].map(ids));
});

test("a message Discord rejects is not acked, and the tick stops there", async () => {
  const h = harness([page(range(1, 25))], { highlightChannel: fakeChannel(2) });

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.highlightChannel.sent.length, 1);
  assert.deepEqual(h.highlightAcks, [ids(range(1, 10))]);
});

test("a failed ack is retried once", async () => {
  const h = harness([page([highlight(7)])]);
  let calls = 0;
  h.deps.api.ackHighlights = async (acked: number[]) => {
    calls += 1;
    if (calls === 1) throw new Error("503 Service Unavailable");
    h.highlightAcks.push(acked);
  };

  await runAchievementHighlightTick(h.deps);

  assert.equal(calls, 2);
  assert.deepEqual(h.highlightAcks, [[7]]);
});

test("an ack that fails twice stops posting Highlights for this tick", async () => {
  const h = harness([page(range(1, 15))]);
  let calls = 0;
  h.deps.api.ackHighlights = async () => {
    calls += 1;
    throw new Error("503 Service Unavailable");
  };

  await runAchievementHighlightTick(h.deps);

  assert.equal(calls, 2);
  assert.equal(h.highlightChannel.sent.length, 1);
});

test("nothing is acked when the first message fails", async () => {
  const h = harness([page([highlight(3)])], {
    highlightChannel: fakeChannel(1),
  });

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
    achievement: {
      ...highlight(1).achievement,
      tier: "platinum",
      rarity: 12.5,
    },
    achievement_set: { ...highlight(1).achievement_set, provider: "psn" },
  });
  const mastery = highlight(2, {
    highlight: "mastery",
    hardcore: true,
    achievement_set: {
      ...highlight(2).achievement_set,
      provider: "retroachievements",
    },
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

const EXPIRED_ALERTS: IAchievementHubAlerts = {
  psn_auth_expired_at: "2026-11-01T06:00:00Z",
  psn_auth_alerted: false,
};

test("an expired PSN token is posted to the admin channel once, then acked", async () => {
  const h = harness([page([], EXPIRED_ALERTS)]);

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.adminChannel.sent.length, 1);
  assert.deepEqual(h.adminChannel.sent[0]!.allowedMentions, { parse: [] });
  assert.match(cardText(h.adminChannel.sent[0]!), /psn_npsso/);
  assert.deepEqual(h.alertAcks, ["psn_auth_expired"]);
  assert.equal(h.highlightChannel.sent.length, 0);
  assert.deepEqual(h.highlightAcks, []);
});

test("an alert already posted for this expiry is not posted again", async () => {
  const alerted = { ...EXPIRED_ALERTS, psn_auth_alerted: true };
  const h = harness([page([], alerted)]);

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.adminChannel.sent.length, 0);
  assert.deepEqual(h.alertAcks, []);
});

test("the alert is not acked when Discord rejects it", async () => {
  const h = harness([page([], EXPIRED_ALERTS)], {
    adminChannel: fakeChannel(1),
  });

  await runAchievementHighlightTick(h.deps);

  assert.deepEqual(h.alertAcks, []);
});

test("the alert is still posted when posting Highlights fails", async () => {
  const h = harness([page([highlight(1)], EXPIRED_ALERTS)], {
    highlightChannel: fakeChannel(1),
  });

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.adminChannel.sent.length, 1);
  assert.deepEqual(h.alertAcks, ["psn_auth_expired"]);
});

test("an API error is logged and leaves everything for the next tick", async () => {
  const h = harness([]);
  h.deps.api.fetchPending = async () => {
    throw new Error("503 Service Unavailable");
  };

  await runAchievementHighlightTick(h.deps);

  assert.equal(h.highlightChannel.sent.length, 0);
  assert.equal(h.adminChannel.sent.length, 0);
  assert.deepEqual(h.highlightAcks, []);
});

test("the service is disabled without an achievements channel", () => {
  assert.equal(resolveAchievementHighlightConfig("", "https://club.example"), null);
  assert.equal(startAchievementHighlightService({} as Client, { channelId: "" }), false);
});

test("the service is disabled without the www base URL", () => {
  assert.equal(resolveAchievementHighlightConfig("123", " "), null);
});

test("the service config trims the www base URL", () => {
  assert.deepEqual(resolveAchievementHighlightConfig("123", " https://club.example/ "), {
    channelId: "123",
    wwwBaseUrl: "https://club.example",
  });
});

/** Every text display's content in a message, as Discord counts it against 4000. */
function textContents(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textContents);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, field]) =>
      key === "content" && typeof field === "string" ? [field] : textContents(field),
    );
  }
  return [];
}

function messageTextLength(message: IHighlightMessage): number {
  return textContents(message.components.map((component) => component.toJSON())).join("").length;
}

function markdownHeavy(id: number): IAchievementHighlight {
  const noisy = "_*~`|".repeat(40);
  return highlight(id, {
    display_name: noisy,
    achievement: { ...highlight(id).achievement, name: noisy },
    achievement_set: {
      ...highlight(id).achievement_set,
      title: noisy,
      platform_label: noisy,
    },
  });
}

test("each message stays under Discord's text budget, however much the fields escape", async () => {
  const h = harness([page(Array.from({ length: 25 }, (_, index) => markdownHeavy(index + 1)))]);

  await runAchievementHighlightTick(h.deps);

  assert.ok(h.highlightChannel.sent.length > 3, "the budget splits before 10 cards");
  for (const message of h.highlightChannel.sent) {
    assert.ok(messageTextLength(message) <= HIGHLIGHT_MESSAGE_TEXT_BUDGET);
    assert.ok(message.components.length <= HIGHLIGHTS_PER_MESSAGE);
  }
  assert.deepEqual(
    h.highlightAcks.flat(),
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
});

test("a card field is capped after escaping", async () => {
  const h = harness([page([markdownHeavy(1)])]);

  await runAchievementHighlightTick(h.deps);

  const setLine = textContents(h.highlightChannel.sent[0]!.components[0]!.toJSON())
    .join("")
    .split("\n")[1]!;
  const [title, platform] = setLine.split(" · ");
  assert.ok(title!.length <= 80 + 2, `title is ${title!.length} characters`);
  assert.ok(platform!.length <= 80, `platform is ${platform!.length} characters`);
});

test("a blank platform label leaves no empty segment in the set line", async () => {
  const blank = highlight(1, {
    achievement_set: { ...highlight(1).achievement_set, platform_label: "   " },
  });
  const h = harness([page([blank])]);

  await runAchievementHighlightTick(h.deps);

  const text = textContents(h.highlightChannel.sent[0]!.components[0]!.toJSON()).join("");
  assert.match(text, /\*Chrono Trigger\* · Steam/);
});
