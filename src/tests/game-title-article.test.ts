import assert from "node:assert/strict";
import test from "node:test";
import { moveArticleToFront, stripArticle } from "../functions/GameTitleAutocompleteUtils.js";

test("moveArticleToFront turns GameDB's trailing article back into a leading one", () => {
  assert.equal(moveArticleToFront("Sims, The"), "The Sims");
  assert.equal(moveArticleToFront("Witcher 3: Wild Hunt, The"), "The Witcher 3: Wild Hunt");
  assert.equal(moveArticleToFront("Hat in Time, A"), "A Hat in Time");
  assert.equal(moveArticleToFront("Chrono Trigger"), "Chrono Trigger");
  assert.equal(moveArticleToFront("Catherine"), "Catherine");
});

test("stripArticle makes the leading and trailing forms compare equal", () => {
  assert.equal(stripArticle("The Last of Us"), "Last of Us");
  assert.equal(stripArticle("Last of Us, The"), "Last of Us");
  assert.equal(stripArticle("Theme Hospital"), "Theme Hospital");
  assert.equal(stripArticle("The"), "The");
});
