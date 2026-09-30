import assert from "node:assert/strict";
import test from "node:test";
import { GameJournalCommand } from "../commands/game-journal.command.js";
import Member, { type IGameJournalEntry } from "../classes/Member.js";

function collectContent(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const objectNode = node as {
      data?: Record<string, unknown>;
      components?: unknown[];
      content?: unknown;
    };
    const candidate = objectNode.data?.content ?? objectNode.content;
    if (typeof candidate === "string") {
      found.push(candidate);
    }
    if (Array.isArray(objectNode.components)) {
      for (const child of objectNode.components) {
        visit(child);
      }
    }
  };
  visit(value);
  return found;
}

test("game journal hmenu delete confirm reports the delete or the cancel", async () => {
  const command = new GameJournalCommand() as any;
  const originalDelete = Member.deleteGameJournalEntry;

  const deleted: IGameJournalEntry = {
    entryId: 10,
    entryNumber: 3,
    userId: "123",
    gameId: 1,
    title: null,
    body: "Body",
    createdAt: new Date("2026-05-11T00:00:00.000Z"),
    updatedAt: new Date("2026-05-11T00:00:00.000Z"),
  };
  let deleteCalls = 0;
  const updates: unknown[] = [];

  try {
    Member.deleteGameJournalEntry = (async () => {
      deleteCalls += 1;
      return deleted;
    }) as any;

    const makeInteraction = (action: "yes" | "no") => ({
      customId: `game-journal-hmenu-delete-confirm:${action}:123:1:10`,
      isMessageComponent: () => true,
      user: { id: "123" },
      guildId: "987654321",
      client: {},
      message: { id: "555", flags: { has: () => true } },
      deferred: false,
      replied: false,
      update: async (payload: unknown) => {
        updates.push(payload);
      },
      followUp: async () => undefined,
      reply: async () => undefined,
      editReply: async () => undefined,
    }) as any;

    await command.handleGjHmenuDeleteConfirm(makeInteraction("no"));
    assert.equal(deleteCalls, 0);
    const cancelText = collectContent(updates[0]).join("\n");
    assert.ok(cancelText.includes("## Manage Journal"));
    assert.ok(cancelText.includes("-# Delete cancelled. Nothing was deleted."));

    await command.handleGjHmenuDeleteConfirm(makeInteraction("yes"));
    assert.equal(deleteCalls, 1);
    const deleteText = collectContent(updates[1]).join("\n");
    assert.ok(deleteText.includes("## Manage Journal"));
    assert.ok(deleteText.includes("-# Deleted **Entry #3**."));
  } finally {
    Member.deleteGameJournalEntry = originalDelete;
  }
});
