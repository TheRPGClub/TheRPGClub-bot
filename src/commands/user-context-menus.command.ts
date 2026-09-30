import {
  ApplicationCommandType,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { ContextMenu, Discord } from "discordx";
import { deferWithPrivateFlag, safeReply } from "../functions/InteractionUtils.js";
import { buildTextReply } from "../functions/ComponentsV2Utils.js";
import { replyWithProfileView } from "./profile.command.js";
import { NowPlayingCommand } from "./now-playing.command.js";
import { renderCommonCompletionPage } from "./game-completion/completion-common.service.js";

// Discord allows 5 user context menus per app; this file holds 3 of them.
// Replies are ephemeral: a right-click is a private lookup, not a post to the channel.
const CONTEXT_MENU_EPHEMERAL = true;

@Discord()
export class UserContextMenus {
  @ContextMenu({ name: "View profile", type: ApplicationCommandType.User })
  async viewProfile(interaction: UserContextMenuCommandInteraction): Promise<void> {
    await deferWithPrivateFlag(interaction, CONTEXT_MENU_EPHEMERAL);
    await replyWithProfileView(interaction, interaction.targetUser, CONTEXT_MENU_EPHEMERAL);
  }

  @ContextMenu({ name: "Now playing", type: ApplicationCommandType.User })
  async nowPlaying(interaction: UserContextMenuCommandInteraction): Promise<void> {
    await deferWithPrivateFlag(interaction, CONTEXT_MENU_EPHEMERAL);
    await new NowPlayingCommand().showSingle(
      interaction,
      interaction.targetUser,
      CONTEXT_MENU_EPHEMERAL,
    );
  }

  @ContextMenu({ name: "Compare completions", type: ApplicationCommandType.User })
  async compareCompletions(interaction: UserContextMenuCommandInteraction): Promise<void> {
    await deferWithPrivateFlag(interaction, CONTEXT_MENU_EPHEMERAL);
    const target = interaction.targetUser;
    if (target.id === interaction.user.id) {
      await safeReply(
        interaction,
        buildTextReply(
          "Pick another member to compare your completions with.",
          CONTEXT_MENU_EPHEMERAL,
        ),
      );
      return;
    }

    await renderCommonCompletionPage(
      interaction,
      {
        leftId: interaction.user.id,
        rightId: target.id,
        sort: "date_desc",
        year: null,
        platformId: null,
      },
      0,
      CONTEXT_MENU_EPHEMERAL,
    );
  }
}
