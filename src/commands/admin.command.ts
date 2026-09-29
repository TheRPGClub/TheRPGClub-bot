import {
  ApplicationCommandOptionType,
  MessageFlags,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  type ButtonInteraction,
  type Channel,
  type CommandInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
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
import VotingRounds from "../classes/VotingRounds.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import {
  buildAdminHelpButtons,
  buildAdminHelpEmbed,
  buildAdminHelpResponse,
  resolveAdminHelpTopic,
} from "./admin/admin-help.service.js";
import { handleLegacyVotingSetup } from "./admin/voting-admin.service.js";
import {
  handleVoteCloseButton,
  handleVotesReset,
  handleVotesResetButton,
  handleVotingClose,
  handleVotingOpen,
  handleVotingResults,
} from "./admin/vote-admin.service.js";
import {
  handleDeleteGotmNomsPanel,
  handleDeleteNrGotmNomsPanel,
  handleAdminNominationDeleteSelect as handleAdminNominationDeleteSelectAction,
  handleAdminNominationDeleteReasonModal as handleAdminNominationDeleteReasonModalAction,
} from "./admin/nomination-admin.service.js";
import { handleAddGotm, handleEditGotm } from "./admin/gotm-admin.service.js";
import { handleAddNrGotm, handleEditNrGotm } from "./admin/nr-gotm-admin.service.js";
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
      const current = await VotingRounds.getCurrent();
      if (!current) {
        await safeReply(interaction, buildTextReply("No voting round is scheduled.", true));
        return;
      }
      if (current.votingEnded) {
        await safeReply(
          interaction,
          buildTextReply(
            `Voting for Round ${current.roundNumber} has ended. The next round is ` +
              "scheduled once this one is decided.",
            true,
          ),
        );
        return;
      }

      // The API moves the close with the open, keeping the default weekend window.
      const updated = await VotingRounds.reschedule(current.roundNumber, {
        votingOpensAt: parsed,
      });
      const opensUnix = toUnixTimestamp(updated.votingOpensAt);
      const closesUnix = toUnixTimestamp(updated.votingClosesAt);

      await safeReply(
        interaction,
        buildTextReply(
          `Round ${updated.roundNumber} voting now opens <t:${opensUnix}:F> and closes ` +
            `<t:${closesUnix}:F>.`,
          false,
        ),
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
    description: "Legacy fallback: generate Subo /poll commands for GOTM and NR-GOTM voting",
    name: "legacy-voting-setup",
  })
  async legacyVotingSetup(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleLegacyVotingSetup(interaction);
  }

  @Slash({
    description: "Repost the voting panels for the round currently open for votes",
    name: "voting-open",
  })
  async votingOpen(
    @SlashOption({
      description: "Post the voting panels in this channel instead of announcements",
      name: "post-here",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    postHere: boolean | undefined,
    @SlashOption({
      description: "Rehearse: post panels here only, write nothing, skip winner threads",
      name: "testmode",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    testMode: boolean | undefined,
    @SlashOption({
      description: "Round to rehearse (testmode only; defaults to the scheduled round)",
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotingOpen(interaction, !!postHere, !!testMode, round);
  }

  @Slash({
    description: "Close the open voting round now instead of at the scheduled deadline",
    name: "voting-close",
  })
  async votingClose(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotingClose(interaction);
  }

  @Slash({
    description: "Show the current vote tallies for a round",
    name: "voting-results",
  })
  async votingResults(
    @SlashOption({
      description: "Round number (defaults to the current round)",
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number | undefined,
    @SlashOption({
      description: "Post the results and winner announcements to announcements",
      name: "publish",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    publish: boolean | undefined,
    @SlashOption({
      description: "Rehearse the publish in this channel instead of announcements",
      name: "channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotingResults(interaction, round, !!publish, channel?.id);
  }

  @Slash({
    description: "Delete all first-party votes for a round",
    name: "votes-reset",
  })
  async votesReset(
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Voting category",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    @SlashOption({
      description: "Round number whose votes should be deleted",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotesReset(interaction, rawKind, round);
  }

  @ButtonComponent({ id: /^admin-vote-close:\d+:(confirm|cancel)$/ })
  async handleAdminVoteCloseButton(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleVoteCloseButton(interaction);
  }

  @ButtonComponent({ id: /^admin-votes-reset:(gotm|nr-gotm):\d+:(confirm|cancel)$/ })
  async handleAdminVotesResetButton(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleVotesResetButton(interaction);
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

    const topic = resolveAdminHelpTopic(topicId);

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
