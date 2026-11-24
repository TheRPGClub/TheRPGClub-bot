import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { ButtonStyle, MessageFlags, TextInputStyle } from "discord-api-types/v10";
import { buildDivider, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_INKS,
  escapeChallengeText,
  memberName,
} from "../functions/ChallengeCopy.js";
import {
  buildChallengeProposalId,
  type ChallengeProposalAction,
} from "../functions/ChallengeCustomIds.js";
import { challengePageUrl, gamePageUrl } from "../config/website.js";
import {
  DISCORD_BUTTON_LABEL_MAX,
  DISCORD_SELECT_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
} from "../config/textLimits.js";
import { plural } from "../utilities/TextUtils.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type IChallenge,
  type IChallengeApi,
} from "./ChallengeApi.js";
import {
  CHALLENGE_PROPOSAL_API,
  type IChallengeProposalApi,
  type IPoolProposal,
  type ListNoticeResolution,
  type ProposalDecision,
} from "./ChallengeProposalApi.js";
import { GAME_LIST_API, type IGameListApi } from "./GameListApi.js";
import type { IChallengeView } from "./ChallengeBrowse.js";

// Pool Proposals in /challenge (spec api#442, bot#1569), design 2B "One proposal at a time":
// a member proposes a game (with an optional note) with /challenge propose or the Pool's
// Propose a game button; the Host (staff for a club-hosted Challenge) steps through the
// pending ones, oldest first, each a card with its cover, who proposed it, and what Core and
// Optional mean, and accepts it as either or declines it. Accepting with a linked Game List
// the decider may add to asks whether to add the game to the list too. List notices (a
// Core Game that left the linked list) show on /challenge show with Remove and Keep. The
// API decides who may do what; every refusal is shown as it words it.

export interface IChallengeProposalDeps {
  api?: IChallengeProposalApi;
  challenges?: Pick<IChallengeApi, "getChallenge">;
  lists?: Pick<IGameListApi, "addGame">;
}

/** What an action shows: the view to put in place, and a refusal to send on its own. */
export interface IProposalResult {
  view: IChallengeView;
  error?: string;
}

/** List notices shown on /challenge show; the rest are counted. */
export const LIST_NOTICES_SHOWN = 3;
/** The proposal note's limit, as the API takes it. */
export const PROPOSAL_NOTE_MAX = 280;
/** The modals' input IDs. */
export const PROPOSAL_FIELDS = { query: "proposal-query", note: "proposal-note" } as const;

type Row = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

function view(container: ContainerBuilder, rows: Row[] = []): IChallengeView {
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function textView(content: string, rows: Row[] = []): IChallengeView {
  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS.pool)
    .addTextDisplayComponents(buildTextDisplay(content));
  return view(container, rows);
}

function proposalButton(
  action: ChallengeProposalAction,
  ids: number[],
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeProposalId({ action, ids, reply: "update" }))
    .setLabel(label.slice(0, DISCORD_BUTTON_LABEL_MAX))
    .setStyle(style)
    .setDisabled(disabled);
}

function linkButton(label: string, url: string): ButtonBuilder {
  return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
}

function buttonRow(...buttons: ButtonBuilder[]): Row {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function bold(text: string): string {
  return `**${escapeChallengeText(text)}**`;
}

function missingChallenge(challengeId: number): IChallengeView {
  return textView(`There is no Challenge ${challengeId}, or it is hidden from you.`);
}

const NOT_POOL = "Only a Pool Challenge takes Pool Proposals.";

/** Who decides a Challenge's proposals, in words: "Rowan", "the club's staff". */
function deciderName(challenge: IChallenge): string {
  if (challenge.hosted_by_club || !challenge.host) return "the club's staff";
  return escapeChallengeText(memberName(challenge.host));
}

/** Whether the reader decides this Pool's proposals: the API counts them only for them. */
export function decidesProposals(challenge: IChallenge): boolean {
  return typeof challenge.pending_proposals === "number";
}

/** "Core Game", "Optional Game", with the article. */
function asWords(as: ProposalDecision): string {
  return as === "core" ? "a Core Game" : "an Optional Game";
}

/** A Discord timestamp that reads "3 hours ago". */
function ago(iso: string): string {
  const seconds = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(seconds) ? ` · <t:${seconds}:R>` : "";
}

function noteQuote(note: string | null | undefined): string[] {
  const text = note?.trim();
  return text ? text.split("\n").map((line) => `> ${escapeChallengeText(line)}`) : [];
}

function isLeftOut(challenge: IChallenge, gameId: number): boolean {
  return (challenge.pool?.excluded_games ?? []).some((game) => game.game_id === gameId);
}

/**
 * /challenge propose, and the Propose a game note's submit: sends the proposal and says who
 * decides. A refusal (already in the Pool, already proposed) comes back as the API words it.
 */
export async function proposeReply(
  input: { challengeId: number; gameId: number; note: string | null; actingUserId: string },
  deps: IChallengeProposalDeps = {},
): Promise<IProposalResult> {
  const challenges = deps.challenges ?? CHALLENGE_API;
  const api = deps.api ?? CHALLENGE_PROPOSAL_API;
  const challenge = await challenges.getChallenge(input.challengeId, input.actingUserId);
  if (!challenge) return { view: missingChallenge(input.challengeId) };
  if (challenge.challenge_format !== "pool") return { view: textView(NOT_POOL) };
  const note = input.note?.trim().slice(0, PROPOSAL_NOTE_MAX) || null;
  let proposal: IPoolProposal;
  try {
    proposal = await api.propose(challenge.id, input.gameId, note, input.actingUserId);
  } catch (err: unknown) {
    return {
      view: textView("Your proposal was not sent."),
      error: challengeRefusalText(err, "Could not send the proposal."),
    };
  }
  const lines = [
    `Proposed ${bold(proposal.game.title)} for ${bold(challenge.name)}.`,
    `It's with ${deciderName(challenge)} now. You'll get a DM if it's accepted.`,
  ];
  return { view: textView(lines.join("\n")) };
}

/** The search modal behind the Pool's Propose a game button. */
export function buildProposeSearchModal(challengeId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildChallengeProposalId({ action: "search-modal", ids: [challengeId] }))
    .setTitle("Propose a game")
    .addLabelComponents(new LabelBuilder()
      .setLabel("Game")
      .setDescription("Its title in the GameDB")
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId(PROPOSAL_FIELDS.query)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true)));
}

