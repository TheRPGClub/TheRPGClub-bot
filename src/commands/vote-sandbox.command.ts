import type {
  ButtonInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import {
  ButtonComponent,
  Discord,
  Guild,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import { parseNominationKind } from "../classes/Nomination.js";
import type { VotingEventKind } from "../classes/VotingEvents.js";
import { isVotingRoundCategory } from "../classes/VotingRounds.js";
import { safeDeferReply } from "../functions/InteractionUtils.js";
import { logError } from "../utilities/LogUtils.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import { handleTieBreakSelect } from "./admin/vote-admin.service.js";
import {
  respondVoteCast,
  respondVoteMine,
  respondVoteTally,
  type IVotePanelTarget,
} from "./vote/vote-panel-actions.service.js";
import {
  handleSandboxClose,
  handleSandboxDeliver,
  handleSandboxEnd,
  handleSandboxEvent,
  handleSandboxOpen,
  handleSandboxRemind,
  handleSandboxSeed,
  handleSandboxStart,
  handleSandboxStatus,
  refuseOutsideTestMode,
  resolveSandboxGuilds,
} from "./vote-sandbox/vote-sandbox.service.js";
import {
  createSandboxDataSource,
  deliverSandboxOutbox,
  parseSandboxCustomId,
  type ISandboxTarget,
} from "../services/VotingSandbox.js";
import {
  isSandboxOutcome,
  SANDBOX_DEFAULT_CAP,
  SANDBOX_DEFAULT_NOMINATIONS,
  SANDBOX_DEFAULT_ROUND,
  SANDBOX_MAX_NOMINATIONS,
  type SandboxOutcome,
} from "../services/VotingSandboxModel.js";

const OUTCOME_CHOICES = [
  { name: "Clear winner", value: "winner" },
  { name: "Two-way tie", value: "two-way-tie" },
  { name: "Three-way tie", value: "three-way-tie" },
  { name: "No votes", value: "no-votes" },
];

const EVENT_CHOICES: Array<{ name: string; value: VotingEventKind }> = [
  { name: "nomination_reminder_5d", value: "nomination_reminder_5d" },
  { name: "nomination_reminder_1d", value: "nomination_reminder_1d" },
  { name: "voting_opened", value: "voting_opened" },
  { name: "voting_closed", value: "voting_closed" },
  { name: "tie_pending", value: "tie_pending" },
  { name: "round_decided", value: "round_decided" },
];

function toOutcome(value: string | undefined): SandboxOutcome | undefined {
  return value && isSandboxOutcome(value) ? value : undefined;
}

/** Stands in for a panel id that does not parse; its reads are never reached. */
const UNPARSED_SANDBOX: ISandboxTarget = { ownerId: "0", sandboxId: "" };

/**
 * Sandbox and category from a panel id. A panel from an ended sandbox is
 * refused by the data source with a message saying so.
 */
function resolvePanel(
  customId: string,
): { sandbox: ISandboxTarget; target: IVotePanelTarget | null } {
  const parsed = parseSandboxCustomId(customId);
  const kind = parseNominationKind(parsed?.rest[0] ?? "");
  if (!parsed || !kind) return { sandbox: UNPARSED_SANDBOX, target: null };
  return { sandbox: parsed, target: { kind, round: parsed.roundNumber } };
}

async function beginAdminStep(interaction: CommandInteraction): Promise<boolean> {
  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  if (await refuseOutsideTestMode(interaction)) return false;
  return isAdmin(interaction);
}

@Discord()
@Guild(() => resolveSandboxGuilds())
@SlashGroup({
  description: "Test mode: walk a sandboxed GOTM / NR-GOTM voting round",
  name: "vote-sandbox",
})
@SlashGroup("vote-sandbox")
export class VoteSandboxCommand {
  @Slash({ description: "Start a fresh sandbox round, replacing yours", name: "start" })
  async start(
    @SlashOption({
      description: `Round number to show (default ${SANDBOX_DEFAULT_ROUND})`,
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
    })
    roundNumber: number | undefined,
    @SlashOption({
      description: `Votes each member may cast per category (default ${SANDBOX_DEFAULT_CAP})`,
      name: "cap",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
      maxValue: 5,
    })
    cap: number | undefined,
    @SlashOption({
      description:
        `Fixture GOTM games (default ${SANDBOX_DEFAULT_NOMINATIONS}, 26+ splits the menu)`,
      name: "gotm-nominations",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: SANDBOX_MAX_NOMINATIONS,
    })
    gotmNominations: number | undefined,
    @SlashOption({
      description: `Fixture NR-GOTM games (default ${SANDBOX_DEFAULT_NOMINATIONS})`,
      name: "nr-gotm-nominations",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: SANDBOX_MAX_NOMINATIONS,
    })
    nrGotmNominations: number | undefined,
    @SlashOption({
      description: "Copy this real round's nominations (read only) instead of fixtures",
      name: "source-round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
      minValue: 1,
    })
    sourceRound: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxStart(interaction, {
      roundNumber,
      cap,
      gotmNominations,
      nrGotmNominations,
      sourceRound,
    });
  }

  @Slash({ description: "Show the sandbox round, tallies and queued events", name: "status" })
  async status(interaction: CommandInteraction): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxStatus(interaction);
  }

  @Slash({ description: "Post a nomination reminder", name: "remind" })
  async remind(
    @SlashChoice({ name: "Five days out", value: "5d" }, { name: "One day out", value: "1d" })
    @SlashOption({
      description: "Which reminder",
      name: "which",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    which: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxRemind(interaction, which === "1d" ? "1d" : "5d");
  }

  @Slash({ description: "Open voting and post the sandbox panels", name: "open" })
  async open(interaction: CommandInteraction): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxOpen(interaction);
  }

  @Slash({ description: "Cast simulated votes that produce an outcome", name: "seed" })
  async seed(
    @SlashChoice(...OUTCOME_CHOICES)
    @SlashOption({
      description: "GOTM outcome",
      name: "gotm",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    gotm: string | undefined,
    @SlashChoice(...OUTCOME_CHOICES)
    @SlashOption({
      description: "NR-GOTM outcome",
      name: "nr-gotm",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nrGotm: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxSeed(interaction, {
      "gotm": toOutcome(gotm),
      "nr-gotm": toOutcome(nrGotm),
    });
  }

  @Slash({ description: "Close voting and decide the sandbox round", name: "close" })
  async close(interaction: CommandInteraction): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxClose(interaction);
  }

  @Slash({ description: "Fire one voting event by hand, whatever the phase", name: "event" })
  async event(
    @SlashChoice(...EVENT_CHOICES)
    @SlashOption({
      description: "Event kind",
      name: "kind",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    kind: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxEvent(
      interaction,
      EVENT_CHOICES.find((entry) => entry.value === kind)?.value ?? null,
    );
  }

  @Slash({ description: "Retry sandbox events that failed to post", name: "deliver" })
  async deliver(interaction: CommandInteraction): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxDeliver(interaction);
  }

  @Slash({ description: "End your sandbox; its panels stop taking votes", name: "end" })
  async end(interaction: CommandInteraction): Promise<void> {
    if (!(await beginAdminStep(interaction))) return;
    await handleSandboxEnd(interaction);
  }

  @SelectMenuComponent({ id: /^vsbx-cast:\d+:[0-9a-f]+:\d+:(gotm|nr-gotm):\d+$/ })
  async handleCast(interaction: StringSelectMenuInteraction): Promise<void> {
    const panel = resolvePanel(interaction.customId);
    await respondVoteCast(interaction, panel.target, createSandboxDataSource(panel.sandbox));
  }

  @ButtonComponent({ id: /^vsbx-mine:\d+:[0-9a-f]+:\d+:(gotm|nr-gotm)$/ })
  async handleMine(interaction: ButtonInteraction): Promise<void> {
    const panel = resolvePanel(interaction.customId);
    await respondVoteMine(interaction, panel.target, createSandboxDataSource(panel.sandbox));
  }

  @ButtonComponent({ id: /^vsbx-tally:\d+:[0-9a-f]+:\d+:(gotm|nr-gotm)$/ })
  async handleTally(interaction: ButtonInteraction): Promise<void> {
    const panel = resolvePanel(interaction.customId);
    await respondVoteTally(interaction, panel.target, createSandboxDataSource(panel.sandbox));
  }

  @SelectMenuComponent({ id: /^vsbx-tie:\d+:[0-9a-f]+:\d+:(gotm|nr_gotm)$/ })
  async handleTie(interaction: StringSelectMenuInteraction): Promise<void> {
    if (!(await isAdmin(interaction))) return;
    const parsed = parseSandboxCustomId(interaction.customId);
    const category = parsed?.rest[0] ?? "";
    if (!parsed || !isVotingRoundCategory(category)) {
      await handleTieBreakSelect(interaction, null);
      return;
    }
    await handleTieBreakSelect(
      interaction,
      { roundNumber: parsed.roundNumber, category },
      createSandboxDataSource(parsed),
    );
    // Breaking the last tie queues round_decided, as the API would. The prompt
    // is already answered, so a failure here is logged and left queued.
    try {
      await deliverSandboxOutbox(interaction.client, parsed.ownerId);
    } catch (err) {
      logError("VoteSandbox.handleTie.deliver", err);
    }
  }
}
