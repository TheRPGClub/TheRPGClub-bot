import test from "node:test";
import assert from "node:assert/strict";
import { runClaimSideEffects } from "../commands/giveaway.command.js";
import Member from "../classes/Member.js";

function buildInteraction(donorSends: unknown[]): any {
  return {
    user: { id: "claimant-1" },
    client: {
      channels: {
        fetch: async () => ({ isTextBased: () => true, send: async () => {} }),
      },
      users: {
        fetch: async () => ({
          username: "DonorName",
          send: async (payload: unknown) => {
            donorSends.push(payload);
          },
        }),
      },
    },
  };
}

const key = {
  donorUserId: "donor-1",
  gameTitle: "Some Game",
  platform: "Steam",
  keyId: 42,
};

test("runClaimSideEffects swallows donor-notify failures and still returns a name", async () => {
  const original = Member.getGiveawayDonorNotifySetting;
  try {
    // A non-404 API error here previously aborted the whole claim before the
    // claimant's key DM was sent.
    Member.getGiveawayDonorNotifySetting = (async () => {
      throw new Error("API 500");
    }) as any;

    const donorName = await runClaimSideEffects(buildInteraction([]), key);
    assert.equal(donorName, "DonorName", "donor name resolves despite notify failure");
  } finally {
    Member.getGiveawayDonorNotifySetting = original;
  }
});

test("runClaimSideEffects notifies the donor when the setting is enabled", async () => {
  const original = Member.getGiveawayDonorNotifySetting;
  const donorSends: unknown[] = [];
  try {
    Member.getGiveawayDonorNotifySetting = (async () => true) as any;
    await runClaimSideEffects(buildInteraction(donorSends), key);
    assert.equal(donorSends.length, 1, "donor receives a notification DM");
  } finally {
    Member.getGiveawayDonorNotifySetting = original;
  }
});
