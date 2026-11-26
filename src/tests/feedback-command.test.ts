import assert from "node:assert/strict";
import test from "node:test";
import { buildFeedbackCreateBody } from "../classes/Feedback.js";
import {
  buildFeedbackDraft,
  buildFeedbackFiledText,
  buildFeedbackKindPrompt,
  buildFeedbackModalId,
  buildLegacySuggestionReviewText,
  FEEDBACK_KIND_SELECT_ID,
  LEGACY_SUGGESTION_REVIEW_BUTTON_ID,
  parseFeedbackModalId,
  readModalChoice,
} from "../commands/feedback.command.js";
import { WEBSITE_BASE_URL } from "../config/website.js";

function reader(values: Record<string, string>): (customId: string) => string {
  return (customId) => values[customId] ?? "";
}

test("the kind picker offers the three kinds on a stable custom id", () => {
  const json = buildFeedbackKindPrompt().components[0]!.toJSON() as any;
  const select = json.components.find((c: any) => c.components)?.components[0];
  assert.equal(select.custom_id, FEEDBACK_KIND_SELECT_ID);
  assert.deepEqual(
    select.options.map((option: any) => option.value),
    ["feature_request", "suggestion", "bug_report"],
  );
});

test("modal ids round-trip their kind and refuse unknown kinds", () => {
  assert.equal(parseFeedbackModalId(buildFeedbackModalId("bug_report")), "bug_report");
  assert.equal(parseFeedbackModalId("feedback-create:labels"), null);
  assert.equal(parseFeedbackModalId("suggestion-create-modal"), null);
});

test("a Feature Request needs a title and details", () => {
  assert.equal(
    buildFeedbackDraft("feature_request", reader({ "feedback-details": "x" }), null),
    "Title cannot be empty.",
  );
  assert.equal(
    buildFeedbackDraft("feature_request", reader({ "feedback-title": "Dark mode" }), null),
    "Details cannot be empty.",
  );
  assert.deepEqual(
    buildFeedbackDraft(
      "suggestion",
      reader({ "feedback-title": "Dark\n mode", "feedback-details": "Please" }),
      null,
    ),
    { kind: "suggestion", title: "Dark mode", details: "Please" },
  );
});

test("a Bug Report needs where, what happened and what was expected; steps are optional", () => {
  const filled = {
    "feedback-title": "Crash",
    "feedback-what-happened": "It crashed",
    "feedback-expected": "No crash",
  };
  assert.match(
    String(buildFeedbackDraft("bug_report", reader(filled), null)),
    /where it happened/,
  );
  assert.equal(
    buildFeedbackDraft("bug_report", reader({ ...filled, "feedback-expected": "" }), "bot"),
    "What you expected cannot be empty.",
  );
  assert.deepEqual(buildFeedbackDraft("bug_report", reader(filled), "website"), {
    kind: "bug_report",
    title: "Crash",
    bug: { where: "website", whatHappened: "It crashed", expected: "No crash", steps: null },
  });
});

test("the create body sends kind and a Bug Report's fields, never labels", () => {
  assert.deepEqual(
    buildFeedbackCreateBody(
      { kind: "feature_request", title: "T", details: "D" },
      "u1",
      "Ayla",
    ),
    {
      data: {
        kind: "feature_request",
        title: "T",
        details: "D",
        created_by: "u1",
        created_by_name: "Ayla",
      },
    },
  );
  assert.deepEqual(
    buildFeedbackCreateBody(
      {
        kind: "bug_report",
        title: "T",
        bug: { where: "bot", whatHappened: "W", expected: "E", steps: "S" },
      },
      "u1",
      "Ayla",
    ).data,
    {
      kind: "bug_report",
      title: "T",
      created_by: "u1",
      created_by_name: "Ayla",
      where: "bot",
      what_happened: "W",
      expected: "E",
      steps: "S",
    },
  );
});

test("the filed reply links to the board; a Bug Report links to its edit dialog for a screenshot", () => {
  const url = `${WEBSITE_BASE_URL}/feedback?kind=bug_report&pinned=42`;
  const bug = buildFeedbackFiledText("bug_report", 42);
  assert.match(bug, /Your bug report #42 is filed/);
  assert.ok(bug.includes(url));
  assert.match(bug, /screenshot/);
  assert.ok(bug.includes(`${WEBSITE_BASE_URL}/feedback?edit=42`));
  const idea = buildFeedbackFiledText("feature_request", 42);
  assert.match(idea, /Your feature request #42/);
  assert.ok(idea.includes(`${WEBSITE_BASE_URL}/feedback?kind=feature_request&pinned=42`));
  assert.doesNotMatch(idea, /screenshot/);
  assert.ok(!idea.includes("edit="));
});

test("readModalChoice reads a radio group's value from a label", () => {
  const components = [
    { component: { customId: "feedback-title", value: "T" } },
    { component: { customId: "feedback-where", value: "bot" } },
  ];
  assert.equal(readModalChoice(components, "feedback-where"), "bot");
  assert.equal(readModalChoice([{ component: { customId: "feedback-where", values: ["website"] } }],
    "feedback-where"), "website");
  assert.equal(readModalChoice(components, "missing"), null);
});

test("retired Suggestion review buttons answer with the Feedback review link", () => {
  const ids = ["todo-review-suggestions", "suggestion-review:s1:next", "suggestion-approve:3"];
  for (const id of ids) {
    assert.match(id, LEGACY_SUGGESTION_REVIEW_BUTTON_ID);
  }
  assert.doesNotMatch("suggestion-create-modal", LEGACY_SUGGESTION_REVIEW_BUTTON_ID);
  assert.ok(buildLegacySuggestionReviewText().includes(`${WEBSITE_BASE_URL}/admin/feedback`));
});
