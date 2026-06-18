import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { logAvatarChange, updateAvatarRecordFromUrl } from "../utilities/AvatarLogUtils.js";
import {
  ensureUserEmojiForMember,
  syncUserEmojiFromAvatarChange,
  syncUserEmojiFromDisplayNameChange,
} from "../services/UserEmojiService.js";
import {
  ADMIN_ROLE_ID,
  MEMBER_ROLE_ID,
  MODERATOR_ROLE_ID,
  REGULARS_ROLE_ID,
} from "../config/roles.js";
import { COLOR_INFO, COLOR_ERROR } from "../config/colors.js";
import { buildIdTimestampFooter } from "../functions/InteractionUtils.js";
import {
  buildTitledContainer,
  buildContainerSend,
} from "../functions/ComponentsV2Utils.js";

const QUALIFYING_ROLE_IDS_SET = new Set(
  [REGULARS_ROLE_ID, ADMIN_ROLE_ID, MODERATOR_ROLE_ID, MEMBER_ROLE_ID].filter(
    (id): id is string => id !== null,
  ),
);

@Discord()
export class GuildMemberUpdate {
  @On()
  async guildMemberUpdate(
    [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
    _client: Client,
  ): Promise<void> {
    void _client;

    const user = newMember.user;
    const oldNick = oldMember.nickname ?? oldMember.user.globalName ?? oldMember.user.username;
    const newNick = newMember.nickname ?? newMember.user.globalName ?? newMember.user.username;

    const nicknameChanged = oldNick !== newNick;
    const oldGuildAvatar = oldMember.avatar ?? null;
    const newGuildAvatar = newMember.avatar ?? null;
    const guildAvatarChanged = oldGuildAvatar !== newGuildAvatar;
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));

    if (!user.bot && (addedRoles.size > 0 || removedRoles.size > 0)) {
      const logChannel = await resolveLogChannel(_client);
      if (logChannel) {
        const timestamp = formatTimestampWithDay(Date.now());
        const sendRoleLog = async (
          label: string,
          roleId: string,
          color: number,
        ): Promise<void> => {
          if (roleId === newMember.guild.id) return;
          const container = buildTitledContainer(label, `<@&${roleId}>`, {
            color,
            footer: buildIdTimestampFooter(user.id, timestamp),
          });
          await (logChannel as any).send({ ...buildContainerSend(container) });
        };

        for (const role of addedRoles.values()) {
          await sendRoleLog("Role added", role.id, COLOR_INFO);
        }

        for (const role of removedRoles.values()) {
          await sendRoleLog("Role removed", role.id, COLOR_ERROR);
        }
      }
    }

    if (!user.bot && guildAvatarChanged && newGuildAvatar) {
      const avatarUrl = newMember.displayAvatarURL({
        extension: "png",
        size: 512,
        forceStatic: true,
      });
      if (avatarUrl) {
        const updated = await updateAvatarRecordFromUrl(user, avatarUrl, newGuildAvatar);
        if (updated) {
          await logAvatarChange(_client, user, "Server avatar changed");
        }
        const emojiUrl = newMember.displayAvatarURL({
          extension: "png",
          size: 128,
          forceStatic: true,
        });
        await syncUserEmojiFromAvatarChange(_client, user.id, emojiUrl);
      }
    }

    const gainedQualifyingRole = addedRoles.some((r) => QUALIFYING_ROLE_IDS_SET.has(r.id));
    if (!user.bot && gainedQualifyingRole) {
      await ensureUserEmojiForMember(_client, newMember);
    }

    if (!user.bot && nicknameChanged) {
      const logChannel = await resolveLogChannel(_client);
      if (logChannel) {
        const timestamp = formatTimestampWithDay(Date.now());
        const sendNameLog = async (
          title: string,
          beforeValue: string,
          afterValue: string,
          color: number,
        ): Promise<void> => {
          const container = buildTitledContainer(
            title,
            `**Before:** ${beforeValue}\n**+After:** ${afterValue}`,
            { color, footer: buildIdTimestampFooter(user.id, timestamp) },
          );
          await (logChannel as any).send({ ...buildContainerSend(container) });
        };

        const oldNicknameValue =
          oldMember.nickname ?? oldMember.user.globalName ?? oldMember.user.username;
        const newNicknameValue =
          newMember.nickname ?? newMember.user.globalName ?? newMember.user.username;
        const nicknameTitle =
          oldMember.nickname && !newMember.nickname
            ? "Nickname removed"
            : !oldMember.nickname && newMember.nickname
            ? "Nickname added"
            : "Nickname changed";
        const nicknameColor =
          oldMember.nickname && !newMember.nickname ? COLOR_ERROR : COLOR_INFO;
        await sendNameLog(
          nicknameTitle,
          oldNicknameValue,
          newNicknameValue,
          nicknameColor,
        );
      }
    }

    if (!nicknameChanged) {
      return;
    }

    await syncUserEmojiFromDisplayNameChange(_client, newMember);

    try {
      const record: IMemberRecord = {
        userId: user.id,
        isBot: user.bot ? 1 : 0,
        username: user.username ?? null,
        globalName: newNick ?? null,
        avatarBlob: null,
        serverJoinedAt: newMember.joinedAt ?? null,
        serverLeftAt: null,
        lastSeenAt: null,
        roleAdmin: 0,
        roleModerator: 0,
        roleRegular: 0,
        roleMember: 0,
        roleNewcomer: 0,
        messageCount: null,
        completionatorUrl: null,
        psnUsername: null,
        xblUsername: null,
        nswFriendCode: null,
        steamUrl: null,
        profileImage: null,
        profileImageAt: null,
      };

      await Member.upsert(record);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      logError("GuildMemberUpdate.upsertNicknameChange", msg);
    }
  }
}
