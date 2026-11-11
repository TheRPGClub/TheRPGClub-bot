import assert from "node:assert/strict";
import test from "node:test";
import {
  pickNewsCategory,
  type INewsCategoryPost,
} from "../functions/NewsCategoryPicker.js";
import { NEWS_CATEGORY_FIXTURES } from "./newsCategoryFixtures.js";

test("a post with no link, only images, goes to General", () => {
  assert.equal(pickNewsCategory({ link: null, comment: null }), "general");
});

for (const fixture of NEWS_CATEGORY_FIXTURES) {
  test(`a real ${fixture.category} post is found by ${fixture.via}`, () => {
    const link = fixture.url === null ? null : {
      url: fixture.url,
      title: fixture.title ?? null,
      site_name: fixture.siteName ?? null,
      description: fixture.description ?? null,
    };

    assert.equal(pickNewsCategory({ link, comment: fixture.comment ?? null }), fixture.category);
  });
}

function linkPost(
  url: string,
  preview: { title?: string; description?: string } = {},
  comment: string | null = null,
): INewsCategoryPost {
  const link = {
    url,
    title: preview.title ?? null,
    site_name: null,
    description: preview.description ?? null,
  };
  return { link, comment };
}

test("a link no rule matches goes to General", () => {
  const post = linkPost("https://example.com/blog/42", { title: "Some thoughts" }, "neat");

  assert.equal(pickNewsCategory(post), "general");
});

test("a page description counts only for the strong phrases", () => {
  const description = "Our review of the new RPG";

  assert.equal(pickNewsCategory(linkPost("https://example.com/a", { title: "Hello", description })),
    "general");
  assert.equal(pickNewsCategory(linkPost("https://example.com/a", { title: description })),
    "releases");
});

test("a social post's text counts as its title", () => {
  const description = "An insider says more is coming";

  assert.equal(pickNewsCategory(linkPost("https://x.com/someone/status/1", { description })),
    "rumours");
  assert.equal(pickNewsCategory(linkPost("https://example.com/a", { title: "Hi", description })),
    "general");
});

test("an account rule matches through a mirror and in any letter case", () => {
  assert.equal(pickNewsCategory(linkPost("https://fxtwitter.com/Billbil_Kun/status/1")),
    "rumours");
});
