import assert from "node:assert/strict";
import test from "node:test";
import { ComponentType } from "discord-api-types/v10";
import { TextInputStyle } from "discord.js";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import { buildLiveStreamModal } from "../commands/admin/live-stream-admin.service.js";
import { buildNowPlayingAddModal } from "../commands/now-playing/nowPlayingModals.js";
import { buildRoundHistoryModal } from "../commands/round-history.command.js";
import { buildFeedbackModal } from "../commands/feedback.command.js";
import { buildTextInputLabel } from "../functions/uiComponents.js";

test("round history modal serializes label-based discord.js components", () => {
  const originalGotmAll = Gotm.all;
  const originalNrGotmAll = NrGotm.all;
  (Gotm.all as unknown) = () => [];
  (NrGotm.all as unknown) = () => [];

  try {
    const modal = buildRoundHistoryModal("u123456789012345678_c0_tabc123");
    const json = modal.toJSON();

    assert.doesNotThrow(() => modal.toJSON());
    assert.equal(JSON.stringify(json).includes("\"type\":21"), true);
  } finally {
    (Gotm.all as unknown) = originalGotmAll;
    (NrGotm.all as unknown) = originalNrGotmAll;
  }
});

test("feedback modals serialize: title + details, or a Bug Report's five inputs", () => {
  for (const kind of ["feature_request", "suggestion"] as const) {
    const json = buildFeedbackModal(kind).toJSON();
    assert.equal(json.custom_id, `feedback-create:${kind}`);
    assert.deepEqual(
      json.components.map((label: any) => label.component.custom_id),
      ["feedback-title", "feedback-details"],
    );
  }
  const bug = buildFeedbackModal("bug_report").toJSON();
  assert.equal(bug.custom_id, "feedback-create:bug_report");
  assert.equal(bug.components.length, 5);
  assert.equal(JSON.stringify(bug).includes("\"type\":21"), true);
  const where = bug.components
    .map((label: any) => label.component)
    .find((component: any) => component?.custom_id === "feedback-where");
  assert.deepEqual(where.options.map((option: any) => option.value), ["bot", "website"]);
  const steps = bug.components
    .map((label: any) => label.component)
    .find((component: any) => component?.custom_id === "feedback-steps");
  assert.equal(steps.required, false);
});

test("buildTextInputLabel puts the label on a Label wrapping the text input", () => {
  const json = buildTextInputLabel({
    customId: "field-id",
    label: "Field label",
    style: TextInputStyle.Paragraph,
    required: false,
    maxLength: 50,
    value: "prefill",
  });

  assert.equal(json.type, ComponentType.Label);
  assert.equal(json.label, "Field label");
  assert.deepEqual(json.component, {
    type: ComponentType.TextInput,
    custom_id: "field-id",
    style: TextInputStyle.Paragraph,
    required: false,
    max_length: 50,
    value: "prefill",
  });
});

test("text input modals from either ModalBuilder serialize without action rows", () => {
  // buildNowPlayingAddModal uses the discord.js ModalBuilder, live stream the builders one.
  const modals = [buildNowPlayingAddModal(), buildLiveStreamModal("live-stream-modal:1")];
  for (const modal of modals) {
    const types = modal.toJSON().components.map((component) => component.type);
    assert.ok(types.length > 0);
    assert.ok(types.every((type) => type === ComponentType.Label));
  }
});
