import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChallengeProposalId,
  parseChallengeProposalId,
} from "../functions/ChallengeCustomIds.js";
import type { IChallenge } from "../services/ChallengeApi.js";
import type {
  IChallengeProposalApi,
  IPoolProposal,
  ProposalDecision,
} from "../services/ChallengeProposalApi.js";
import {
  addAcceptedToList,
  buildProposalsView,
  buildProposePickView,
  decideProposal,
  proposeReply,
  resolveListNotice,
  type IChallengeProposalDeps,
} from "../services/ChallengeProposals.js";
import type { IGameListEntry } from "../services/GameListApi.js";
import {
  apiError,
  buttonsOf,
  coverUrl,
  poolChallenge,
  selectsOf,
  textOf,
} from "./challengeFixtures.js";

// Pool Proposals in /challenge (bot#1569, design 2B "One proposal at a time"): proposing,
// stepping through and deciding them, the add-to-list prompt and list notices, with fakes.

function proposal(id: number, gameId: number, title: string, extra: Partial<IPoolProposal> = {}):
  IPoolProposal {
  return {
    id,
    challenge_id: 7,
    game: { game_id: gameId, title, cover_url: coverUrl(gameId) },
    proposer: { user_id: `${300 + id}`, username: `member${id}`, global_name: null },
    note: null,
    status: "pending",
    created_at: "2026-11-22T11:02:00Z",
    ...extra,
  };
}

const LINKED_LIST = {
  id: 12,
  name: "Soulslike, but make it history",
  visible: true,
  can_add: true,
};

/** A decider's view of the Pool: the API counts pending proposals only for them. */
function decided(overrides: Partial<IChallenge> = {}): IChallenge {
  return poolChallenge({ pending_proposals: 2, ...overrides });
}

interface IFake extends Required<IChallengeProposalDeps> {
  calls: string[];
  pending: IPoolProposal[];
  challenge: IChallenge | null;
}

function fake(options: {
  challenge?: IChallenge | null;
  pending?: IPoolProposal[];
  refuse?: Error;
} = {}): IFake {
  const deps = {
    calls: [] as string[],
    pending: options.pending ?? [
      proposal(1, 90, "Final Fantasy Crystal Chronicles Remastered", { note: "Chalice!" }),
      proposal(2, 91, "Final Fantasy XIV"),
    ],
    challenge: options.challenge === undefined ? decided() : options.challenge,
  } as IFake;
  const take = (id: number, extra: Partial<IPoolProposal>): IPoolProposal => {
    const found = deps.pending.find((p) => p.id === id)!;
    deps.pending = deps.pending.filter((p) => p.id !== id);
    return { ...found, ...extra };
  };
  const api: IChallengeProposalApi = {
    listProposals: async (challengeId, actingUserId, status) => {
      deps.calls.push(`list ${challengeId} ${status} as ${actingUserId}`);
      return deps.pending;
    },
    propose: async (challengeId, gameId, note, actingUserId) => {
      deps.calls.push(`propose ${challengeId} ${gameId} ${JSON.stringify(note)} as ${actingUserId}`);
      if (options.refuse) throw options.refuse;
      return proposal(9, gameId, "Dissidia Final Fantasy NT");
    },
    accept: async (challengeId, proposalId, as: ProposalDecision, actingUserId) => {
      deps.calls.push(`accept ${challengeId} ${proposalId} ${as} as ${actingUserId}`);
      if (options.refuse) throw options.refuse;
      return take(proposalId, { status: "accepted", accepted_as: as });
    },
    decline: async (challengeId, proposalId, actingUserId) => {
      deps.calls.push(`decline ${challengeId} ${proposalId} as ${actingUserId}`);
      if (options.refuse) throw options.refuse;
      return take(proposalId, { status: "declined" });
    },
    resolveListNotice: async (challengeId, noticeId, resolution, actingUserId) => {
      deps.calls.push(`notice ${challengeId} ${noticeId} ${resolution} as ${actingUserId}`);
      if (options.refuse) throw options.refuse;
      return deps.challenge!;
    },
  };
  deps.api = api;
  deps.challenges = {
    getChallenge: async (id, actingUserId) => {
      deps.calls.push(`get ${id} as ${actingUserId}`);
      return deps.challenge;
    },
  };
  deps.lists = {
    addGame: async (listId, gameId, actingUserId) => {
      deps.calls.push(`add ${gameId} to list ${listId} as ${actingUserId}`);
      if (options.refuse) throw options.refuse;
      return { game: { game_id: gameId, title: "Rise of the Ronin" } } as IGameListEntry;
    },
  };
  return deps;
}

