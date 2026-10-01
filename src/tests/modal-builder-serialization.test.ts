import assert from "node:assert/strict";
import test from "node:test";
import { ComponentType } from "discord-api-types/v10";
import { TextInputStyle } from "discord.js";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import { buildLiveStreamModal } from "../commands/admin/live-stream-admin.service.js";
import { buildNowPlayingAddModal } from "../commands/now-playing/nowPlayingModals.js";
import { buildRoundHistoryModal } from "../commands/round-history.command.js";
import {
  buildSuggestionCreateModal,
  buildSuggestionReviewDecisionModal,
} from "../commands/suggestion.command.js";
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

test("suggestion modals serialize checkbox and radio label components", () => {
  const createModal = buildSuggestionCreateModal();
  const reviewModal = buildSuggestionReviewDecisionModal(
    "suggestion-review-decision:123456789012345678:42",
    "Suggestion: #42 - Test\n\nDetails:\nTry the new modal.",
  );

  assert.doesNotThrow(() => createModal.toJSON());
  assert.doesNotThrow(() => reviewModal.toJSON());
  assert.equal(JSON.stringify(createModal.toJSON()).includes("\"type\":22"), true);
  assert.equal(JSON.stringify(reviewModal.toJSON()).includes("\"type\":21"), true);
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
