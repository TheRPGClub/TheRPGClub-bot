import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { logAvatarChange, updateAvatarRecordFromUrl } from "../utilities/AvatarLogUtils.js";
import { syncUserEmojiFromAvatarChange } from "../services/UserEmojiService.js";
import { COLOR_INFO } from "../config/colors.js";
import {
  buildTitledContainer,
  buildContainerSend,
} from "../functions/ComponentsV2Utils.js";

@Discord()
export class UserUpdate {
  @On()
  async userUpdate([oldUser, newUser]: ArgsOf<"userUpdate">, client: Client): Promise<void> {
    if (newUser.bot) return;

    const oldUsername = oldUser.username ?? "Unknown";
    const newUsername = newUser.username ?? "Unknown";
    const oldGlobalName = oldUser.globalName ?? null;
    const newGlobalName = newUser.globalName ?? null;
    const oldAvatarHash = oldUser.avatar ?? null;
    const newAvatarHash = newUser.avatar ?? null;
    const avatarChanged = oldAvatarHash !== newAvatarHash;

    const usernameChanged = oldUsername !== newUsername;
    const globalNameChanged = oldGlobalName !== newGlobalName;

    if (avatarChanged && newAvatarHash) {
      const avatarUrl = newUser.displayAvatarURL({
        extension: "png",
        size: 512,
        forceStatic: true,
      });
      if (avatarUrl) {
        const updated = await updateAvatarRecordFromUrl(newUser, avatarUrl, newAvatarHash);
        if (updated) {
          await logAvatarChange(client, newUser, "Avatar changed");
        }
        const emojiUrl = newUser.displayAvatarURL({
          extension: "png",
          size: 128,
          forceStatic: true,
        });
        await syncUserEmojiFromAvatarChange(client, newUser.id, emojiUrl);
      }
    }

    if (!usernameChanged && !globalNameChanged) {
      return;
    }

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const timestamp = formatTimestampWithDay(Date.now());

    const sendNameLog = async (
      title: string,
      beforeValue: string,
      afterValue: string,
    ): Promise<void> => {
      const container = buildTitledContainer(
        title,
        `**Before:** ${beforeValue}\n**+After:** ${afterValue}`,
        { color: COLOR_INFO, footer: `ID: ${newUser.id} • ${timestamp}` },
      );
      await (logChannel as any).send({ ...buildContainerSend(container) });
    };

    if (usernameChanged) {
      await sendNameLog("Username changed", oldUsername, newUsername);
    }

    if (globalNameChanged) {
      const oldNameValue = oldGlobalName ?? oldUsername;
      const newNameValue = newGlobalName ?? newUsername;
      await sendNameLog("Display name changed", oldNameValue, newNameValue);
    }
  }
}