const refusal = (code: string, message: string) => apiError(409, { error: code, message }, {
  method: "post",
  url: "/api/v1/challenges/7/pool_proposals",
});

test("proposal custom IDs round-trip, and junk is refused", () => {
  for (const target of [
    { action: "view" as const, ids: [7, 2], reply: "new" as const },
    { action: "core" as const, ids: [7, 41, 1] },
    { action: "list-add" as const, ids: [7, 90, 3] },
    { action: "note-modal" as const, ids: [7, 90] },
    { action: "notice-keep" as const, ids: [7, 5] },
  ]) {
    const id = buildChallengeProposalId(target);
    assert.ok(id.length <= 100, id);
    assert.deepEqual(parseChallengeProposalId(id), target);
  }
  assert.equal(parseChallengeProposalId("challenge-proposal-v1:view:7:2"), null);
  assert.equal(parseChallengeProposalId("challenge-proposal-v1:core:7:41"), null);
  assert.equal(parseChallengeProposalId("challenge-proposal-v1:nope:7"), null);
  assert.equal(parseChallengeProposalId("challenge-show-v1:propose:7"), null);
});

test("propose: sends the game and note, and says who decides", async () => {
  const deps = fake();
  const result = await proposeReply(
    { challengeId: 7, gameId: 92, note: "  Fights!  ", actingUserId: "333" },
    deps,
  );

  assert.deepEqual(deps.calls, ["get 7 as 333", 'propose 7 92 "Fights!" as 333']);
  assert.equal(result.error, undefined);
  const text = textOf(result.view.components);
  assert.ok(text.includes(
    "Proposed **Dissidia Final Fantasy NT** for **Fall of Final Fantasy**.\n" +
      "It's with Kaiserkaze now. You'll get a DM if it's accepted.",
  ), text);
});

test("propose: a club-hosted Pool is with the club's staff; a blank note is none",
  async () => {
    const deps = fake({ challenge: poolChallenge({ hosted_by_club: true, host: null }) });
    const result = await proposeReply(
      { challengeId: 7, gameId: 92, note: "   ", actingUserId: "333" },
      deps,
    );
    assert.ok(deps.calls.includes("propose 7 92 null as 333"));
    assert.match(textOf(result.view.components), /It's with the club's staff now\./);
  });

test("propose: a refusal comes back as the API words it, with the request", async () => {
  const deps = fake({ refuse: refusal("already_proposed",
    "Dissidia Final Fantasy NT has already been proposed for this Pool.") });
  const result = await proposeReply(
    { challengeId: 7, gameId: 92, note: null, actingUserId: "333" },
    deps,
  );
  assert.match(textOf(result.view.components), /Your proposal was not sent\./);
  assert.match(result.error ?? "", /has already been proposed for this Pool\./);
  assert.match(result.error ?? "", /pool_proposals/);
});

test("propose: only a Pool takes proposals, and a missing Challenge says so", async () => {
  const slots = fake({ challenge: poolChallenge({ challenge_format: "slots", pool: null }) });
  const result = await proposeReply(
    { challengeId: 7, gameId: 92, note: null, actingUserId: "333" },
    slots,
  );
  assert.match(textOf(result.view.components), /Only a Pool Challenge takes Pool Proposals\./);
  assert.ok(!slots.calls.some((c) => c.startsWith("propose")));

  const gone = fake({ challenge: null });
  const missing = await proposeReply(
    { challengeId: 7, gameId: 92, note: null, actingUserId: "333" },
    gone,
  );
  assert.match(textOf(missing.view.components), /There is no Challenge 7/);
});

test("propose a game: the search's matches become a select opening the note", () => {
  const view = buildProposePickView(7, "dissidia", [
    { id: 92, title: "Dissidia Final Fantasy NT", year: 2018 },
    { id: 93, title: "Dissidia 012", year: null },
  ]);
  const [select] = selectsOf(view.components);
  assert.equal(select?.customId, "challenge-proposal-v1:pick:7");
  assert.deepEqual(select?.options.map((o) => [o.label, o.value]), [
    ["Dissidia Final Fantasy NT (2018)", "92"],
    ["Dissidia 012", "93"],
  ]);
  const none = buildProposePickView(7, "zzz", []);
  assert.match(textOf(none.components), /No GameDB game matches "zzz"/);
});

