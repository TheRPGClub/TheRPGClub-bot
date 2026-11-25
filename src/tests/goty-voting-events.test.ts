import assert from "node:assert/strict";
import test from "node:test";
import { AttachmentBuilder, type Client } from "discord.js";
import type { IGotyVoteAdminView } from "../services/GotyVoteApi.js";
import { parseGotyEventPayload } from "../classes/GotyEventPayload.js";
import type {
  GotyVotingEventKind,
  IGotyVotingEvent,
  IVotingEvent,
} from "../classes/VotingEvents.js";
import {
  ADMIN_CHANNEL_ID,
  ANNOUNCEMENT_CHANNEL_ID,
  BOT_DEV_CHANNEL_ID,
} from "../config/channels.js";
import type { FeatureState, IFeatureFlagSource } from "../functions/FeatureGate.js";
import {
  buildGotyDecidedAwardText,
  buildGotyNominationReminderText,
  handleGotyVotingEvent,
  type IGotyEventDeps,
} from "../services/GotyVotingEventHandlers.js";
import { handleVotingEvent } from "../services/VotingEventHandlers.js";
import {
  createVotingEventDeliveryState,
  processVotingEvents,
} from "../services/VotingEventService.js";

// GOTY Vote outbox posts (bot#1582): every goty_* kind posts once from its payload, routed
// by the goty_vote Feature, and is acked.

interface ISent {
  channelId: string;
  text: string;
  files: number;
}

/** A fake client; a post whose text matches `failOn` throws instead of sending. */
function fakeClient(failOn?: RegExp): { client: Client; sent: ISent[] } {
  const sent: ISent[] = [];
  const client = {
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        send: async (payload: {
          components?: Array<{ toJSON?: () => unknown }>;
          files?: unknown[];
        }) => {
          const json = (payload.components ?? []).map((component) =>
            typeof component.toJSON === "function" ? component.toJSON() : component,
          );
          if (failOn?.test(JSON.stringify(json))) throw new Error("Missing Access");
          sent.push({ channelId, text: JSON.stringify(json), files: payload.files?.length ?? 0 });
          return {};
        },
      }),
    },
  } as unknown as Client;
  return { client, sent };
}

function flags(state: FeatureState): IFeatureFlagSource {
  return { flags: async () => [{ key: "goty_vote", name: "GOTY Vote", state }] };
}

function game(
  id: number,
  title: string,
  votes: number | null = null,
  runoff: number | null = null,
) {
  return {
    gamedb_game_id: id,
    title,
    cover_url: `https://cdn.test/${id}.png`,
    votes,
    runoff_votes: runoff,
  };
}

/** A payload as Goty::EventPayload sends it (api#475). */
function payload(kind: GotyVotingEventKind, overrides: Record<string, unknown> = {}) {
  return {
    kind,
    year: 2026,
    name: "GOTY Vote 2026",
    nominations_open_at: "2027-01-01T05:00:00Z",
    voting_opens_at: "2027-01-15T17:00:00Z",
    voting_closes_at: "2027-01-18T04:59:59Z",
    runoff_opens_at: null,
    runoff_closes_at: null,
    decided_at: null,
    nomination_cap: 3,
    days_before: null,
    awards: [
      {
        award: "gotm",
        name: "GOTM of the Year",
        cap: 1,
        uncontested: false,
        runoff_ballot: [],
        pending_tie: [],
        games: [game(1, "Chrono Trigger"), game(2, "Final Fantasy VI")],
        winner: null,
      },
      {
        award: "nr_gotm",
        name: "NR-GOTM of the Year",
        cap: 1,
        uncontested: true,
        runoff_ballot: [],
        pending_tie: [],
        games: [game(3, "Hades")],
        winner: null,
      },
      {
        award: "game_of_the_year",
        name: "Game of the Year",
        cap: 1,
        uncontested: false,
        runoff_ballot: [],
        pending_tie: [],
        games: [],
        winner: null,
      },
    ],
    ...overrides,
  };
}

function gotyEvent(
  kind: GotyVotingEventKind,
  body: Record<string, unknown> = payload(kind),
): IGotyVotingEvent {
  return {
    id: 40,
    roundNumber: null,
    gotyYear: 2026,
    kind,
    rawKind: kind,
    payload: body,
    availableAt: new Date("2027-01-01T05:00:00Z"),
    expiresAt: null,
    attempts: 1,
  };
}