/** The note modal that sends the proposal of the game picked from the search. */
export function buildProposeNoteModal(challengeId: number, gameId: number, title: string):
  ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildChallengeProposalId({ action: "note-modal", ids: [challengeId, gameId] }))
    .setTitle(`Propose ${title}`.slice(0, 45))
    .addLabelComponents(new LabelBuilder()
      .setLabel("Note (optional)")
      .setDescription("Why it belongs in the Pool, for whoever decides")
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId(PROPOSAL_FIELDS.note)
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(PROPOSAL_NOTE_MAX)
        .setRequired(false)));
}

/** A game the Propose a game search found. */
export interface IProposeChoice {
  id: number;
  title: string;
  year: number | null;
}

/** The games the search found, as a select; picking one opens the note modal. */
export function buildProposePickView(
  challengeId: number,
  query: string,
  choices: readonly IProposeChoice[],
): IChallengeView {
  if (!choices.length) {
    return textView(`No GameDB game matches "${escapeChallengeText(query.trim())}". ` +
      "Try Propose a game again with another title.");
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildChallengeProposalId({ action: "pick", ids: [challengeId] }))
    .setPlaceholder("Pick the game to propose")
    .addOptions(...choices.slice(0, DISCORD_SELECT_OPTIONS_MAX).map((choice) => ({
      label: (choice.year ? `${choice.title} (${choice.year})` : choice.title)
        .slice(0, DISCORD_SELECT_LABEL_MAX),
      value: String(choice.id),
    })));
  return textView(
    "Which game? You can add a note for whoever decides next.",
    [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  );
}

/** The card of one pending proposal (design 2B), with its decisions and paging. */
function proposalCard(
  challenge: IChallenge,
  proposal: IPoolProposal,
  position: number,
  count: number,
  notice: readonly string[],
): IChallengeView {
  const lines = [
    ...notice,
    ...(notice.length ? [""] : []),
    `-# Pool Proposal ${position} of ${count} · ${escapeChallengeText(challenge.name)}`,
    `### ${escapeChallengeText(proposal.game.title)}`,
    `from <@${proposal.proposer.user_id}>${ago(proposal.created_at)}`,
    ...noteQuote(proposal.note),
  ];
  if (isLeftOut(challenge, proposal.game.game_id)) {
    lines.push("You left this game out. Accepting puts it back in.");
  }
  const text = buildTextDisplay(lines.join("\n"));
  const container = new ContainerBuilder().setAccentColor(CHALLENGE_FORMAT_INKS.pool);
  if (proposal.game.cover_url) {
    const section = new SectionBuilder().addTextDisplayComponents(text);
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(proposal.game.cover_url));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(text);
  }
  container
    .addSeparatorComponents(buildDivider())
    .addTextDisplayComponents(buildTextDisplay(
      "-# Core: every Run must Clear it, and members with a Run get a DM. " +
        "Optional: it just joins the Pool.",
    ));
  const ids = [challenge.id, proposal.id, position];
  return view(container, [
    buttonRow(
      proposalButton("core", ids, "Accept as Core", ButtonStyle.Success),
      proposalButton("optional", ids, "Accept as Optional", ButtonStyle.Primary),
      proposalButton("decline", ids, "Decline", ButtonStyle.Danger),
    ),
    buttonRow(
      proposalButton("view", [challenge.id, Math.max(1, position - 1)], "Previous",
        ButtonStyle.Secondary, position <= 1),
      proposalButton("view", [challenge.id, Math.min(count, position + 1)], "Next",
        ButtonStyle.Secondary, position >= count),
      linkButton("Game page", gamePageUrl(proposal.game.game_id)),
    ),
  ]);
}

