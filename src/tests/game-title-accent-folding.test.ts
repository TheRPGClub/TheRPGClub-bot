import assert from "node:assert/strict";
import test from "node:test";
import {
  foldAccents,
  foldedTitleMatchesTerms,
  normalizeTitleKey,
} from "../functions/GameTitleAutocompleteUtils.js";

function keysFor(title: string): { folded: string; norm: string } {
  const folded = foldAccents(title.toLowerCase()).toLowerCase();
  return { folded, norm: folded.replace(/[^a-z0-9]/g, "") };
}

test("foldAccents strips diacritics beyond the letter e", () => {
  assert.equal(foldAccents("Pokémon"), "Pokemon");
  assert.equal(foldAccents("ÉLÉMENT"), "ELEMENT");
  assert.equal(foldAccents("Ōkami"), "Okami");
  assert.equal(foldAccents("Señor Café"), "Senor Cafe");
  assert.equal(foldAccents("Plain Title 2"), "Plain Title 2");
});

test("normalizeTitleKey treats accented and plain titles as the same key", () => {
  assert.equal(normalizeTitleKey("Pokémon Red"), normalizeTitleKey("Pokemon Red"));
});

test("foldedTitleMatchesTerms finds accented titles from unaccented terms", () => {
  const title = keysFor("Pokémon Mystery Dungeon");
  assert.equal(foldedTitleMatchesTerms(title, ["pokemon"]), true);
  assert.equal(foldedTitleMatchesTerms(title, ["mystery dungeon"]), true);
  assert.equal(foldedTitleMatchesTerms(title, ["pokemonmystery"]), true);
  assert.equal(foldedTitleMatchesTerms(title, ["zelda"]), false);
});

test("foldedTitleMatchesTerms ignores terms with no letters or digits", () => {
  assert.equal(foldedTitleMatchesTerms(keysFor("Pokémon"), ["!!"]), false);
});
