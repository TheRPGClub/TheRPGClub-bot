import {
  ActionRowBuilder,
  ContainerBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  type Client,
  type TextBasedChannel,
  userMention,
} from "discord.js";
import {
  GOTM_NOMINATION_CHANNEL_ID,
  NR_GOTM_NOMINATION_CHANNEL_ID,
} from "../config/nominationChannels.js";
import {
  listNominationsForRound,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import {
  buildTextContainer,
  safeV2TextContent,
} from "./ComponentsV2Utils.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { buildTextInputLabel , buildSelectRow } from "./uiComponents.js";
import {
  buildNominationListPayload,
  type NominationListPayload,
} from "./NominationListComponents.js";
import { buildComponentsV2Flags } from "./ComponentsV2Utils.js";
import {
  getUpcomingNominationWindow,
} from "./NominationWindow.js";
import { logError } from "../utilities/LogUtils.js";

export const ADMIN_NOMINATION_DELETE_SELECT_PREFIX = "admin-nom-del-select";
export const ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX = "admin-nom-del-reason";
export const ADMIN_NOMINATION_DELETE_REASON_INPUT_ID = "admin-nom-del-reason-input";

type PendingDeleteSelectionState = {
  kind: NominationKind;
  round: number;
  userId: string;
  gameTitle: string;
};

export async function buildNominationDeleteView(
  kind: NominationKind,
  commandLabel: string,
): Promise<{
  payload: NominationListPayload;
  controls: ActionRowBuilder<StringSelectMenuBuilder>[];
} | null> {
  const window = await getUpcomingNominationWindow();
  const nominations = await listNominationsForRound(kind, window.targetRound);
  if (!nominations.length) return null;

  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    commandLabel,
    window,
    nominations,
    false,
    { includeDetailSelect: false },
  );
  const controls = buildDeletionSelectControls(kind, window.targetRound, nominations);
  return { payload, controls };
}

export function buildDeletionSelectControls(
  kind: NominationKind,
  round: number,
  nominations: INominationEntry[],
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = nominations.map((nomination, index) => ({
    label: truncateLabel(nomination.gameTitle, 100),
    value: nomination.userId,
    description: `Nomination ${index + 1}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildDeletionSelectCustomId(kind, round))
    .setPlaceholder("Choose a nomination to delete")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [buildSelectRow(select)];
}

export function buildDeletionSelectCustomId(kind: NominationKind, round: number): string {
  return `${ADMIN_NOMINATION_DELETE_SELECT_PREFIX}:${kind}:${round}`;
}

export function buildDeletionReasonModalCustomId(
  kind: NominationKind, round: number, userId: string,
): string {
  return buildDeletionReasonStateId(kind, round, userId);
}

export function buildDeletionReasonModal(
  kind: NominationKind,
  round: number,
  userId: string,
  gameTitle: string,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildDeletionReasonModalCustomId(kind, round, userId))
    .setTitle("Delete nomination")
    .addLabelComponents(buildTextInputLabel({
      customId: ADMIN_NOMINATION_DELETE_REASON_INPUT_ID,
      label: "Deletion reason",
      style: TextInputStyle.Paragraph,
      maxLength: 250,
      placeholder: `Why should "${truncateLabel(gameTitle, 80)}" be removed?`,
    }));
}

export function buildDeletionReasonState(
  kind: NominationKind,
  round: number,
  userId: string,
  gameTitle: string,
): PendingDeleteSelectionState {
  return {
    kind,
    round,
    userId,
    gameTitle,
  };
}

/**
 * Posts a nomination change notice and the list to the GOTM or NR-GOTM nomination channel.
 * Throws the discord.js error, or when the channel can't hold messages, so a bot job acks
 * failed. Slash commands use announceNominationChange, which logs instead.
 */
export async function postNominationChange(
  kind: NominationKind,
  client: Client,
  content: string,
  payload: NominationListPayload,
): Promise<void> {
  const channelId =
    kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId);
  const textChannel: TextBasedChannel | null = channel?.isTextBased()
    ? (channel as TextBasedChannel)
    : null;
  if (!textChannel || !isSendableTextChannel(textChannel)) {
    throw new Error(`Nomination channel ${channelId} is missing or the bot cannot post in it.`);
  }
  await textChannel.send({
    components: [buildNominationNoticeContainer(content), ...payload.components],
    files: payload.files,
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
}

export async function announceNominationChange(
  kind: NominationKind,
  interaction: { client: Client },
  content: string,
  payload: NominationListPayload,
): Promise<void> {
  try {
    await postNominationChange(kind, interaction.client, content, payload);
  } catch (err) {
    logError("NominationAdminHelpers.announceChange", err);
  }
}

/** The round's current nominations as the public list, for a change notice. */
export async function buildRefreshedNominationList(
  kind: NominationKind,
  round: number,
): Promise<NominationListPayload> {
  const nominations = await listNominationsForRound(kind, round);
  const window = await getUpcomingNominationWindow();
  return buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/gotm nominate",
    { ...window, targetRound: round },
    nominations,
    false,
  );
}

/** "X deleted Y's nomination "Title" for GOTM Round N. Reason: ..." (title left out if none). */
export function buildNominationDeletedNotice(
  kind: NominationKind,
  round: number,
  deletedByUserId: string,
  nominatorUserId: string,
  gameTitle: string | null,
  reason: string,
): string {
  const game = gameTitle ? ` "${gameTitle}"` : "";
  return `${userMention(deletedByUserId)} deleted ${userMention(nominatorUserId)}'s ` +
    `nomination${game} for ${kind.toUpperCase()} Round ${round}. Reason: ${reason}`;
}

export function parseDeletionSelectCustomId(
  customId: string,
): { kind: NominationKind; round: number } | null {
  const match = customId.match(/^admin-nom-del-select:(gotm|nr-gotm):(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    kind: match[1] as NominationKind,
    round: Number(match[2]),
  };
}

export function parseDeletionReasonModalCustomId(customId: string): { sessionId: string } | null {
  const state = parseDeletionReasonStateId(customId);
  if (!state) {
    return null;
  }
  return { sessionId: customId };
}

export function parseDeletionReasonStateId(
  stateId: string,
): PendingDeleteSelectionState | null {
  const match = stateId.match(/^admin-nom-del-reason:(gotm|nr-gotm):(\d+):(\d+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    kind: match[1] as NominationKind,
    round: Number(match[2]),
    userId: match[3],
    gameTitle: "",
  };
}

function buildDeletionReasonStateId(kind: NominationKind, round: number, userId: string): string {
  return `${ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX}:${kind}:${round}:${userId}`;
}

function buildNominationNoticeContainer(content: string): ContainerBuilder {
  return buildTextContainer(safeV2TextContent(content, 3500));
}

function isSendableTextChannel(channel: TextBasedChannel | null): channel is TextBasedChannel & {
  send: (content: any) => Promise<any>;
} {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function truncateLabel(label: string, maxLength: number): string {
  return truncateWithEllipsis(label, maxLength);
}
