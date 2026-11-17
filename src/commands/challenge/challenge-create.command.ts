import {
  ApplicationCommandOptionType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferModalSubmit,
  safeDeferReply,
  safeDeferUpdate,
  safeEditReply,
  safeFollowUpIfSettled,
  type AnyRepliable,
} from "../../functions/InteractionUtils.js";
import {
  parseChallengeEditId,
  parseChallengeWizardId,
} from "../../functions/ChallengeCustomIds.js";
import {
  CHALLENGE_EDIT_PREFIX,
  CHALLENGE_WIZARD_PREFIX,
} from "../../config/customIdPrefixes.js";
import { resolveSessionOrReply } from "../../functions/ResumableSessionReplies.js";
import {
  buildOwnedSessionId,
  createResumableSessionRegistry,
  parseOwnedSessionOwnerId,
} from "../../services/PersistedInteractionSessionStore.js";
import { CHALLENGE_API, type IChallenge } from "../../services/ChallengeApi.js";
import { challengeTextView, type IChallengeView } from "../../services/ChallengeBrowse.js";
import {
  buildDetailsModal,
  buildEditPanel,
  rulesLocked,
  runStaffAction,
  saveDetails,
  type StaffAction,
} from "../../services/ChallengeEdit.js";
import {
  applyBasics,
  applyExcludePick,
  applyIncludePick,
  applyIncludeSearch,
  applySettings,
  applySourcePick,
  buildBasicsModal,
  buildIncludeModal,
  buildSettingsModal,
  challengeDraftFromState,
  draftFromChallenge,
  newChallengeDraft,
  renderWizardStep,
  saveChallengeDraft,
  WIZARD_CHECKBOX_FIELDS,
  WIZARD_FIELDS,
  WIZARD_RADIO_FIELDS,
  wizardClosedView,
  type IChallengeDraft,
} from "../../services/ChallengeWizard.js";
import { buildApiErrorMessage } from "../../utilities/ApiErrorUtils.js";
import { safeIgnore } from "../../utilities/AsyncUtils.js";
import { logError } from "../../utilities/LogUtils.js";
import {
  autocompleteChallenge,
  canModerate,
  challengeErrorReply,
  parseChallengeOption,
  readModalFields,
  searchIncludeGames,
} from "./challenge-interaction.utils.js";

// /challenge create and /challenge edit (spec api#376), and every step of their wizard.
// The wizard's draft rides on a resumable session, so each step works after a restart.

const WIZARD_SESSION_PREFIX = "chw";
const WIZARD_EXPIRED = "This Challenge form has expired. Run `/challenge create` again.";
const LOG_CONTEXT = "ChallengeCreateCommand";

const wizardSessions = new Map<string, IChallengeDraft>();

const wizardRegistry = createResumableSessionRegistry<IChallengeDraft>({
  kind: "challenge-wizard",
  sessions: wizardSessions,
  fromState: (state) => challengeDraftFromState(state),
});

/** The last Challenge each edit panel showed, so its modal can open at once. */
const editPanelChallenges = new Map<number, IChallenge>();

type WizardInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

function location(interaction: AnyRepliable): { channelId: string | null; guildId: string | null } {
  return { channelId: interaction.channelId, guildId: interaction.guildId };
}

function startWizard(interaction: AnyRepliable, draft: IChallengeDraft): string {
  const sessionId = buildOwnedSessionId(WIZARD_SESSION_PREFIX, interaction.user.id);
  wizardRegistry.create({
    sessionId,
    session: draft,
    ownerId: interaction.user.id,
    location: location(interaction),
    state: draft,
  });
  return sessionId;
}

function saveDraft(interaction: AnyRepliable, sessionId: string, draft: IChallengeDraft): void {
  wizardRegistry.setInMemory(sessionId, draft);
  wizardRegistry.persist({
    sessionId,
    ownerId: draft.ownerId,
    location: location(interaction),
    state: draft,
  });
}

function wizardTarget(
  interaction: WizardInteraction,
): { action: string; sessionId: string; ownerId: string } | null {
  const parsed = parseChallengeWizardId(interaction.customId);
  const ownerId = parsed
    ? parseOwnedSessionOwnerId(WIZARD_SESSION_PREFIX, parsed.sessionId)
    : null;
  return parsed && ownerId ? { ...parsed, ownerId } : null;
}