function deps(state: FeatureState = "live", extra: IGotyEventDeps = {}): IGotyEventDeps {
  return {
    flags: flags(state),
    ballotImage: async (p, award) => ({
      file: new AttachmentBuilder(Buffer.from("png"), { name: `${p.year}_${award.award}.png` }),
      url: `attachment://${p.year}_${award.award}.png`,
    }),
    ...extra,
  };
}

const DECIDED_AWARDS = [
  {
    award: "gotm",
    name: "GOTM of the Year",
    cap: 1,
    uncontested: false,
    runoff_ballot: [1, 2],
    pending_tie: [],
    games: [
      game(1, "Chrono Trigger", 4, 3),
      game(2, "Final Fantasy VI", 4, 1),
      game(5, "Xenogears", 1, 0),
    ],
    winner: { ...game(1, "Chrono Trigger"), decided_by: "runoff" },
  },
  {
    award: "nr_gotm",
    name: "NR-GOTM of the Year",
    cap: 1,
    uncontested: true,
    runoff_ballot: [],
    pending_tie: [],
    games: [game(3, "Hades", 0, 0)],
    winner: { ...game(3, "Hades"), decided_by: "uncontested" },
  },
  {
    award: "game_of_the_year",
    name: "Game of the Year",
    cap: 1,
    uncontested: false,
    runoff_ballot: [],
    pending_tie: [],
    games: [],
    winner: null,
  },
];

test("goty_nominations_opened posts once to announcements, led by the GOTY Vote name", async () => {
  const { client, sent } = fakeClient();
  const outcome = await handleGotyVotingEvent(
    client,
    gotyEvent("goty_nominations_opened"),
    deps(),
  );

  assert.equal(outcome, "delivered");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, ANNOUNCEMENT_CHANNEL_ID);
  assert.match(sent[0].text, /## GOTY Vote 2026: nominations are open/);
  assert.match(sent[0].text, /Nominate up to 3 games first released in 2026/);
  assert.match(sent[0].text, /goty nominate/);
  assert.match(sent[0].text, /Chrono Trigger/);
  assert.match(sent[0].text, /<t:1800032400:R>/);
  assert.doesNotMatch(sent[0].text, /Preview/);
});

for (const [kind, lead] of [
  ["goty_nomination_reminder_5d", "voting opens in 5 days"],
  ["goty_nomination_reminder_1d", "voting opens tomorrow"],
] as const) {
  test(`${kind} posts a reminder`, async () => {
    const { client, sent } = fakeClient();
    const days = kind.endsWith("5d") ? 5 : 1;
    const event = gotyEvent(kind, payload(kind, { days_before: days }));
    assert.equal(await handleGotyVotingEvent(client, event, deps()), "delivered");

    assert.equal(sent.length, 1);
    assert.match(sent[0].text, new RegExp(`## GOTY Vote 2026: ${lead}`));
    assert.match(sent[0].text, /0 games nominated so far/);
  });
}

test("a reminder without days_before falls back on its kind", () => {
  const parsed = parseGotyEventPayload(payload("goty_nomination_reminder_1d"), 2026)!;
  assert.match(
    buildGotyNominationReminderText(parsed, "goty_nomination_reminder_1d"),
    /voting opens tomorrow/,
  );
});

test("goty_voting_opened posts a ballot per Award, an image where votes are cast", async () => {
  const { client, sent } = fakeClient();
  const outcome = await handleGotyVotingEvent(client, gotyEvent("goty_voting_opened"), deps());

  assert.equal(outcome, "delivered");
  assert.equal(sent.length, 3);
  assert.ok(sent.every((post) => post.text.includes("GOTY Vote 2026: ")));
  assert.match(sent[0].text, /GOTM of the Year/);
  assert.match(sent[0].text, /Vote for up to 1 game of these 2/);
  assert.match(sent[0].text, /attachment:\/\/2026_gotm\.png/);
  assert.equal(sent[0].files, 1);
  assert.match(sent[1].text, /Hades.*is the only candidate/);
  assert.equal(sent[1].files, 0);
  assert.match(sent[2].text, /not given for 2026/);
});

test("goty_voting_opened still posts a ballot whose image failed", async () => {
  const { client, sent } = fakeClient();
  const failingImage = deps("live", {
    ballotImage: async () => {
      throw new Error("no covers");
    },
  });
  await handleGotyVotingEvent(client, gotyEvent("goty_voting_opened"), failingImage);

  assert.equal(sent.length, 3);
  assert.equal(sent[0].files, 0);
});

