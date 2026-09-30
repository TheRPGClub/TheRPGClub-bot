import test from "node:test";
import assert from "node:assert/strict";
import { ComponentType, MessageFlags } from "discord.js";
import { disableClickedRow, type IRawComponent } from "../functions/ClickedRowLock.js";
import { withClickedRowDisabled } from "../functions/InteractionUtils.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";

const LINK_BUTTON = { type: ComponentType.Button, style: 5, url: "https://example.com" };

function buttonRow(...ids: string[]): IRawComponent {
  return {
    type: ComponentType.ActionRow,
    components: ids.map((id) => ({ type: ComponentType.Button, custom_id: id, label: id })),
  };
}

test("disableClickedRow disables only the row holding the clicked button", () => {
  const clicked = buttonRow("save", "reset");
  const other = buttonRow("back");
  assert.equal(disableClickedRow([clicked, other], "save", "Saving..."), true);
  assert.deepEqual(
    clicked.components?.map((c) => [c.disabled, c.label]),
    [[true, "Saving..."], [true, "reset"]],
  );
  assert.equal(other.components?.[0].disabled, undefined);
});

test("disableClickedRow finds rows nested in a container and leaves links usable", () => {
  const row = buttonRow("claim");
  row.components?.push({ ...LINK_BUTTON });
  const container = { type: ComponentType.Container, components: [row] };
  assert.equal(disableClickedRow([container], "claim"), true);
  assert.equal(row.components?.[0].disabled, true);
  assert.equal(row.components?.[0].label, "claim");
  assert.equal(row.components?.[1].disabled, undefined);
});

test("disableClickedRow disables a clicked section accessory", () => {
  const accessory: IRawComponent = {
    type: ComponentType.Button,
    custom_id: "open",
    label: "Open",
  };
  const section = { type: ComponentType.Section, components: [], accessory };
  assert.equal(disableClickedRow([section], "open", "Opening..."), true);
  assert.equal(accessory.disabled, true);
  assert.equal(accessory.label, "Opening...");
});

test("disableClickedRow reports a missing ID", () => {
  assert.equal(disableClickedRow([buttonRow("a")], "b"), false);
});

type Edit = { components: IRawComponent[]; flags?: number };

function makeInteraction(edits: Edit[], rendered: { value: boolean }): any {
  const rows = [buttonRow("save", "reset")];
  const interaction: any = {
    customId: "save",
    channelId: "c1",
    user: { id: "u1" },
    deferred: false,
    replied: false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    message: {
      flags: { has: (flag: number) => flag === MessageFlags.IsComponentsV2 },
      components: rows.map((row) => ({ toJSON: () => structuredClone(row) })),
    },
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    webhook: {
      editMessage: async (_target: string, payload: Edit) => {
        edits.push(payload);
        return { editedTimestamp: 1 };
      },
      fetchMessage: async () => ({ editedTimestamp: rendered.value ? 2 : 1 }),
    },
  };
  return interaction;
}

test("withClickedRowDisabled restores the disabled row when nothing rendered", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: false });
  let sawLock = false;
  await withClickedRowDisabled(interaction, async () => {
    sawLock = edits.length === 1;
    assert.equal(interaction.replied, false);
  });
  assert.equal(sawLock, true);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(edits[0].components[0].components?.[1].disabled, true);
  assert.equal(edits[1].components[0].components?.[1].disabled, undefined);
});

test("withClickedRowDisabled leaves a rendered result alone", async () => {
  const edits: Edit[] = [];
  await withClickedRowDisabled(makeInteraction(edits, { value: true }), async () => {});
  assert.equal(edits.length, 1);
});

test("withClickedRowDisabled keeps the row disabled when asked", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: false });
  await withClickedRowDisabled(interaction, async () => {}, { keepDisabled: true });
  assert.equal(edits.length, 1);
});

test("withClickedRowDisabled restores the row and rethrows when the work fails", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: true });
  await assert.rejects(
    withClickedRowDisabled(interaction, async () => {
      throw new Error("boom");
    }, { keepDisabled: true }),
    /boom/,
  );
  assert.equal(edits.length, 2);
  assert.equal(edits[1].components[0].components?.[0].disabled, undefined);
});

test("withClickedRowDisabled runs the work without a lock once acknowledged", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: false });
  interaction.deferred = true;
  let ran = false;
  await withClickedRowDisabled(interaction, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(edits.length, 0);
});

test("withClickedRowDisabled skips the work when the dev channel blocks the click", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: false });
  interaction.channelId = BOT_DEV_CHANNEL_ID;
  interaction.message.interaction = { user: { id: "owner" } };
  const replies: unknown[] = [];
  interaction.reply = async (payload: unknown) => {
    replies.push(payload);
  };
  let ran = false;
  await withClickedRowDisabled(interaction, async () => {
    ran = true;
  });
  assert.equal(ran, false);
  assert.equal(replies.length, 1);
  assert.equal(edits.length, 0);
});

test("withClickedRowDisabled runs the work unlocked after an acknowledgement race", async () => {
  const edits: Edit[] = [];
  const interaction = makeInteraction(edits, { value: false });
  interaction.deferUpdate = async () => {
    const error: any = new Error("Unknown interaction");
    error.code = 10062;
    throw error;
  };
  let ran = false;
  await withClickedRowDisabled(interaction, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(edits.length, 0);
});