function resolveDraft(
  interaction: WizardInteraction,
  sessionId: string,
  ownerId: string,
): Promise<IChallengeDraft | undefined> {
  return resolveSessionOrReply(
    wizardRegistry,
    interaction,
    sessionId,
    { ownerId, channelId: interaction.channelId },
    {
      expired: WIZARD_EXPIRED,
      restoreFailed: "Could not restore this Challenge form.",
      logContext: `${LOG_CONTEXT}.restore`,
    },
  );
}

/** Puts the draft's step in the acked message, or the API error behind it. */
async function showStep(
  interaction: AnyRepliable,
  sessionId: string,
  draft: IChallengeDraft,
  notice: readonly string[] = [],
): Promise<void> {
  try {
    const view = await renderWizardStep(sessionId, draft, CHALLENGE_API, notice);
    await safeEditReply(interaction, view);
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.showStep`, err);
    await safeFollowUpIfSettled(interaction, challengeErrorReply(
      buildApiErrorMessage("Could not preview the Pool.", err),
      true,
    ));
  }
}

/**
 * A button that opens a modal must answer with it at once, so it needs the draft in
 * memory. After a restart it is not: restore it, show the step again, and the next click
 * opens the modal.
 */
async function openWizardModal(
  interaction: ButtonInteraction,
  build: (sessionId: string, draft: IChallengeDraft) => ReturnType<typeof buildBasicsModal>,
): Promise<void> {
  const target = wizardTarget(interaction);
  const draft = target ? wizardRegistry.get(target.sessionId) : undefined;
  if (target && draft) {
    safeIgnore(interaction.showModal(build(target.sessionId, draft)));
    return;
  }
  if (!(await safeDeferUpdate(interaction))) return;
  if (!target) {
    await safeEditReply(interaction, wizardClosedView(WIZARD_EXPIRED));
    return;
  }
  const restored = await resolveDraft(interaction, target.sessionId, target.ownerId);
  if (restored) await showStep(interaction, target.sessionId, restored);
}

/** Acks a wizard component or modal and hands its draft to `step`. */
async function withDraft(
  interaction: WizardInteraction,
  step: (sessionId: string, draft: IChallengeDraft) => Promise<void>,
): Promise<void> {
  const acked = interaction.isModalSubmit()
    ? await safeDeferModalSubmit(interaction)
    : await safeDeferUpdate(interaction);
  if (!acked) return;
  const target = wizardTarget(interaction);
  if (!target) {
    await safeEditReply(interaction, wizardClosedView(WIZARD_EXPIRED));
    return;
  }
  const draft = await resolveDraft(interaction, target.sessionId, target.ownerId);
  if (!draft) return;
  try {
    await step(target.sessionId, draft);
  } catch (err: unknown) {
    logError(`${LOG_CONTEXT}.step`, err);
    await safeFollowUpIfSettled(interaction, challengeErrorReply(
      buildApiErrorMessage("Could not continue the Challenge form.", err),
      true,
    ));
  }
}

async function readEditChallenge(
  interaction: AnyRepliable,
  challengeId: number,
): Promise<IChallenge | null> {
  const challenge = await CHALLENGE_API.getChallenge(challengeId, interaction.user.id);
  if (challenge) editPanelChallenges.set(challenge.id, challenge);
  return challenge;
}

function editPanel(
  interaction: AnyRepliable,
  challenge: IChallenge,
  notice?: string,
): IChallengeView {
  editPanelChallenges.set(challenge.id, challenge);
  return buildEditPanel(challenge, { canModerate: canModerate(interaction), notice });
}

function missingChallenge(challengeId: number): IChallengeView {
  return challengeTextView(
    `There is no Challenge ${challengeId}, or it is hidden from you.`,
  );
}

@Discord()
@SlashGroup({ name: "challenge", description: "Club Challenges: create, browse and take part" })
@SlashGroup("challenge")
export class ChallengeCreateCommand {
  @Slash({ name: "create", description: "Create a Challenge for the club" })
  async create(
    @SlashOption({
      name: "club-hosted",
      description: "Host it in the club's name (Moderators and above)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clubHosted: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const draft = newChallengeDraft(interaction.user.id, clubHosted ?? false);
    const sessionId = startWizard(interaction, draft);
    safeIgnore(interaction.showModal(buildBasicsModal(sessionId, draft)));
  }

  @Slash({ name: "edit", description: "Edit a Challenge you host (staff: any Challenge)" })
  async edit(
    @SlashOption({
      name: "challenge",
      description: "The Challenge",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteChallenge,
    })
    challengeRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const challengeId = parseChallengeOption(challengeRaw);
    if (!challengeId) {
      await safeEditReply(interaction, challengeTextView("Pick a Challenge from the list."));
      return;
    }
    try {
      const challenge = await readEditChallenge(interaction, challengeId);
      await safeEditReply(
        interaction,
        challenge ? editPanel(interaction, challenge) : missingChallenge(challengeId),
      );
    } catch (err: unknown) {
      logError(`${LOG_CONTEXT}.edit`, err);
      await safeEditReply(interaction, challengeErrorReply(
        buildApiErrorMessage("Could not read the Challenge.", err),
      ));
    }
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:basics:`) })
  async basicsButton(interaction: ButtonInteraction): Promise<void> {
    await openWizardModal(interaction, buildBasicsModal);
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:settings:`) })
  async settingsButton(interaction: ButtonInteraction): Promise<void> {
    await openWizardModal(interaction, buildSettingsModal);
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:include:`) })
  async includeButton(interaction: ButtonInteraction): Promise<void> {
    await openWizardModal(interaction, (sessionId) => buildIncludeModal(sessionId));
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:basics-modal:`) })
  async basicsModal(interaction: ModalSubmitInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const result = applyBasics(
        draft,
        readModalFields(interaction, WIZARD_RADIO_FIELDS, WIZARD_CHECKBOX_FIELDS),
      );
      saveDraft(interaction, sessionId, result.draft);
      await showStep(interaction, sessionId, result.draft, result.errors);
    });
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:settings-modal:`) })
  async settingsModal(interaction: ModalSubmitInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const result = await applySettings(
        draft,
        readModalFields(interaction, WIZARD_RADIO_FIELDS),
        CHALLENGE_API,
      );
      saveDraft(interaction, sessionId, result.draft);
      await showStep(interaction, sessionId, result.draft, result.errors);
    });
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:include-modal:`) })
  async includeModal(interaction: ModalSubmitInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const query = readModalFields(interaction)[WIZARD_FIELDS.includeQuery] ?? "";
      const next = await applyIncludeSearch(draft, query, searchIncludeGames);
      saveDraft(interaction, sessionId, next);
      const notice = next.includeChoices.length
        ? []
        : [`No GameDB game matches "${query.trim()}".`];
      await showStep(interaction, sessionId, next, notice);
    });
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:sources:`) })
  async sourcesSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const next = applySourcePick(draft, interaction.values);
      saveDraft(interaction, sessionId, next);
      await showStep(interaction, sessionId, next);
    });
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:exclude:`) })
  async excludeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const shown = interaction.component.options.map((option) => ({
        id: Number(option.value),
        title: option.label,
      }));
      const next = applyExcludePick(draft, shown, interaction.values);
      saveDraft(interaction, sessionId, next);
      await showStep(interaction, sessionId, next);
    });
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:include-pick:`) })
  async includePick(interaction: StringSelectMenuInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const next = applyIncludePick(draft, interaction.values[0] ?? "");
      saveDraft(interaction, sessionId, next);
      await showStep(interaction, sessionId, next);
    });
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:preview:`) })
  async previewButton(interaction: ButtonInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      const next: IChallengeDraft = { ...draft, step: "preview", previewPage: 1 };
      saveDraft(interaction, sessionId, next);
      await showStep(interaction, sessionId, next);
    });
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:page-(prev|next):`) })
  async pageButton(interaction: ButtonInteraction): Promise<void> {
    const step = interaction.customId.includes(":page-next:") ? 1 : -1;
    await withDraft(interaction, async (sessionId, draft) => {
      const next = { ...draft, previewPage: Math.max(1, draft.previewPage + step) };
      saveDraft(interaction, sessionId, next);
      await showStep(interaction, sessionId, next);
    });
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:cancel:`) })
  async cancelButton(interaction: ButtonInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId) => {
      wizardRegistry.finish(sessionId);
      await safeEditReply(interaction, wizardClosedView("Cancelled. Nothing was saved."));
    });
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_WIZARD_PREFIX}:save:`) })
  async saveButton(interaction: ButtonInteraction): Promise<void> {
    await withDraft(interaction, async (sessionId, draft) => {
      // A double click saves once.
      if (!wizardRegistry.claim(sessionId)) return;
      const result = await saveChallengeDraft(draft, interaction.user.id, CHALLENGE_API);
      wizardRegistry.finish(sessionId);
      if (result.saved) {
        await safeEditReply(interaction, result.view);
        return;
      }
      // Refused: the form stays, under a fresh session, to change and try again.
      const retryId = startWizard(interaction, draft);
      await showStep(interaction, retryId, draft);
      await safeFollowUpIfSettled(interaction, { ...result.view, flags: result.view.flags |
        MessageFlags.Ephemeral });
    });
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_EDIT_PREFIX}:details:`) })
  async detailsButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeEditId(interaction.customId);
    const challenge = target ? editPanelChallenges.get(target.challengeId) : undefined;
    if (challenge) {
      safeIgnore(interaction.showModal(buildDetailsModal(challenge)));
      return;
    }
    // After a restart: read the Challenge, then the next click opens the form.
    if (!(await safeDeferUpdate(interaction)) || !target) return;
    await this.refreshPanel(interaction, target.challengeId, "Ready: open the form again.");
  }

  @ModalComponent({ id: new RegExp(`^${CHALLENGE_EDIT_PREFIX}:details-modal:`) })
  async detailsModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!(await safeDeferModalSubmit(interaction))) return;
    const target = parseChallengeEditId(interaction.customId);
    if (!target) return;
    try {
      const challenge = await readEditChallenge(interaction, target.challengeId);
      if (!challenge) {
        await safeEditReply(interaction, missingChallenge(target.challengeId));
        return;
      }
      const result = await saveDetails(
        challenge,
        readModalFields(interaction),
        interaction.user.id,
        CHALLENGE_API,
      );
      if (result.error || !result.challenge) {
        await safeFollowUpIfSettled(interaction, challengeErrorReply(result.error ?? "", true));
        return;
      }
      await safeEditReply(interaction, editPanel(interaction, result.challenge, "Saved."));
    } catch (err: unknown) {
      logError(`${LOG_CONTEXT}.details`, err);
      await safeFollowUpIfSettled(interaction, challengeErrorReply(
        buildApiErrorMessage("Could not save the Challenge.", err),
        true,
      ));
    }
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_EDIT_PREFIX}:rules:`) })
  async rulesButton(interaction: ButtonInteraction): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const target = parseChallengeEditId(interaction.customId);
    if (!target) return;
    try {
      const challenge = await readEditChallenge(interaction, target.challengeId);
      if (!challenge) {
        await safeEditReply(interaction, missingChallenge(target.challengeId));
        return;
      }
      if (rulesLocked(challenge)) {
        await safeEditReply(interaction, editPanel(interaction, challenge));
        return;
      }
      const draft = draftFromChallenge(challenge, interaction.user.id);
      await showStep(interaction, startWizard(interaction, draft), draft);
    } catch (err: unknown) {
      logError(`${LOG_CONTEXT}.rules`, err);
      await safeFollowUpIfSettled(interaction, challengeErrorReply(
        buildApiErrorMessage("Could not read the Challenge.", err),
        true,
      ));
    }
  }

  @ButtonComponent({ id: new RegExp(`^${CHALLENGE_EDIT_PREFIX}:(hide|unhide|host-club):`) })
  async staffButton(interaction: ButtonInteraction): Promise<void> {
    const target = parseChallengeEditId(interaction.customId);
    if (!target || target.action === "host") return;
    const action = target.action as "hide" | "unhide" | "host-club";
    await this.runStaff(interaction, { action, challengeId: target.challengeId });
  }

  @SelectMenuComponent({ id: new RegExp(`^${CHALLENGE_EDIT_PREFIX}:host:`) })
  async hostSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const target = parseChallengeEditId(interaction.customId);
    const hostUserId = interaction.values[0];
    if (!target || !hostUserId) return;
    await this.runStaff(interaction, { action: "host", challengeId: target.challengeId, hostUserId });
  }

  private async runStaff(
    interaction: ButtonInteraction | UserSelectMenuInteraction,
    input: StaffAction,
  ): Promise<void> {
    if (!(await safeDeferUpdate(interaction))) return;
    const result = await runStaffAction(input, interaction.user.id, CHALLENGE_API);
    if ("error" in result) {
      await safeFollowUpIfSettled(interaction, challengeErrorReply(result.error, true));
      return;
    }
    await this.refreshPanel(interaction, input.challengeId, result.notice);
  }

  /** Re-reads the Challenge (with its Run count) and shows the panel again. */
  private async refreshPanel(
    interaction: AnyRepliable,
    challengeId: number,
    notice?: string,
  ): Promise<void> {
    try {
      const challenge = await readEditChallenge(interaction, challengeId);
      await safeEditReply(
        interaction,
        challenge ? editPanel(interaction, challenge, notice) : missingChallenge(challengeId),
      );
    } catch (err: unknown) {
      logError(`${LOG_CONTEXT}.refreshPanel`, err);
      await safeFollowUpIfSettled(interaction, challengeErrorReply(
        buildApiErrorMessage("Could not read the Challenge.", err),
        true,
      ));
    }
  }
}
