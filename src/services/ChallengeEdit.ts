import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  UserSelectMenuBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags, TextInputStyle } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_LABELS,
  describeScheduleShort,
  escapeChallengeText,
  formatChallengeDate,
  hostLabel,
  parseChallengeDate,
} from "../functions/ChallengeCopy.js";
import {
  buildChallengeEditId,
  type ChallengeEditAction,
} from "../functions/ChallengeCustomIds.js";
import type { IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type IChallenge,
  type IChallengeApi,
  type IChallengeWrite,
} from "./ChallengeApi.js";
import { plural } from "../utilities/TextUtils.js";

// /challenge edit (spec api#376): the edit panel, its name and description modal, and the
// staff controls (hide, unhide, change the Host). The rules open the create wizard in
// edit mode. The API decides who may do what; the panel only hides staff controls from
// members who could not use them.

export type IChallengeEditApi = Pick<
  IChallengeApi,
  "updateChallenge" | "setHidden" | "changeHost"
>;

export const EDIT_FIELDS = {
  name: "challenge-edit-name",
  description: "challenge-edit-description",
  endsOn: "challenge-edit-ends-on",
} as const;

const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;

/** True once the Challenge has any Run: its Format, schedule, Season and Pool are fixed. */
export function rulesLocked(challenge: IChallenge): boolean {
  return (challenge.run_count ?? 0) > 0;
}

/** Whether its end date may still change: Always Open and not yet Closed for good. */
function endDateEditable(challenge: IChallenge): boolean {
  return challenge.schedule === "always_open" && !challenge.ended_at &&
    challenge.challenge_format !== "assignment";
}

function button(
  action: ChallengeEditAction,
  challengeId: number,
  label: string,
  options: { style?: ButtonStyle; disabled?: boolean } = {},
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeEditId(action, challengeId))
    .setLabel(label)
    .setStyle(options.style ?? ButtonStyle.Secondary)
    .setDisabled(options.disabled ?? false);
}

function lockText(challenge: IChallenge): string[] {
  const lines: string[] = [];
  const runs = challenge.run_count ?? 0;
  if (rulesLocked(challenge)) {
    lines.push(
      `**The rules are locked:** this Challenge has ${plural(runs, "Run")}, ` +
        "so its Format, schedule, Season and Pool can't change. " +
        "Its name, description and end date still can.",
    );
  } else {
    lines.push("The rules can change until someone starts a Run.");
  }
  if (challenge.ended_at) {
    lines.push("It reached its end date and Closed for good, so its end date can't change.");
  }
  return lines;
}

/**
 * The /challenge edit panel: what can still change and the buttons to change it. Staff
 * (`canModerate`) also get hide or unhide and the Host controls. `notice` leads it.
 */
export function buildEditPanel(
  challenge: IChallenge,
  options: { canModerate: boolean; notice?: string },
): IChallengeView {
  const id = challenge.id;
  const summary = [
    CHALLENGE_FORMAT_LABELS[challenge.challenge_format],
    describeScheduleShort(challenge),
    `hosted by ${hostLabel(challenge)}`,
  ];
  if (challenge.hidden) summary.push("Hidden from members");
  const lines = [
    ...(options.notice ? [options.notice, ""] : []),
    `## Edit: ${escapeChallengeText(challenge.name)}`,
    `-# ${summary.join(" · ")}`,
    ...lockText(challenge),
  ];
  const container = new ContainerBuilder().addTextDisplayComponents(buildTextDisplay(lines.join("\n")));
  const rows: ActionRowBuilder<ButtonBuilder | UserSelectMenuBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("details", id, "Name and description", { style: ButtonStyle.Primary }),
      button("rules", id, "Rules", {
        disabled: rulesLocked(challenge),
      }),
    ),
  ];
  if (options.canModerate) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        challenge.hidden
          ? button("unhide", id, "Unhide")
          : button("hide", id, "Hide", { style: ButtonStyle.Danger }),
        button("host-club", id, "Hand to the club", { disabled: challenge.hosted_by_club }),
      ),
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(buildChallengeEditId("host", id))
          .setPlaceholder("Hand to another Host")
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
  }
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function textInput(
  id: string,
  label: string,
  options: { value?: string; style?: TextInputStyle; required?: boolean; maxLength?: number;
    placeholder?: string },
): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setRequired(options.required ?? true);
  if (options.value) input.setValue(options.value);
  if (options.maxLength) input.setMaxLength(options.maxLength);
  if (options.placeholder) input.setPlaceholder(options.placeholder);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

