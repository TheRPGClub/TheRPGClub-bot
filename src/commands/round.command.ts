import { type CommandInteraction, ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  deferWithPrivateFlag,
  withErrorReply,
  safeReply,
} from "../functions/InteractionUtils.js";
import { buildComponentsV2Flags, buildTextReply } from "../functions/ComponentsV2Utils.js";
import { fetchCurrentGotmRound } from "../classes/GotmRounds.js";
import {
  buildGotmCardsFromEntries,
  buildGotmSearchMessages,
} from "../functions/GotmSearchComponents.js";

@Discord()
@SlashGroup("gotm")
export class CurrentRoundCommand {
  @Slash({
    description: "Show the current GOTM round and winners",
    name: "current",
  })
  async round(
    @SlashOption({
      description: "Send reply privately (only visible to you).",
      name: "private",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    privateFlag: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = privateFlag ?? false;
    await deferWithPrivateFlag(interaction, privateFlag);

    await withErrorReply(interaction, async () => {
      // The API's current GOTM round is the latest one with recorded winners, not the
      // round being nominated or voted on.
      const current = await fetchCurrentGotmRound();
      if (!current) {
        await safeReply(interaction, buildTextReply("No GOTM round has been recorded yet.", true));
        return;
      }

      const roundNumber = current.round;
      const gotmEntries = current.gotmEntries;
      const nrGotmEntries = current.nrGotmEntries;

      const gotmMonthYear = gotmEntries[0]?.monthYear;
      const nrGotmMonthYear = nrGotmEntries[0]?.monthYear;

      const gotmCards = buildGotmCardsFromEntries(gotmEntries, "GOTM");
      const nrCards = buildGotmCardsFromEntries(nrGotmEntries, "NR-GOTM").filter(
        (card) => card.title.trim().toLowerCase() !== "n/a",
      );
      const cards = [...gotmCards, ...nrCards];

      const currentDescLines: string[] = [];
      const mainLine = `Round ${roundNumber}`;
      const titleMonthYear = gotmMonthYear ?? nrGotmMonthYear;
      const roundTitle = titleMonthYear
        ? `Round ${roundNumber} - ${titleMonthYear}`
        : `Round ${roundNumber}`;

      currentDescLines.push(mainLine);

      if (!gotmMonthYear && !nrGotmMonthYear) {
        // no extra month/year lines
      } else if (!(gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear)) {
        if (gotmMonthYear) {
          currentDescLines.push(`GOTM: ${gotmMonthYear}`);
        }
        if (nrGotmMonthYear) {
          currentDescLines.push(`NR-GOTM: ${nrGotmMonthYear}`);
        }
      }

      if (!cards.length) {
        currentDescLines.push("");
        currentDescLines.push("(No GOTM or NR-GOTM entries found for this round.)");
      }

      const payloads = await buildGotmSearchMessages(interaction.client, cards, {
        title: roundTitle,
        continuationTitle: `${roundTitle} (continued)`,
        emptyMessage: "No GOTM or NR-GOTM entries found for this round.",
        introText: currentDescLines.slice(1).join("\n"),
        guildId: interaction.guildId ?? undefined,
        maxGamesPerContainer: 10,
      });

      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        await safeReply(interaction, {
          components: payload.components,
          files: payload.files.length ? payload.files : undefined,
          flags: buildComponentsV2Flags(ephemeral),
          ...(i > 0 ? { __forceFollowUp: true } : {}),
        });
      }
    }, "Error fetching current round information");
  }
}