test("goty_voting_opened alerts the admin channel to a ballot that did not post", async () => {
  const { client, sent } = fakeClient(/2026: NR-GOTM of the Year/);
  const outcome = await handleGotyVotingEvent(client, gotyEvent("goty_voting_opened"), deps());

  assert.equal(outcome, "delivered");
  const ballots = sent.filter((post) => post.channelId === ANNOUNCEMENT_CHANNEL_ID);
  assert.equal(ballots.length, 2);
  const alerts = sent.filter((post) => post.channelId === ADMIN_CHANNEL_ID);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /GOTY Vote 2026: ballot posts missing/);
  assert.match(alerts[0].text, /NR-GOTM.*Missing Access/);
});

test("goty_runoff_opened lists the tied games and the Awards already decided", async () => {
  const { client, sent } = fakeClient();
  const body = payload("goty_runoff_opened", {
    runoff_closes_at: "2027-01-19T04:59:59Z",
    awards: DECIDED_AWARDS.map((award) =>
      award.award === "gotm"
        ? {
          ...award,
          winner: null,
          games: award.games.map((g) => ({ ...g, runoff_votes: null })),
        }
        : award),
  });
  await handleGotyVotingEvent(client, gotyEvent("goty_runoff_opened", body), deps());

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /## GOTY Vote 2026: runoff is open/);
  assert.match(sent[0].text, /Chrono Trigger\*\*: 4 votes/);
  assert.match(sent[0].text, /Final Fantasy VI\*\*: 4 votes/);
  assert.doesNotMatch(sent[0].text, /Xenogears/);
  assert.match(sent[0].text, /Winner: \*\*Hades\*\*/);
  assert.match(sent[0].text, /goty vote/);
});

