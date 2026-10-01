import assert from "node:assert/strict";
import test from "node:test";
import type { INominationEntry } from "../classes/Nomination.js";
import type { IVoteEntry } from "../classes/Vote.js";
import {
  buildVotePanelComponents,
  type IVotePanelParams,
} from "../functions/VotePanelComponents.js";
import { parsePickedNominationId } from "../commands/vote/vote-panel-actions.service.js";
import { DISCORD_V2_COMPONENTS_MAX } from "../config/textLimits.js";

interface IComponentNode {
  type?: number;
  custom_id?: string;
  content?: string;
  components?: IComponentNode[];
}

const BUTTON_TYPE = 2;
const SELECT_TYPE = 3;

function makeNominations(count: number): INominationEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    roundNumber: 143,
    userId: "100",
    gameTitle: `Game ${index + 1}`,
    gamedbGameId: index + 1,
    nominatedAt: new Date("2026-01-01T00:00:00.000Z"),
    reason: null,
  }));
}

const MY_VOTES: IVoteEntry[] = [
  {
    id: 1,
    roundNumber: 143,
    userId: "100",
    nominationId: 1,
    gamedbGameId: 1,
    gameTitle: "Game 1",
    votedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

function panelJson(overrides: Partial<IVotePanelParams>): IComponentNode[] {
  const params: IVotePanelParams = {
    kind: "gotm",
    roundNumber: 143,
    monthLabel: "November 2026",
    voteDeadline: new Date("2026-10-30T16:00:00.000Z"),
    cap: 2,
    nominations: makeNominations(4),
    ...overrides,
  };
  return buildVotePanelComponents(params).map((c) => c.toJSON() as IComponentNode);
}

function flatten(nodes: IComponentNode[]): IComponentNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.components ?? [])]);
}

function textOf(nodes: IComponentNode[]): string {
  return flatten(nodes)
    .map((node) => node.content ?? "")
    .join("\n");
}

test("a small ballot gets one stable vote button per game", () => {
  const json = panelJson({});
  const ids = flatten(json)
    .filter((node) => node.type === BUTTON_TYPE)
    .map((node) => node.custom_id);
  assert.deepEqual(ids, [
    "vote-pick:gotm:143:1",
    "vote-pick:gotm:143:2",
    "vote-pick:gotm:143:3",
    "vote-pick:gotm:143:4",
    "vote-mine:gotm:143",
    "vote-tally:gotm:143",
  ]);
  assert.equal(flatten(json).filter((node) => node.type === SELECT_TYPE).length, 0);
});

test("the panel names the month, the cap and the deadline in local time", () => {
  const text = textOf(panelJson({}));
  assert.match(text, /## 🗳️ GOTM Vote - Round 143/);
  assert.match(text, /Which game\(s\) should be the GOTM for \*\*November 2026\*\*\?/);
  assert.match(text, /Vote for up to \*\*2\*\* games/);
  assert.match(text, /Ends <t:1793376000:R> \(<t:1793376000:F>\)/);
});

test("game buttons wrap five to a row", () => {
  const rows = panelJson({ nominations: makeNominations(12) }).slice(1);
  assert.deepEqual(
    rows.map((row) => row.components?.length),
    [5, 5, 2, 2],
  );
});

test("the largest button ballot stays within Discord's component limit", () => {
  const json = panelJson({ nominations: makeNominations(25), myVotes: MY_VOTES });
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
  assert.equal(flatten(json).filter((node) => node.type === SELECT_TYPE).length, 0);
});

test("a ballot too large for buttons falls back to select menus", () => {
  const json = panelJson({ nominations: makeNominations(30), myVotes: MY_VOTES });
  const selects = flatten(json).filter((node) => node.type === SELECT_TYPE);
  assert.deepEqual(
    selects.map((node) => node.custom_id),
    ["vote-cast:gotm:143:0", "vote-cast:gotm:143:1"],
  );
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
  assert.match(textOf(json), /Pick a game you already voted for/);
});

test("parsePickedNominationId reads the button's last segment", () => {
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:17"), 17);
  assert.equal(parsePickedNominationId("vsbx-pick:1:ff:999:nr-gotm:3"), 3);
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:0"), null);
  assert.equal(parsePickedNominationId("vote-pick:gotm:143:x"), null);
});
