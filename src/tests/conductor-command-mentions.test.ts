import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationCommandOptionType, ApplicationCommandType } from "discord.js";

import {
  PREVIEW_COMMANDS_ATTACHMENT_NAME,
  buildCommandCatalog,
  parseCommandCatalog,
  resolveCommandMention,
  type IApplicationCommandLike,
  type ICommandCatalog,
} from "../config/previewCommandCatalog.js";
import {
  catalogAttachmentUrl,
  resolveStepMentions,
} from "../conductor/ConductorCommandMentions.js";
import { buildCurrentStepMessage } from "../conductor/ConductorMessages.js";
import type { IConductorRun } from "../conductor/ConductorState.js";
import type { ITestStep } from "../conductor/TestPlanParser.js";

const JOURNAL_ID = "123456789012345678";
const COLLECTION_ID = "223456789012345678";
const ADMIN_ID = "323456789012345678";

const { Subcommand, SubcommandGroup, String: StringOption } = ApplicationCommandOptionType;

const REGISTERED: IApplicationCommandLike[] = [
  { id: JOURNAL_ID, name: "game-journal", type: ApplicationCommandType.ChatInput, options: [] },
  {
    id: COLLECTION_ID,
    name: "collection",
    type: ApplicationCommandType.ChatInput,
    options: [
      { type: Subcommand, name: "add", options: [{ type: StringOption, name: "title" }] },
      { type: Subcommand, name: "list" },
    ],
  },
  {
    id: ADMIN_ID,
    name: "admin",
    type: ApplicationCommandType.ChatInput,
    options: [
      { type: SubcommandGroup, name: "vote", options: [{ type: Subcommand, name: "start" }] },
    ],
  },
  { id: "423456789012345678", name: "Report", type: ApplicationCommandType.Message, options: [] },
];

function catalog(): ICommandCatalog {
  return buildCommandCatalog(REGISTERED);
}

function makeStep(number: number, command: string): ITestStep {
  return { number, label: "label", command, expected: "\"Saved\"", ephemeral: false };
}

test("the catalog keeps chat input commands and their subcommand paths", () => {
  assert.deepEqual(catalog(), {
    commands: [
      { name: "game-journal", id: JOURNAL_ID, subcommands: [] },
      { name: "collection", id: COLLECTION_ID, subcommands: ["add", "list"] },
      { name: "admin", id: ADMIN_ID, subcommands: ["vote start"] },
    ],
  });
});

test("a catalog survives the round trip through its attachment text", () => {
  assert.deepEqual(parseCommandCatalog(JSON.stringify(catalog())), catalog());
});

test("a catalog with markup in a name or a bad ID is rejected whole", () => {
  const withMarkup = { commands: [{ name: "x>@everyone", id: JOURNAL_ID, subcommands: [] }] };
  const badId = { commands: [{ name: "game-journal", id: "12:34", subcommands: [] }] };
  const badPath = { commands: [{ name: "a", id: JOURNAL_ID, subcommands: ["b:1>"] }] };
  assert.equal(parseCommandCatalog(JSON.stringify(withMarkup)), null);
  assert.equal(parseCommandCatalog(JSON.stringify(badId)), null);
  assert.equal(parseCommandCatalog(JSON.stringify(badPath)), null);
  assert.equal(parseCommandCatalog("not json"), null);
  assert.equal(parseCommandCatalog("null"), null);
});

test("a leaf command resolves to its own mention", () => {
  assert.equal(resolveCommandMention(catalog(), "/game-journal"), `</game-journal:${JOURNAL_ID}>`);
  assert.equal(
    resolveCommandMention(catalog(), "/game-journal title:Chrono Trigger"),
    `</game-journal:${JOURNAL_ID}>`,
  );
});

test("a subcommand or grouped subcommand resolves to that subcommand's mention", () => {
  assert.equal(
    resolveCommandMention(catalog(), "/collection add title:Chrono Trigger"),
    `</collection add:${COLLECTION_ID}>`,
  );
  assert.equal(
    resolveCommandMention(catalog(), "/admin vote start\nclick \"Go\", submit"),
    `</admin vote start:${ADMIN_ID}>`,
  );
});

test("unknown, non-slash, and bare parent commands resolve to nothing", () => {
  assert.equal(resolveCommandMention(catalog(), "/not-a-command"), null);
  assert.equal(resolveCommandMention(catalog(), "/Game-Journal"), null);
  assert.equal(resolveCommandMention(catalog(), "/collection remove"), null);
  assert.equal(resolveCommandMention(catalog(), "/collection"), null);
  assert.equal(resolveCommandMention(catalog(), "/admin vote"), null);
  assert.equal(resolveCommandMention(catalog(), "click \"Add\", submit"), null);
  assert.equal(resolveCommandMention(catalog(), "/Report"), null);
});

test("step mentions are keyed by step number and skip steps without one", () => {
  const steps = [makeStep(1, "/game-journal"), makeStep(2, "click \"Save\""),
    makeStep(3, "/collection list")];
  assert.deepEqual(resolveStepMentions(JSON.stringify(catalog()), steps), {
    1: `</game-journal:${JOURNAL_ID}>`,
    3: `</collection list:${COLLECTION_ID}>`,
  });
  assert.deepEqual(resolveStepMentions("{}", steps), {});
});

test("the catalog is found by its attachment name", () => {
  const url = "https://cdn.example/commands.json";
  assert.equal(catalogAttachmentUrl([{ name: PREVIEW_COMMANDS_ATTACHMENT_NAME, url }]), url);
  assert.equal(catalogAttachmentUrl([{ name: "other.json", url }]), null);
});

function stepText(run: IConductorRun): string {
  return JSON.stringify(buildCurrentStepMessage(run, "700").components);
}

test("the step message shows the mention above the code block only when resolved", () => {
  const run: IConductorRun = {
    runId: "42",
    pr: 7,
    headSha: "abc",
    steps: [makeStep(1, "/game-journal"), makeStep(2, "click \"Save\"")],
    current: 0,
    windowStart: 0,
    results: [],
    commandMentions: { 1: `</game-journal:${JOURNAL_ID}>` },
    status: "running",
  };
  assert.match(stepText(run),
    new RegExp(`Click to start: </game-journal:${JOURNAL_ID}>\\\\n\`\`\`\\\\n/game-journal`));
  run.current = 1;
  assert.doesNotMatch(stepText(run), /Click to start/);
});