/** A member's own pending proposals, for someone who does not decide them. */
function ownProposalsView(challenge: IChallenge, pending: readonly IPoolProposal[]):
  IChallengeView {
  const name = bold(challenge.name);
  if (!pending.length) {
    return textView(`You have no Pool Proposals waiting for ${name}. ` +
      `Only ${deciderName(challenge)} can decide them.`);
  }
  const lines = [
    `### Your Pool Proposals for ${name}`,
    ...pending.map((p) => `- ${bold(p.game.title)}${ago(p.created_at)}`),
    `-# They're with ${deciderName(challenge)}. You'll get a DM when one is accepted.`,
  ];
  return textView(lines.join("\n"), [buttonRow(
    linkButton("Open the Challenge", challengePageUrl(challenge.id)),
  )]);
}

/**
 * /challenge proposals and its paging: the pending proposal at `position` (1-based, oldest
 * first) for whoever decides, or the member's own pending ones for anyone else. `notice`
 * lines (what the last decision did) lead it. API errors are thrown.
 */
export async function buildProposalsView(
  input: { challengeId: number; position: number; actingUserId: string; notice?: string[] },
  deps: IChallengeProposalDeps = {},
): Promise<IChallengeView> {
  const challenges = deps.challenges ?? CHALLENGE_API;
  const api = deps.api ?? CHALLENGE_PROPOSAL_API;
  const challenge = await challenges.getChallenge(input.challengeId, input.actingUserId);
  if (!challenge) return missingChallenge(input.challengeId);
  if (challenge.challenge_format !== "pool") return textView(NOT_POOL);
  const pending = await api.listProposals(challenge.id, input.actingUserId, "pending");
  if (!decidesProposals(challenge)) return ownProposalsView(challenge, pending);
  const notice = input.notice ?? [];
  if (!pending.length) {
    return textView([
      ...notice,
      ...(notice.length ? [""] : []),
      `No Pool Proposals are waiting for ${bold(challenge.name)}.`,
    ].join("\n"));
  }
  const position = Math.min(Math.max(1, input.position), pending.length);
  return proposalCard(challenge, pending[position - 1]!, position, pending.length, notice);
}

/** "Also add it to the list?" after an accept, when the decider may add to the list. */
function listPromptView(
  challenge: IChallenge,
  proposal: IPoolProposal,
  as: ProposalDecision,
  position: number,
): IChallengeView {
  const list = challenge.pool!.game_list!;
  const whose = challenge.hosted_by_club ? "The club's list" : "Your list";
  const lines = [
    `${bold(proposal.game.title)} is now ${asWords(as)}.`,
    `Add it to ${bold(list.name)} too?`,
    `-# ${whose} feeds this Challenge. Members who can see the list will see it there.`,
  ];
  return textView(lines.join("\n"), [
    buttonRow(proposalButton("list-add", [challenge.id, proposal.game.game_id, position],
      "Add to list", ButtonStyle.Primary)),
    buttonRow(proposalButton("list-skip", [challenge.id, position],
      "No, keep the list as it is")),
  ]);
}

/**
 * Accept as Core, Accept as Optional or Decline on a proposal card. After it: the list
 * prompt when the decider may add to the linked list, else the proposal now at the same
 * place. A refusal (already decided, not allowed) comes back as the API words it, with the
 * pending proposals read again.
 */
export async function decideProposal(
  input: {
    challengeId: number;
    proposalId: number;
    decision: ProposalDecision | "decline";
    position: number;
    actingUserId: string;
  },
  deps: IChallengeProposalDeps = {},
): Promise<IProposalResult> {
  const api = deps.api ?? CHALLENGE_PROPOSAL_API;
  const challenges = deps.challenges ?? CHALLENGE_API;
  const { challengeId, proposalId, decision, position, actingUserId } = input;
  const where = { challengeId, position, actingUserId };
  let decided: IPoolProposal;
  try {
    decided = decision === "decline"
      ? await api.decline(challengeId, proposalId, actingUserId)
      : await api.accept(challengeId, proposalId, decision, actingUserId);
  } catch (err: unknown) {
    return {
      view: await buildProposalsView({ challengeId, position, actingUserId }, deps),
      error: challengeRefusalText(err, "Could not decide the proposal."),
    };
  }
  if (decision === "decline") {
    const notice = [`Declined ${bold(decided.game.title)}.`];
    return { view: await buildProposalsView({ ...where, notice }, deps) };
  }
  const challenge = await challenges.getChallenge(challengeId, actingUserId);
  if (challenge?.pool?.game_list?.can_add) {
    return { view: listPromptView(challenge, decided, decision, position) };
  }
  const notice = [`${bold(decided.game.title)} is now ${asWords(decision)}.`];
  return { view: await buildProposalsView({ ...where, notice }, deps) };
}