test("proposals: one card at a time, oldest first, with what Core and Optional mean",
  async () => {
    const deps = fake();
    const view = await buildProposalsView({ challengeId: 7, position: 1, actingUserId: "111" },
      deps);
    const text = textOf(view.components);

    assert.ok(deps.calls.includes("list 7 pending as 111"));
    assert.match(text, /^-# Pool Proposal 1 of 2 · Fall of Final Fantasy$/m);
    assert.match(text, /^### Final Fantasy Crystal Chronicles Remastered$/m);
    const at = Math.floor(Date.parse("2026-11-22T11:02:00Z") / 1000);
    assert.ok(text.includes(`from <@301> · <t:${at}:R>`), text);
    assert.match(text, /^> Chalice!$/m);
    assert.doesNotMatch(text, /You left this game out/);
    assert.match(text, /Core: every Run must Clear it, and members with a Run get a DM\. /);
    assert.ok(JSON.stringify(view.components).includes(coverUrl(90)));
    assert.deepEqual(
      buttonsOf(view.components).map((b) => [b.label, b.customId ?? b.url, b.disabled]),
      [
        ["Accept as Core", "challenge-proposal-v1:core:7:1:1", false],
        ["Accept as Optional", "challenge-proposal-v1:optional:7:1:1", false],
        ["Decline", "challenge-proposal-v1:decline:7:1:1", false],
        ["Previous", "challenge-proposal-v1:view:7:1:u", true],
        ["Next", "challenge-proposal-v1:view:7:2:u", false],
        ["Game page", "https://the-rpg-club-www.vercel.app/games/90", false],
      ],
    );
    assert.deepEqual(view.allowedMentions, { parse: [] });
  });

test("proposals: a left-out game says accepting puts it back; a past position clamps",
  async () => {
    const deps = fake({
      challenge: decided({
        pool: { ...poolChallenge().pool!, excluded_games: [{ game_id: 91, title: "XIV" }] },
      }),
    });
    const view = await buildProposalsView({ challengeId: 7, position: 9, actingUserId: "111" },
      deps);
    const text = textOf(view.components);
    assert.match(text, /^-# Pool Proposal 2 of 2 · /m);
    assert.match(text, /^You left this game out\. Accepting puts it back in\.$/m);
    const next = buttonsOf(view.components).find((b) => b.label === "Next");
    assert.equal(next?.disabled, true);
  });

test("proposals: none waiting, and a member who doesn't decide sees their own",
  async () => {
    const empty = await buildProposalsView(
      { challengeId: 7, position: 1, actingUserId: "111" },
      fake({ pending: [] }),
    );
    assert.match(textOf(empty.components), /No Pool Proposals are waiting for \*\*Fall of/);

    const member = fake({ challenge: poolChallenge() });
    const own = await buildProposalsView({ challengeId: 7, position: 1, actingUserId: "301" },
      member);
    const text = textOf(own.components);
    assert.match(text, /^### Your Pool Proposals for \*\*Fall of Final Fantasy\*\*$/m);
    assert.match(text, /^- \*\*Final Fantasy XIV\*\*/m);
    assert.match(text, /They're with Kaiserkaze\./);
    assert.ok(!buttonsOf(own.components).some((b) => b.label.startsWith("Accept")));
  });

test("decide: Accept as Core moves on to the next proposal with what it did", async () => {
  const deps = fake();
  const result = await decideProposal(
    { challengeId: 7, proposalId: 1, decision: "core", position: 1, actingUserId: "111" },
    deps,
  );
  assert.ok(deps.calls.includes("accept 7 1 core as 111"));
  const text = textOf(result.view.components);
  assert.match(text, /^\*\*Final Fantasy Crystal Chronicles Remastered\*\* is now a Core Game\.$/m);
  assert.match(text, /^-# Pool Proposal 1 of 1 · /m);
  assert.match(text, /^### Final Fantasy XIV$/m);
});

test("decide: Decline says so; the last one leaves none waiting", async () => {
  const deps = fake({ pending: [proposal(2, 91, "Final Fantasy XIV")] });
  const result = await decideProposal(
    { challengeId: 7, proposalId: 2, decision: "decline", position: 1, actingUserId: "111" },
    deps,
  );
  assert.ok(deps.calls.includes("decline 7 2 as 111"));
  const text = textOf(result.view.components);
  assert.match(text, /^Declined \*\*Final Fantasy XIV\*\*\.$/m);
  assert.match(text, /No Pool Proposals are waiting/);
});

test("decide: with a linked list the decider may add to, accepting asks about the list",
  async () => {
    const deps = fake({
      challenge: decided({ pool: { ...poolChallenge().pool!, game_list: LINKED_LIST } }),
    });
    const result = await decideProposal(
      { challengeId: 7, proposalId: 2, decision: "optional", position: 2, actingUserId: "111" },
      deps,
    );
    const text = textOf(result.view.components);
    assert.ok(text.includes(
      "**Final Fantasy XIV** is now an Optional Game.\n" +
        "Add it to **Soulslike, but make it history** too?\n" +
        "-# Your list feeds this Challenge. Members who can see the list will see it there.",
    ), text);
    assert.deepEqual(buttonsOf(result.view.components).map((b) => [b.label, b.customId]), [
      ["Add to list", "challenge-proposal-v1:list-add:7:91:2"],
      ["No, keep the list as it is", "challenge-proposal-v1:list-skip:7:2"],
    ]);
  });

test("decide: a list the decider can't add to asks nothing", async () => {
  const deps = fake({
    challenge: decided({
      pool: { ...poolChallenge().pool!, game_list: { ...LINKED_LIST, can_add: false } },
    }),
  });
  const result = await decideProposal(
    { challengeId: 7, proposalId: 2, decision: "optional", position: 1, actingUserId: "111" },
    deps,
  );
  assert.doesNotMatch(textOf(result.view.components), /too\?/);
});

test("decide: a refusal keeps the card and carries the API's words", async () => {
  const deps = fake({ refuse: refusal("already_decided", "This proposal was already declined.") });
  const result = await decideProposal(
    { challengeId: 7, proposalId: 1, decision: "core", position: 1, actingUserId: "111" },
    deps,
  );
  assert.match(result.error ?? "", /This proposal was already declined\./);
  assert.match(textOf(result.view.components), /^-# Pool Proposal 1 of 2 · /m);
});

test("add to list: adds the accepted game to the linked list, then the next card",
  async () => {
    const deps = fake({
      challenge: decided({ pool: { ...poolChallenge().pool!, game_list: LINKED_LIST } }),
    });
    const result = await addAcceptedToList(
      { challengeId: 7, gameId: 95, position: 1, actingUserId: "111" },
      deps,
    );
    assert.ok(deps.calls.includes("add 95 to list 12 as 111"));
    assert.match(
      textOf(result.view.components),
      /^Added \*\*Rise of the Ronin\*\* to \*\*Soulslike, but make it history\*\*\.$/m,
    );
  });

test("add to list: a full list's refusal is shown as worded", async () => {
  const deps = fake({
    challenge: decided({ pool: { ...poolChallenge().pool!, game_list: LINKED_LIST } }),
    refuse: refusal("list_full", "This Game List holds 500 games, its most."),
  });
  const result = await addAcceptedToList(
    { challengeId: 7, gameId: 95, position: 1, actingUserId: "111" },
    deps,
  );
  assert.match(result.error ?? "", /holds 500 games/);
});

test("list notices: Remove and Keep name the game; a refusal is worded", async () => {
  const notices = [{
    id: 5,
    game: { game_id: 101, title: "Nioh", cover_url: null },
    created_at: "2026-11-20T10:00:00Z",
  }];
  const deps = fake({ challenge: decided({ list_notices: notices }) });
  assert.deepEqual(
    await resolveListNotice(
      { challengeId: 7, noticeId: 5, resolution: "remove", actingUserId: "111" },
      deps,
    ),
    { notice: "**Nioh** left the Pool." },
  );
  assert.ok(deps.calls.includes("notice 7 5 remove as 111"));
  assert.deepEqual(
    await resolveListNotice(
      { challengeId: 7, noticeId: 5, resolution: "keep", actingUserId: "111" },
      deps,
    ),
    { notice: "**Nioh** stays a Core Game." },
  );

  const refused = await resolveListNotice(
    { challengeId: 7, noticeId: 5, resolution: "keep", actingUserId: "222" },
    fake({ refuse: refusal("forbidden", "Only the Host or a Moderator can edit this.") }),
  );
  assert.ok("error" in refused);
  assert.match("error" in refused ? refused.error : "", /Only the Host or a Moderator/);
});
