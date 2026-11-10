import { userMention, type Client } from "discord.js";
import Member from "../classes/Member.js";
import {
  buildComponentsV2EditFlags,
  buildTitledContainer,
} from "../functions/ComponentsV2Utils.js";
import { GIVEAWAY_LOG_CHANNEL_ID } from "../config/channels.js";
import { COLOR_SUCCESS } from "../config/colors.js";
import { safeIgnore } from "../utilities/AsyncUtils.js";
import { logError } from "../utilities/LogUtils.js";

/** The claimed key, as the claim side effects need it. */
export interface IClaimedGiveawayKey {
  donorUserId: string;
  gameTitle: string;
  platform: string;
  keyId: number;
}

/** The slice of the Client the side effects use (a fake in tests). */
export type GiveawayClaimClient = {
  channels: Pick<Client["channels"], "fetch">;
  users: Pick<Client["users"], "fetch">;
};

async function logGiveawayClaim(
  channel: any,
  userId: string,
  keyTitle: string,
  platform: string,
  keyId: number,
): Promise<void> {
  const message =
    `${userMention(userId)} claimed **${keyTitle}** (${platform}) [Key ID: ${keyId}].`;
  if (channel && typeof channel.send === "function") {
    const container = buildTitledContainer("Giveaway claim", message, { color: COLOR_SUCCESS });
    safeIgnore(channel.send({ components: [container], flags: buildComponentsV2EditFlags() }));
  }
}

/** The DM that hands the claimer their key (the /giveaway claim and the website's). */
export function buildClaimedKeyDm(
  gameTitle: string,
  platform: string,
  keyValue: string,
  donorName: string,
): string {
  return (
    `You claimed **${gameTitle}** (${platform}).\n` +
    `Key: \`${keyValue}\`\n` +
    `This key was donated by ${donorName}, be sure to thank them!`
  );
}

/**
 * Writes the claim log to `logChannelId` and notifies the donor (when their setting is on
 * and they are not the claimer). A null `logChannelId` (a website claim while the
 * Giveaways Feature is Off) does neither. Never throws: any failure is logged and swallowed
 * so the claimer's key DM still proceeds. Returns the donor display name (falls back to a
 * mention).
 */
export async function runGiveawayClaimSideEffects(
  client: GiveawayClaimClient,
  claimerId: string,
  key: IClaimedGiveawayKey,
  logChannelId: string | null = GIVEAWAY_LOG_CHANNEL_ID,
): Promise<string> {
  let donorName: string = userMention(key.donorUserId);
  try {
    if (logChannelId) {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      const textChannel = logChannel?.isTextBased() ? logChannel : null;
      await logGiveawayClaim(textChannel, claimerId, key.gameTitle, key.platform, key.keyId);
    }

    const donorUser = await client.users.fetch(key.donorUserId).catch(() => null);
    donorName = donorUser?.username ?? userMention(key.donorUserId);
    if (!logChannelId || !donorUser || key.donorUserId === claimerId) {
      return donorName;
    }
    const notifyDonor = await Member.getGiveawayDonorNotifySetting(key.donorUserId);
    if (notifyDonor) {
      safeIgnore(donorUser.send({
        content:
          `Your donated key for **${key.gameTitle}** (${key.platform}) was claimed by ` +
          `${userMention(claimerId)}. Thanks for contributing!`,
      }));
    }
  } catch (err: unknown) {
    logError("giveaway.runClaimSideEffects", err);
  }
  return donorName;
}
