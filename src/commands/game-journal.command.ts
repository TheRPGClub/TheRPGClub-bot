import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import Member, {
  type IGameJournalListEntry,
  type IJournalUserSummary,
} from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

function displayName(user: User): string {
  return user.displayName ?? user.username;
}

function formatGameLine(entry: IGameJournalListEntry, isSelf: boolean): string {
  const count = isSelf ? entry.totalEntries : entry.publicEntries;
  const label = count === 1 ? "entry" : "entries";
  return `**${entry.title}** — ${count} ${label}`;
}

function formatUserLine(summary: IJournalUserSummary): string {
  const label = summary.gameCount === 1 ? "game" : "games";
  return `<@${summary.userId}> — ${summary.gameCount} ${label}`;
}

function buildUserJournalEmbed(
  target: User,
  entries: IGameJournalListEntry[],
  isSelf: boolean,
): EmbedBuilder {
  const name = displayName(target);
  const embed = new EmbedBuilder()
    .setTitle(`${name}'s Game Journals`)
    .setThumbnail(target.displayAvatarURL());

  if (!entries.length) {
    embed.setDescription("No game journals found.");
    return embed;
  }

  const lines = entries.map((e) => formatGameLine(e, isSelf));
  const gameLabel = entries.length === 1 ? "game" : "games";
  embed.setDescription(lines.join("\n"));
  embed.setFooter({ text: `${entries.length} ${gameLabel}` });
  return embed;
}

function buildAllJournalsEmbed(summaries: IJournalUserSummary[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("Game Journal Users");

  if (!summaries.length) {
    embed.setDescription("No members are currently using Game Journals.");
    return embed;
  }

  const lines = summaries.map(formatUserLine);
  const memberLabel = summaries.length === 1 ? "member" : "members";
  embed.setDescription(lines.join("\n"));
  embed.setFooter({ text: `${summaries.length} ${memberLabel}` });
  return embed;
}

@Discord()
export class GameJournalCommand {
  @Slash({ description: "View Game Journal lists for yourself, a member, or everyone", name: "game-journal" })
  async gameJournal(
    @SlashOption({
      description: "Show all members who use Game Journals",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    all: boolean | undefined,
    @SlashOption({
      description: "Member whose journal list to view; defaults to you",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Return the result as an ephemeral (private) message",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isPrivate: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = isPrivate === true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (member !== undefined) {
      const isSelf = member.id === interaction.user.id;
      const entries = await Member.getGameJournalList(member.id);
      const embed = buildUserJournalEmbed(member, entries, isSelf);
      await safeReply(interaction, {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (all === true) {
      const summaries = await Member.getAllJournalUsers();
      const embed = buildAllJournalsEmbed(summaries);
      await safeReply(interaction, {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const entries = await Member.getGameJournalList(interaction.user.id);
    const embed = buildUserJournalEmbed(interaction.user, entries, true);
    await safeReply(interaction, {
      embeds: [embed],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}
