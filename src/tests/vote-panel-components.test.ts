import assert from "node:assert/strict";
import test from "node:test";
import { AttachmentBuilder, ComponentType, type Client } from "discord.js";
import Member from "../classes/Member.js";
import type { INominationEntry } from "../classes/Nomination.js";
import type { IVoteEntry } from "../classes/Vote.js";
import {
  buildVotePanelComponents,
  planVotePanelArt,
  type IVotePanelArt,
  type IVotePanelParams,
} from "../functions/VotePanelComponents.js";
import { postVotePanels } from "../functions/VotePanelPosting.js";
import type { IVotingDataSource } from "../services/VotingDataSource.js";
import { parsePickedNominationId } from "../commands/vote/vote-panel-actions.service.js";
import { DISCORD_V2_COMPONENTS_MAX } from "../config/textLimits.js";

interface IComponentNode {
  type?: number;
  custom_id?: string;
  content?: string;
  components?: IComponentNode[];
  accessory?: IComponentNode;
  label?: string;
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
  return nodes.flatMap((node) => [
    node,
    ...flatten(node.components ?? []),
    ...(node.accessory ? flatten([node.accessory]) : []),
  ]);
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
  assert.match(text, /## GOTM Vote - Round 143\nWhich game/);
  assert.match(text, /Which game\(s\) should be the GOTM for \*\*November 2026\*\*\?/);
  assert.match(text, /Vote for up to \*\*2\*\* games/);
  assert.match(text, /Ends <t:1793376000:R> \(<t:1793376000:F>\)/);
});

test("game buttons wrap five to a row", () => {
  const rows = panelJson({ nominations: makeNominations(12) }).slice(2);
  assert.deepEqual(
    rows.map((row) => row.components?.length),
    [5, 5, 2, 2],
  );
});