/** The name and description modal, with the end date while it may still change. */
export function buildDetailsModal(challenge: IChallenge): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildChallengeEditId("details-modal", challenge.id))
    .setTitle("Edit name and description")
    .addLabelComponents(
      textInput(EDIT_FIELDS.name, "Name", { value: challenge.name, maxLength: NAME_MAX }),
      textInput(EDIT_FIELDS.description, "Description", {
        value: challenge.description,
        style: TextInputStyle.Paragraph,
        maxLength: DESCRIPTION_MAX,
      }),
    );
  if (endDateEditable(challenge)) {
    modal.addLabelComponents(textInput(EDIT_FIELDS.endsOn, "End date", {
      value: challenge.ends_on ? formatChallengeDate(challenge.ends_on) : undefined,
      placeholder: "None, or a date such as 3 March 2027",
      required: false,
    }));
  }
  return modal;
}

/**
 * Saves the details modal: name, description, and the end date when it may change and the
 * form had it.
 * Returns the saved Challenge, or the error to show (a date it can't read, or the API's
 * refusal as given with the request and response).
 */
export async function saveDetails(
  challenge: IChallenge,
  fields: Readonly<Record<string, string | null | undefined>>,
  actingUserId: string,
  api: Pick<IChallengeEditApi, "updateChallenge"> = CHALLENGE_API,
): Promise<{ challenge?: IChallenge; error?: string }> {
  const write: IChallengeWrite = {
    name: (fields[EDIT_FIELDS.name] ?? "").trim().slice(0, NAME_MAX),
    description: (fields[EDIT_FIELDS.description] ?? "").trim().slice(0, DESCRIPTION_MAX),
  };
  // A form opened from a stale panel may lack the End date: only a form that showed it
  // sends it, so an absent field never clears the date.
  const endsOnField = fields[EDIT_FIELDS.endsOn];
  if (endDateEditable(challenge) && endsOnField !== undefined) {
    const typed = (endsOnField ?? "").trim();
    const endsOn = typed ? parseChallengeDate(typed) : null;
    if (typed && !endsOn) {
      return { error: `End date: "${typed}" is not a date, such as 3 March 2027.` };
    }
    write.ends_on = endsOn;
  }
  try {
    return { challenge: await api.updateChallenge(challenge.id, write, actingUserId) };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not save the Challenge.") };
  }
}

export type StaffAction =
  | { action: "hide" | "unhide" | "host-club"; challengeId: number }
  | { action: "host"; challengeId: number; hostUserId: string };

/**
 * Hide, unhide or change the Host for the acting member. The API refuses anyone below
 * Moderator; its message is shown as given, with the request and response.
 */
export async function runStaffAction(
  input: StaffAction,
  actingUserId: string,
  api: IChallengeEditApi = CHALLENGE_API,
): Promise<{ challenge: IChallenge; notice: string } | { error: string }> {
  try {
    switch (input.action) {
      case "hide":
        return {
          challenge: await api.setHidden(input.challengeId, true, actingUserId),
          notice: "Hidden: only staff and its Host can see it now.",
        };
      case "unhide":
        return {
          challenge: await api.setHidden(input.challengeId, false, actingUserId),
          notice: "Unhidden: every member can see it again.",
        };
      case "host":
        return {
          challenge: await api.changeHost(input.challengeId, input.hostUserId, actingUserId),
          notice: `<@${input.hostUserId}> is now the Host.`,
        };
      case "host-club":
        return {
          challenge: await api.changeHost(input.challengeId, null, actingUserId),
          notice: "The club is now the Host.",
        };
    }
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not change the Challenge.") };
  }
}