test("goty_runoff_closed posts the runoff tally and winner, or the staff tie", async () => {
  const decided = fakeClient();
  const body = payload("goty_runoff_closed", { awards: DECIDED_AWARDS });
  await handleGotyVotingEvent(decided.client, gotyEvent("goty_runoff_closed", body), deps());
  assert.match(decided.sent[0].text, /## GOTY Vote 2026: runoff results/);
  assert.match(decided.sent[0].text, /Chrono Trigger\*\*: 3 votes/);
  assert.match(decided.sent[0].text, /Winner: \*\*Chrono Trigger\*\* \(won the runoff\)/);

  const tied = fakeClient();
  const tiedBody = payload("goty_runoff_closed", {
    awards: DECIDED_AWARDS.map((award) =>
      award.award === "gotm" ? { ...award, winner: null, pending_tie: [1, 2] } : award),
  });
  await handleGotyVotingEvent(tied.client, gotyEvent("goty_runoff_closed", tiedBody), deps());
  assert.match(tied.sent[0].text, /tied again, so an admin picks the winner/);
});

test("goty_decided posts every Award's winner and tally in one message", async () => {
  const { client, sent } = fakeClient();
  const body = payload("goty_decided", {
    decided_at: "2027-01-19T05:00:00Z",
    awards: DECIDED_AWARDS,
  });
  await handleGotyVotingEvent(client, gotyEvent("goty_decided", body), deps());

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /## GOTY Vote 2026: the winners/);
  assert.match(sent[0].text, /GOTM of the Year 2026/);
  assert.match(sent[0].text, /Chrono Trigger\*\*: 4 votes, 3 runoff votes/);
  // Xenogears was not in the runoff: its 0 runoff votes are not shown.
  assert.match(sent[0].text, /Xenogears\*\*: 1 vote"/);
  assert.doesNotMatch(sent[0].text, /Xenogears\*\*: 1 vote, /);
  assert.match(sent[0].text, /Hades\*\* \(the only candidate/);
  assert.match(sent[0].text, /Game of the Year is not given for 2026/);
  assert.match(sent[0].text, /cdn\.test\/1\.png/);
});

test("buildGotyDecidedAwardText orders the tally by votes, then runoff votes", () => {
  const parsed = parseGotyEventPayload(payload("goty_decided", { awards: DECIDED_AWARDS }), 2026)!;
  const text = buildGotyDecidedAwardText(parsed, parsed.awards[0]);
  assert.ok(text.indexOf("Chrono Trigger**:") < text.indexOf("Final Fantasy VI**:"));
  assert.ok(text.indexOf("Final Fantasy VI**:") < text.indexOf("Xenogears**:"));
});

test("goty_tie_pending posts the live tie prompt to the admin channel", async () => {
  const { client, sent } = fakeClient();
  const vote: IGotyVoteAdminView = {
    year: 2026,
    name: "GOTY Vote 2026",
    phase: "tie",
    nominationsOpenAt: new Date("2027-01-01T05:00:00Z"),
    votingOpensAt: new Date("2027-01-15T17:00:00Z"),
    votingClosesAt: new Date("2027-01-18T04:59:59Z"),
    decidedAt: null,
    ties: [
      {
        award: "gotm",
        name: "GOTM of the Year",
        games: [{ id: 1, title: "Chrono Trigger" }, { id: 2, title: "Final Fantasy VI" }],
      },
    ],
    winners: [],
  };
  const outcome = await handleGotyVotingEvent(
    client,
    gotyEvent("goty_tie_pending", payload("goty_tie_pending")),
    deps("off", { adminApi: { getVote: async () => vote } }),
  );

  assert.equal(outcome, "delivered");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, ADMIN_CHANNEL_ID);
  assert.match(sent[0].text, /GOTY Vote 2026: tie-break/);
  assert.match(sent[0].text, /admin-goty-tie-v1:2026:gotm/);
});

test("goty_tie_pending is skipped once the tie was settled", async () => {
  const { client, sent } = fakeClient();
  const outcome = await handleGotyVotingEvent(
    client,
    gotyEvent("goty_tie_pending"),
    deps("live", { adminApi: { getVote: async () => null } }),
  );
  assert.equal(outcome, "skipped");
  assert.equal(sent.length, 0);
});

test("GOTY posts go to bot-dev with a notice in Preview, and nowhere when Off", async () => {
  const preview = fakeClient();
  await handleGotyVotingEvent(preview.client, gotyEvent("goty_decided"), deps("preview"));
  assert.equal(preview.sent[0].channelId, BOT_DEV_CHANNEL_ID);
  assert.match(preview.sent[0].text, /GOTY Vote Feature is in Preview/);

  const off = fakeClient();
  const outcome = await handleGotyVotingEvent(off.client, gotyEvent("goty_decided"), deps("off"));
  assert.equal(outcome, "skipped");
  assert.equal(off.sent.length, 0);
});

test("a GOTY payload the bot cannot read throws to be retried", async () => {
  const { client } = fakeClient();
  await assert.rejects(
    handleGotyVotingEvent(client, gotyEvent("goty_decided", {}), deps()),
    /no readable GOTY payload/,
  );
});

test("handleVotingEvent sends a GOTY event to its handler, not the round's", async () => {
  const { client, sent } = fakeClient();
  const outcome = await handleVotingEvent(
    client,
    gotyEvent("goty_nominations_opened"),
    undefined,
    flags("live"),
  );
  assert.equal(outcome, "delivered");
  assert.match(sent[0].text, /GOTY Vote 2026: nominations are open/);
});

test("each GOTY kind posts once and is acked through the claim loop", async () => {
  const kinds: GotyVotingEventKind[] = [
    "goty_nominations_opened",
    "goty_nomination_reminder_5d",
    "goty_nomination_reminder_1d",
    "goty_voting_opened",
    "goty_runoff_opened",
    "goty_runoff_closed",
    "goty_decided",
  ];
  const { client, sent } = fakeClient();
  const events = kinds.map((kind, index) => ({ ...gotyEvent(kind), id: index + 1 }));
  const acked: number[] = [];
  const state = createVotingEventDeliveryState();
  const handle = (c: Client, e: IVotingEvent) =>
    handleGotyVotingEvent(c, e as IGotyVotingEvent, deps());
  const ack = async (id: number): Promise<void> => {
    acked.push(id);
  };
  const allAcked = await processVotingEvents(client, events, handle, ack, state);

  assert.equal(allAcked, true);
  assert.deepEqual(acked, [1, 2, 3, 4, 5, 6, 7]);
  // Three ballots for voting_opened, one post for every other kind.
  assert.equal(sent.length, kinds.length + 2);

  // An event whose post went out but whose ack failed is only acked when it comes back.
  const redelivered = { ...gotyEvent("goty_decided"), id: 99 };
  state.delivered.add(99);
  await processVotingEvents(client, [redelivered], handle, ack, state);
  assert.equal(sent.length, kinds.length + 2);
  assert.deepEqual(acked.at(-1), 99);
});
