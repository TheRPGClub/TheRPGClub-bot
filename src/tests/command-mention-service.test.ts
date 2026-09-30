import test from "node:test";
import assert from "node:assert/strict";

import { findCatalogMention, type ICommandCatalog } from "../config/previewCommandCatalog.js";
import {
  commandMention,
  findCommandMention,
  linkCommandMentions,
  setCommandMentionCatalog,
} from "../services/CommandMentionService.js";

const NOMS_ID = "123456789012345678";
const COLLECTION_ID = "223456789012345678";
const ADMIN_ID = "323456789012345678";

const CATALOG: ICommandCatalog = {
  commands: [
    { name: "noms", id: NOMS_ID, subcommands: [] },
    { name: "collection", id: COLLECTION_ID, subcommands: ["add", "import-csv"] },
    { name: "admin", id: ADMIN_ID, subcommands: ["votes reset", "sync"] },
  ],
};

function withCatalog(run: () => void): void {
  setCommandMentionCatalog(CATALOG);
  try {
    run();
  } finally {
    setCommandMentionCatalog({ commands: [] });
  }
}

test("commandMention links a known leaf, subcommand, and group path", () => {
  withCatalog(() => {
    assert.equal(commandMention("noms"), `</noms:${NOMS_ID}>`);
    assert.equal(commandMention("/collection add"), `</collection add:${COLLECTION_ID}>`);
    assert.equal(commandMention("admin votes reset"), `</admin votes reset:${ADMIN_ID}>`);
  });
});

test("commandMention falls back to plain text when the path cannot open", () => {
  withCatalog(() => {
    assert.equal(commandMention("collection"), "/collection");
    assert.equal(commandMention("collection remove"), "/collection remove");
    assert.equal(commandMention("unknown"), "/unknown");
    assert.equal(findCommandMention("noms extra"), null);
  });
  assert.equal(commandMention("noms"), "/noms");
});

test("linkCommandMentions links references and keeps options after them", () => {
  withCatalog(() => {
    assert.equal(
      linkCommandMentions("Syntax: /collection add title:<game> | /noms"),
      `Syntax: </collection add:${COLLECTION_ID}> title:<game> | </noms:${NOMS_ID}>`,
    );
    assert.equal(
      linkCommandMentions("Use /collection help or /other."),
      "Use /collection help or /other.",
    );
  });
});

test("linkCommandMentions leaves URLs, paths, and code syntax alone", () => {
  withCatalog(() => {
    const text = "See https://x.test/noms, GOTM/noms, and `/collection import-csv action:start`.";
    assert.equal(linkCommandMentions(text), text);
    assert.equal(
      linkCommandMentions("Add it with `/collection add` first."),
      `Add it with </collection add:${COLLECTION_ID}> first.`,
    );
    const linked = linkCommandMentions("/noms");
    assert.equal(linkCommandMentions(linked), linked);
  });
});

test("linkCommandMentions returns text unchanged before the catalog loads", () => {
  assert.equal(linkCommandMentions("Run /noms"), "Run /noms");
});

test("findCatalogMention takes the longest path and counts the words it used", () => {
  assert.deepEqual(findCatalogMention(CATALOG, ["admin", "votes", "reset", "type"]), {
    mention: `</admin votes reset:${ADMIN_ID}>`,
    wordCount: 3,
  });
  assert.deepEqual(findCatalogMention(CATALOG, ["collection", "add", "title"]), {
    mention: `</collection add:${COLLECTION_ID}>`,
    wordCount: 2,
  });
  assert.deepEqual(findCatalogMention(CATALOG, ["noms", "type"]), {
    mention: `</noms:${NOMS_ID}>`,
    wordCount: 1,
  });
  assert.equal(findCatalogMention(CATALOG, ["admin", "votes"]), null);
  assert.equal(findCatalogMention(CATALOG, ["missing"]), null);
});
