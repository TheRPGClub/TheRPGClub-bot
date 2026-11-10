import test from "node:test";
import assert from "node:assert/strict";
import { runClaimSideEffects } from "../commands/giveaway.command.js";
import Member from "../classes/Member.js";
import { runGiveawayClaimSideEffects } from "../services/GiveawayClaimService.js";

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

test("runGiveawayClaimSideEffects posts the claim log for the claimer", async () => {
  const original = Member.getGiveawayDonorNotifySetting;
  const logs: any[] = [];
  try {
    Member.getGiveawayDonorNotifySetting = (async () => false) as any;
    const client: any = {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async (payload: unknown) => {
            logs.push(payload);
          },
        }),
      },
      users: { fetch: async () => ({ username: "DonorName", send: async () => {} }) },
    };
    await runGiveawayClaimSideEffects(client, "web-claimer", key);
    assert.equal(logs.length, 1, "one claim log post");
    assert.match(JSON.stringify(logs[0]), /<@web-claimer> claimed \*\*Some Game\*\* \(Steam\)/);
  } finally {
    Member.getGiveawayDonorNotifySetting = original;
  }
});

test("runGiveawayClaimSideEffects does not DM a donor who claimed their own key", async () => {
  const original = Member.getGiveawayDonorNotifySetting;
  const donorSends: unknown[] = [];
  try {
    Member.getGiveawayDonorNotifySetting = (async () => true) as any;
    const client = buildInteraction(donorSends).client;
    const donorName = await runGiveawayClaimSideEffects(client, "donor-1", key);
    assert.equal(donorName, "DonorName");
    assert.equal(donorSends.length, 0, "no self-notification");
  } finally {
    Member.getGiveawayDonorNotifySetting = original;
  }
});

test("runGiveawayClaimSideEffects with no log channel (Giveaways Off) logs and tells no one",
  async () => {
    const original = Member.getGiveawayDonorNotifySetting;
    const donorSends: unknown[] = [];
    const logs: unknown[] = [];
    try {
      Member.getGiveawayDonorNotifySetting = (async () => true) as any;
      const client: any = {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async (payload: unknown) => {
              logs.push(payload);
            },
          }),
        },
        users: {
          fetch: async () => ({
            username: "DonorName",
            send: async (payload: unknown) => {
              donorSends.push(payload);
            },
          }),
        },
      };
      const donorName = await runGiveawayClaimSideEffects(client, "web-claimer", key, null);
      assert.equal(donorName, "DonorName", "the claimer's DM still names the donor");
      assert.deepEqual(logs, []);
      assert.deepEqual(donorSends, []);
    } finally {
      Member.getGiveawayDonorNotifySetting = original;
    }
  });