/**
 * The list prompt's Add to list: adds the accepted game to the Challenge's linked list
 * (last), then goes on to the next proposal. A refusal (list full) is shown as worded.
 */
export async function addAcceptedToList(
  input: { challengeId: number; gameId: number; position: number; actingUserId: string },
  deps: IChallengeProposalDeps = {},
): Promise<IProposalResult> {
  const challenges = deps.challenges ?? CHALLENGE_API;
  const lists = deps.lists ?? GAME_LIST_API;
  const { challengeId, position, actingUserId } = input;
  const where = { challengeId, position, actingUserId };
  const challenge = await challenges.getChallenge(challengeId, actingUserId);
  const list = challenge?.pool?.game_list;
  if (!list) {
    const notice = ["This Challenge has no linked Game List any more, so nothing was added."];
    return { view: await buildProposalsView({ ...where, notice }, deps) };
  }
  try {
    const entry = await lists.addGame(list.id, input.gameId, actingUserId);
    const notice = [`Added ${bold(entry.game.title)} to ${bold(list.name)}.`];
    return { view: await buildProposalsView({ ...where, notice }, deps) };
  } catch (err: unknown) {
    return {
      view: await buildProposalsView({ challengeId, position, actingUserId }, deps),
      error: challengeRefusalText(err, "Could not add the game to the list."),
    };
  }
}

/**
 * The list notices on /challenge show, for whoever decides (design: Remove / Keep): each
 * Core Game that left the linked list, up to LIST_NOTICES_SHOWN, then a count.
 */
export function addListNotices(container: ContainerBuilder, challenge: IChallenge): void {
  const notices = challenge.list_notices ?? [];
  if (!notices.length) return;
  const list = challenge.pool?.game_list;
  const from = list ? bold(list.name) : "the linked list";
  container.addSeparatorComponents(buildDivider());
  for (const notice of notices.slice(0, LIST_NOTICES_SHOWN)) {
    container
      .addTextDisplayComponents(buildTextDisplay(
        `${bold(notice.game.title)} was removed from ${from}. It is still a Core Game here.`,
      ))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        proposalButton("notice-remove", [challenge.id, notice.id],
          "Remove from the Challenge", ButtonStyle.Danger),
        proposalButton("notice-keep", [challenge.id, notice.id], "Keep it"),
      ));
  }
  const more = notices.length - LIST_NOTICES_SHOWN;
  if (more > 0) {
    container.addTextDisplayComponents(buildTextDisplay(
      `-# ${plural(more, "more list notice")} on the Challenge page.`,
    ));
  }
}

/** The Pool's own buttons on /challenge show: Propose a game, and Proposals for deciders. */
export function poolProposalButtons(challenge: IChallenge): ButtonBuilder[] {
  if (challenge.challenge_format !== "pool") return [];
  const buttons = [proposalButton("propose", [challenge.id], "Propose a game")];
  if (decidesProposals(challenge)) {
    const waiting = challenge.pending_proposals ?? 0;
    buttons.push(proposalButton("view", [challenge.id, 1], `Proposals (${waiting})`,
      waiting ? ButtonStyle.Primary : ButtonStyle.Secondary));
  }
  return buttons;
}

/**
 * A list notice's Remove (the game leaves the Pool) or Keep. Returns what happened, or the
 * refusal as the API words it.
 */
export async function resolveListNotice(
  input: {
    challengeId: number;
    noticeId: number;
    resolution: ListNoticeResolution;
    actingUserId: string;
  },
  deps: IChallengeProposalDeps = {},
): Promise<{ notice: string } | { error: string }> {
  const api = deps.api ?? CHALLENGE_PROPOSAL_API;
  const challenges = deps.challenges ?? CHALLENGE_API;
  try {
    const before = await challenges.getChallenge(input.challengeId, input.actingUserId);
    const game = before?.list_notices?.find((n) => n.id === input.noticeId)?.game;
    const title = game ? bold(game.title) : "The game";
    await api.resolveListNotice(input.challengeId, input.noticeId, input.resolution,
      input.actingUserId);
    return {
      notice: input.resolution === "remove"
        ? `${title} left the Pool.`
        : `${title} stays a Core Game.`,
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not clear the list notice.") };
  }
}