test("the largest button ballot stays within Discord's component limit", () => {
  const json = panelJson({ nominations: makeNominations(24), myVotes: MY_VOTES });
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

const SECTION_TYPE = ComponentType.Section;
const TEXT_DISPLAY_TYPE = ComponentType.TextDisplay;
const GALLERY_TYPE = ComponentType.MediaGallery;
const VOTE_IMAGE_URL = "https://example.com/noms_vote_gotm_round_143.png";

function artFor(voteImageUrl: string | null = VOTE_IMAGE_URL): IVotePanelArt {
  return { voteImageUrl, nominatorNames: new Map([["100", "Weasel"]]) };
}

/** The panel container's children; the header container comes first. */
function containerChildren(json: IComponentNode[]): IComponentNode[] {
  return json[1]?.components ?? [];
}

test("the vote image tops the panel and each game is a nomination section", () => {
  const json = panelJson({ art: artFor() });
  const children = containerChildren(json);
  assert.deepEqual(
    children.map((node) => node.type),
    [
      GALLERY_TYPE,
      ComponentType.Separator,
      SECTION_TYPE,
      SECTION_TYPE,
      SECTION_TYPE,
      SECTION_TYPE,
      ComponentType.Separator,
      TEXT_DISPLAY_TYPE,
    ],
  );
  const nominator = children[2]?.accessory;
  assert.equal(nominator?.custom_id, "user-header-label:100:1");
  const ids = flatten(json).map((node) => node.custom_id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, "custom ids are unique within the message");
  assert.equal(nominator?.label, "Weasel");
  assert.equal(children[2]?.components?.[0]?.content, "**Game 1**\n-# *No reason provided.*");
  assert.match(json[0]?.components?.[0]?.content ?? "", /^## GOTM Vote - Round 143\n/);
  assert.match(children.at(-1)?.content ?? "", /^🙈 Votes are anonymous/);
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
});

test("seven games fit as sections under the image, with every button", () => {
  const json = panelJson({ nominations: makeNominations(7), art: artFor() });
  // Header 2, container 3, image 2, seven sections of 3, buttons in two rows, footer row 3.
  assert.equal(flatten(json).length, 2 + 3 + 2 + 21 + 9 + 3);
  assert.equal(flatten(json).filter((node) => node.type === BUTTON_TYPE).length, 7 + 7 + 2);
});

test("a ballot too large for sections keeps the image and lists the titles", () => {
  const json = panelJson({ nominations: makeNominations(12), art: artFor() });
  const children = containerChildren(json);
  assert.equal(children[0]?.type, GALLERY_TYPE);
  assert.equal(children.filter((node) => node.type === SECTION_TYPE).length, 0);
  assert.equal(flatten(json).filter((node) => node.type === BUTTON_TYPE).length, 14);
  const titles = children[2]?.content ?? "";
  assert.match(titles, /^- \*\*Game 1\*\*\n[^]*- \*\*Game 12\*\*$/);
  assert.ok(flatten(json).length <= DISCORD_V2_COMPONENTS_MAX);
});

test("without art the games are listed as titles above the rules", () => {
  const children = containerChildren(panelJson({}));
  assert.equal(children.length, 3);
  assert.match(children[0]?.content ?? "", /^- \*\*Game 1\*\*\n[^]*- \*\*Game 4\*\*$/);
});

test("a test notice is a small footer line under the rules, not in the header", () => {
  const json = panelJson({ testNotice: "-# 🧪 Test mode: casting is refused right now." });
  assert.doesNotMatch(json[0]?.components?.[0]?.content ?? "", /Test mode/);
  assert.match(
    containerChildren(json).at(-1)?.content ?? "",
    /🔒 Members role required\n-# 🧪 Test mode: casting is refused right now\.$/,
  );
});

test("with no vote image the sections still show", () => {
  const children = containerChildren(panelJson({ art: artFor(null) }));
  assert.equal(children[0]?.type, SECTION_TYPE);
  assert.equal(children.filter((node) => node.type === SECTION_TYPE).length, 4);
});

test("long reasons are shortened so the panel stays inside the text limit", () => {
  const nominations = makeNominations(7).map((nomination) => ({
    ...nomination,
    gameTitle: `${"Long Title ".repeat(8)}${nomination.id}`,
    reason: "x".repeat(1500),
  }));
  const json = panelJson({ nominations, art: artFor() });
  const sectionText = containerChildren(json)[2]?.components?.[0]?.content ?? "";
  assert.match(sectionText, /^\*\*Long Title [^]*\n> x+\.\.\.$/);
  assert.ok(sectionText.length < 400);
  assert.ok(textOf(json).length <= 4000);
});

test("a long title list is capped so the panel stays inside Discord's text limit", () => {
  const nominations = makeNominations(40).map((nomination) => ({
    ...nomination,
    gameTitle: `${"Long Title ".repeat(9)}${nomination.id}`,
  }));
  const text = textOf(panelJson({ nominations, myVotes: MY_VOTES }));
  assert.ok(text.length <= 4000);
  assert.match(text, /\*\*\n-# \.\.\.and \d+ more\n/);
});

test("the art plan fetches only what the panel has room for", () => {
  const plan = (count: number) => planVotePanelArt({
    kind: "gotm",
    roundNumber: 143,
    voteDeadline: null,
    cap: 2,
    nominations: makeNominations(count),
  });
  assert.deepEqual(plan(4), { voteImage: true, nominationSections: true });
  assert.deepEqual(plan(7), { voteImage: true, nominationSections: true });
  assert.deepEqual(plan(8), { voteImage: true, nominationSections: false });
  assert.deepEqual(plan(30), { voteImage: true, nominationSections: false });
  assert.deepEqual(plan(0), { voteImage: false, nominationSections: false });
});

test("postVotePanels sends the vote image and nominator names with the panel", async (t) => {
  t.mock.method(Member, "getByUserId", async () => ({ globalName: "Weasel" }));
  const sent: Array<{ components: Array<{ toJSON(): unknown }>; files: unknown[] }> = [];
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload: (typeof sent)[number]) => {
          sent.push(payload);
        },
      }),
    },
  } as unknown as Client;
  const imageFile = new AttachmentBuilder(Buffer.from([1]), { name: "vote.png" });
  const imageRequests: Array<{ ballot: string; games: number }> = [];
  const source = {
    getTally: async () => ({ rows: [], cap: 2 }),
    buildVoteImage: async (
      _kind: string,
      _round: number,
      ballot: string,
      nominations: unknown[],
    ) => {
      imageRequests.push({ ballot, games: nominations.length });
      return { files: [imageFile], voteImageUrl: "attachment://vote.png" };
    },
  } as unknown as IVotingDataSource;
  const result = await postVotePanels({
    client,
    channelId: "1",
    roundNumber: 143,
    voteDeadline: null,
    nominationsByKind: new Map([["gotm", makeNominations(4)]]),
    source,
    ballot: "runoff",
  });
  assert.equal(result.posted, 1);
  assert.deepEqual(imageRequests, [{ ballot: "runoff", games: 4 }]);
  assert.deepEqual(sent[0]?.files, [imageFile]);
  const json = sent[0]?.components.map((c) => c.toJSON() as IComponentNode) ?? [];
  const children = containerChildren(json);
  assert.equal(children[0]?.type, GALLERY_TYPE);
  assert.equal(children[2]?.accessory?.label, "Weasel");
});
