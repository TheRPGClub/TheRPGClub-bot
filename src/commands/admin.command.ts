import {
  ApplicationCommandOptionType,
  MessageFlags,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  type CommandInteraction,
} from "discord.js";
import {
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  withErrorReply,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { logError } from "../utilities/LogUtils.js";
import {
  buildTextReply,
  buildComponentsV2Flags,
  buildComponentsV2EditFlags,
} from "../functions/ComponentsV2Utils.js";
import {
  parseVoteDateInput,
} from "../functions/VoteDateUtils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import { bot } from "../RPGClub_GameDB.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import {
  ADMIN_HELP_TOPICS,
  buildAdminHelpButtons,
  buildAdminHelpEmbed,
  buildAdminHelpResponse,
} from "./admin/admin-help.service.js";
import { handleVotingSetup } from "./admin/voting-admin.service.js";
import {
  handleDeleteGotmNomsPanel,
  handleDeleteNrGotmNomsPanel,
  handleAdminNominationDeleteSelect as handleAdminNominationDeleteSelectAction,
  handleAdminNominationDeleteReasonModal as handleAdminNominationDeleteReasonModalAction,
} from "./admin/nomination-admin.service.js";
import { handleAddGotm, handleEditGotm } from "./admin/gotm-admin.service.js";
import { handleAddNrGotm, handleEditNrGotm } from "./admin/nr-gotm-admin.service.js";
import { handleNextRoundSetup } from "./admin/round-setup-wizard.service.js";
import { type AdminHelpTopicId } from "./admin/admin.types.js";

@Discord()
@SlashGroup({ description: "Admin Commands", name: "admin" })
@SlashGroup("admin")
export class Admin {
  @Slash({
    description: "Synchronize application commands with Discord",
    name: "sync",
  })
  async sync(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await withErrorReply(interaction, async () => {
      const timeoutMs = 30_000;
      await Promise.race([
        bot.initApplicationCommands(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`initApplicationCommands timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);
      await safeReply(interaction, buildTextReply("✅ Commands synchronized with Discord.", true));
    }, "Failed to sync commands");
  }

  @Slash({
    description: "Votes are typically held the last Friday of the month",
    name: "set-nextvote",
  })
  async setNextVote(
    @SlashOption({
      description:
        "Next vote date. Votes are typically held the last Friday of the month.",
      name: "date",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    dateText: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    // Run publicly; avoid default ephemeral deferral for admin commands
    await safeDeferReply(interaction, {});
    dateText = sanitizeUserInput(dateText, { preserveNewlines: false });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const parsed = parseVoteDateInput(dateText);
    if (!parsed) {
      await safeReply(
        interaction,
        buildTextReply(
          "Invalid date format. Please use a recognizable date such as `YYYY-MM-DD`.",
          true,
        ),
      );
      return;
    }

    await withErrorReply(interaction, async () => {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(
          interaction,
          buildTextReply(
            "No voting round information is available. Create a round before setting the next vote date.",
            true,
          ),
        );
        return;
      }

      await BotVotingInfo.updateNextVoteAt(current.roundNumber, parsed);
      const voteUnix = toUnixTimestamp(parsed);

      await safeReply(
        interaction,
        buildTextReply(`Next vote date updated to <t:${voteUnix}:D> (America/New_York).`, false),
      );
    }, "Error updating next vote date");
  }

  @Slash({
    description: "Interactive deletion of GOTM nominations for the upcoming round",
    name: "delete-gotm-noms",
  })
  async deleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleDeleteGotmNomsPanel(interaction);
  }

  @Slash({
    description: "Generate Subo /poll commands for GOTM and NR-GOTM voting",
    name: "voting-setup",
  })
  async votingSetup(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotingSetup(interaction);
  }

  @Slash({
    description: "Interactive deletion of NR-GOTM nominations for the upcoming round",
    name: "delete-nr-gotm-noms",
  })
  async deleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleDeleteNrGotmNomsPanel(interaction);
  }

  @SelectMenuComponent({ id: /^admin-nom-del-select:(gotm|nr-gotm):(\d+)$/ })
  async handleAdminNominationDeleteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAdminNominationDeleteSelectAction(interaction);
  }

  @ModalComponent({ id: /^admin-nom-del-reason:(gotm|nr-gotm):\d+:\d+$/ })
  async handleAdminNominationDeleteReasonModal(interaction: ModalSubmitInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAdminNominationDeleteReasonModalAction(interaction);
  }

  @Slash({ description: "Interactive setup for the next round (GOTM, NR-GOTM, dates)", name: "nextround-setup" })
  async nextRoundSetup(
    @SlashOption({
      description: "Run in test mode (no DB changes)",
      name: "testmode",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    testModeInput: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, {});

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await withErrorReply(interaction, async () => {
      try {
        await handleNextRoundSetup(interaction, testModeInput);
      } catch (err: unknown) {
        logError("admin.command.nextRoundSetup", err);
        throw err;
      }
    }, "Round setup wizard failed");
  }

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAddGotm(interaction);
  }

  @Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
  async addNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAddNrGotm(interaction);
  }

  @Slash({ description: "Edit GOTM data by round", name: "edit-gotm" })
  async editGotm(
    @SlashOption({
      description: "Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleEditGotm(interaction, round);
  }

  @Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" })
  async editNrGotm(
    @SlashOption({
      description: "NR-GOTM Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleEditNrGotm(interaction, round);
  }

  @Slash({ description: "Show help for admin commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildAdminHelpResponse();
    await safeReply(interaction, {
      components: response.components,
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: "admin-help-select" })
  async handleAdminHelpMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as AdminHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = ADMIN_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildAdminHelpResponse();
      const errReply = buildTextReply(
        "Sorry, I don't recognize that admin help topic. Showing the admin help menu.",
        false,
      );
      await safeUpdate(interaction, {
        components: [...errReply.components, ...response.components],
        flags: errReply.flags,
      });
      return;
    }

    const topicContainer = buildAdminHelpEmbed(topic);
    const actionRows = buildAdminHelpButtons(topic.id);
    await safeUpdate(interaction, {
      components: [topicContainer, ...actionRows],
      flags: buildComponentsV2EditFlags(),
    });
  }
}
