import assert from "node:assert/strict";
import test from "node:test";
import {
  findAccentedSpelling,
  foldAccents,
  normalizeTitleKey,
} from "../functions/GameTitleAutocompleteUtils.js";

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

test("findAccentedSpelling returns the accented spelling of a folded term", () => {
  assert.equal(findAccentedSpelling("Pokémon Mystery Dungeon", "pokemon"), "pokémon");
  assert.equal(findAccentedSpelling("Ōkami HD", "okami hd"), "ōkami hd");
  assert.equal(findAccentedSpelling("Café Rush", "cafe"), "café");
});

test("findAccentedSpelling handles titles stored in decomposed form", () => {
  const decomposed = "Pokémon".normalize("NFD");
  assert.equal(findAccentedSpelling(decomposed, "pokemon"), "pokémon".normalize("NFD"));
});

test("findAccentedSpelling returns null when the API search already matches", () => {
  assert.equal(findAccentedSpelling("Pokémon Mystery Dungeon", "mystery"), null);
  assert.equal(findAccentedSpelling("Pokémon Red", "zelda"), null);
  assert.equal(findAccentedSpelling("Pokémon Red", ""), null);
});
