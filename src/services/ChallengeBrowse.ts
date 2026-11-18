import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
} from "@discordjs/builders";
import {
  ButtonStyle,
  MessageFlags,
  SeparatorSpacingSize,
  type APIMessageTopLevelComponent,
} from "discord-api-types/v10";
import { buildTextContainer, buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import {
  CHALLENGE_FORMAT_LABELS,
  describeOpen,
  describePoolTarget,
  describeScheduleShort,
  escapeChallengeText,
  hostLabel,
  memberName,
} from "../functions/ChallengeCopy.js";
import { describeSlotsRange } from "../functions/ChallengeSlotsCopy.js";
import {
  buildChallengeListId,
  buildChallengeShowId,
  buildChallengeSlotsId,
  type ChallengeListFilter,
  type ChallengeShowView,
} from "../functions/ChallengeCustomIds.js";
import { CHALLENGE_LIST_PREFIX } from "../config/customIdPrefixes.js";
import { DISCORD_BUTTON_LABEL_MAX, DISCORD_SELECT_LABEL_MAX } from "../config/textLimits.js";
import { memberProfileUrl } from "../config/website.js";
import {
  CHALLENGE_API,
  type IChallenge,
  type IChallengeApi,
  type IChallengeRun,
  type RunStatus,
} from "./ChallengeApi.js";
import { plural } from "../utilities/TextUtils.js";

// /challenge list and /challenge show (spec api#376). Show is design 4D "Flip the view":
// a Pool by game (who Cleared what, the API's pool_progress) or by member (each Run's
// progress), one page at a time.

export type IChallengeBrowseApi = Pick<
  IChallengeApi,
  "getChallenge" | "listChallenges" | "listRuns" | "poolProgress"
>;

export interface IChallengeBrowseDeps {
  api?: IChallengeBrowseApi;
  now?: () => Date;
}

/** A private reply or update: Components V2, and mentions never ping. */
export interface IChallengeView {
  components: APIMessageTopLevelComponent[];
  flags: number;
  allowedMentions: { parse: [] };
}

/** Games or Runs on one page of /challenge show, and Challenges on one of /challenge list. */
export const CHALLENGE_PAGE_SIZE = 10;
/** Names listed on one game's line before "and N more". */
const NAMES_PER_LINE = 8;

export const CHALLENGE_LIST_SHOW_ID = `${CHALLENGE_LIST_PREFIX}:show`;

function view(
  container: ContainerBuilder,
  rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [],
): IChallengeView {
  return {
    components: [container.toJSON(), ...rows.map((row) => row.toJSON())],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/** A one-line private reply in the Challenge views' shape. */
export function challengeTextView(content: string): IChallengeView {
  return view(buildTextContainer(content));
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

function names(list: readonly string[]): string {
  const shown = list.slice(0, NAMES_PER_LINE).map(escapeChallengeText);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/** "Pool · 38 games · Clear 3 · Seasonal, 22 September to 21 December · Open, closes ..." */
function summaryLine(challenge: IChallenge, now: Date): string {
  const parts = [CHALLENGE_FORMAT_LABELS[challenge.challenge_format]];
  if (challenge.pool) {
    const count = challenge.pool.game_count;
    if (typeof count === "number") parts.push(`${plural(count, "game")}`);
    parts.push(describePoolTarget(challenge.pool));
  }
  if (challenge.slots) parts.push(describeSlotsRange(challenge.slots));
  parts.push(describeScheduleShort(challenge), describeOpen(challenge, now));
  return parts.join(" · ");
}

/**
 * The header: name and description, with the Host as a button linking to their profile
 * (a club-hosted Challenge says so in the subtext instead), then the summary.
 */
function addHeader(container: ContainerBuilder, challenge: IChallenge, now: Date): void {
  const heading = [`## ${escapeChallengeText(challenge.name)}`];
  if (challenge.description.trim()) heading.push(challenge.description.trim());
  const sub = [`-# ${summaryLine(challenge, now)}`];
  const host = challenge.hosted_by_club ? null : challenge.host;
  if (host) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(buildTextDisplay(heading.join("\n")));
    section.setButtonAccessory(new ButtonBuilder()
      .setURL(memberProfileUrl(host.user_id))
      .setLabel(memberName(host).slice(0, DISCORD_BUTTON_LABEL_MAX))
      .setStyle(ButtonStyle.Link));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(buildTextDisplay(heading.join("\n")));
    sub.push(`-# Hosted by ${hostLabel(challenge)}`);
  }
  if (challenge.hidden) sub.push("-# Hidden from members by a Moderator");
  container.addTextDisplayComponents(buildTextDisplay(sub.join("\n")));
}

function releaseYear(date: string | null | undefined): string | null {
  const year = date ? new Date(date).getUTCFullYear() : NaN;
  return Number.isFinite(year) ? String(year) : null;
}

function rangeLabel(page: number, shown: number, count: number): string {
  const from = (page - 1) * CHALLENGE_PAGE_SIZE + 1;
  return shown ? `${from} to ${from + shown - 1} of ${count}` : `0 of ${count}`;
}

async function byGameText(
  challenge: IChallenge,
  page: number,
  actingUserId: string,
  api: IChallengeBrowseApi,
): Promise<{ text: string; pages: number }> {
  // The API decides who counts: Cleared on a Run of any status, In Progress while the Run
  // still counts play, for this Season (or the last while Closed).
  const games = await api.poolProgress(challenge.id, actingUserId, page, CHALLENGE_PAGE_SIZE);
  const lines = [`### By game · ${rangeLabel(page, games.items.length, games.count)}`];
  for (const item of games.items) {
    const year = releaseYear(item.initial_release_date);
    const cleared = (item.cleared_by ?? []).map(memberName);
    const inProgress = (item.in_progress ?? []).map(memberName);
    const who = [`Cleared by ${cleared.length ? names(cleared) : "nobody yet"}`];
    if (inProgress.length) who.push(`In Progress: ${names(inProgress)}`);
    lines.push(
      `**${escapeChallengeText(item.title)}**${year ? ` \`${year}\`` : ""}`,
      `-# ${who.join(" · ")}`,
    );
  }
  if (!games.items.length) lines.push("No games on this page.");
  return { text: lines.join("\n"), pages: games.pages };
}

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  active: "Active",
  finished: "Finished",
  expired: "Expired",
  abandoned: "Abandoned",
};

/** "**tenpenny** · Active · 1 of 3 Cleared · 1 In Progress" */
export function runLine(run: IChallengeRun): string {
  const { cleared, in_progress: inProgress, target } = run.progress;
  const parts = [
    `**${escapeChallengeText(memberName(run.user))}**`,
    RUN_STATUS_LABELS[run.status] ?? run.status,
    `${cleared} of ${target} Cleared`,
  ];
  if (inProgress) parts.push(`${inProgress} In Progress`);
  return parts.join(" · ");
}

async function byMemberText(
  challenge: IChallenge,
  page: number,
  actingUserId: string,
  api: IChallengeBrowseApi,
): Promise<{ text: string; pages: number; runs: IChallengeRun[] }> {
  const runs = await api.listRuns(challenge.id, actingUserId, page, CHALLENGE_PAGE_SIZE);
  const heading = `### By member · ${plural(runs.count, "Run")}`;
  const lines = runs.items.map(runLine);
  if (!runs.count) lines.push("Nobody has started a Run yet.");
  return { text: [heading, ...lines].join("\n"), pages: runs.pages, runs: runs.items };
}

/** A Slots Challenge's by-member select: open a member's Run by decade (bot#1550). */
function slotsRunSelect(
  challengeId: number,
  runs: readonly IChallengeRun[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (!runs.length) return null;
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(buildChallengeSlotsId({ action: "runs", ids: [challengeId] }))
      .setPlaceholder("See a member's years")
      .addOptions(...runs.map((run) => ({
        label: `${memberName(run.user)} · ${RUN_STATUS_LABELS[run.status] ?? run.status}`
          .slice(0, DISCORD_SELECT_LABEL_MAX),
        description: `${run.progress.cleared} of ${run.progress.target} years`,
        value: String(run.id),
      }))),
  );
}

function showButton(
  challengeId: number,
  label: string,
  target: { view: ChallengeShowView; page: number },
  options: { primary?: boolean; disabled?: boolean } = {},
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeShowId({ challengeId, ...target, reply: "update" }))
    .setLabel(label)
    .setStyle(options.primary ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(options.disabled ?? false);
}

/**
 * /challenge show: the Challenge's header, then one page of its Pool by game or its Runs
 * by member, with buttons to flip the view and page. A Challenge without a Pool has only
 * the by-member view. API errors are thrown for the caller's error reply.
 */
export async function buildChallengeShowView(
  target: { challengeId: number; view: ChallengeShowView; page: number; actingUserId: string },
  deps: IChallengeBrowseDeps = {},
): Promise<IChallengeView> {
  const api = deps.api ?? CHALLENGE_API;
  const now = deps.now?.() ?? new Date();
  const challenge = await api.getChallenge(target.challengeId, target.actingUserId);
  if (!challenge) {
    return challengeTextView(
      `There is no Challenge ${target.challengeId}, or it is hidden from you.`,
    );
  }
  const hasPool = !!challenge.pool;
  const shown: ChallengeShowView = hasPool ? target.view : "member";
  const page = shown === target.view ? target.page : 1;
  const body: { text: string; pages: number; runs?: IChallengeRun[] } = shown === "game"
    ? await byGameText(challenge, page, target.actingUserId, api)
    : await byMemberText(challenge, page, target.actingUserId, api);

  const container = new ContainerBuilder();
  addHeader(container, challenge, now);
  container
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(buildTextDisplay(body.text));
  const id = challenge.id;
  const buttons: ButtonBuilder[] = [];
  if (hasPool) {
    buttons.push(
      showButton(id, "By game", { view: "game", page: shown === "game" ? page : 1 }, {
        primary: shown === "game",
        disabled: shown === "game",
      }),
      showButton(id, "By member", { view: "member", page: shown === "member" ? page : 1 }, {
        primary: shown === "member",
        disabled: shown === "member",
      }),
    );
  }
  if (body.pages > 1 || hasPool) {
    buttons.push(
      showButton(id, "Previous", { view: shown, page: page - 1 }, { disabled: page <= 1 }),
      showButton(id, "Next", { view: shown, page: page + 1 }, { disabled: page >= body.pages }),
    );
  }
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = buttons.length
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)]
    : [];
  const runSelect = challenge.challenge_format === "slots"
    ? slotsRunSelect(id, body.runs ?? [])
    : null;
  if (runSelect) rows.unshift(runSelect);
  return view(container, rows);
}

const LIST_TITLES: Readonly<Record<ChallengeListFilter, string>> = {
  all: "All Challenges",
  open: "Open Challenges",
  closed: "Closed Challenges",
};

function listOpenParam(filter: ChallengeListFilter): boolean | undefined {
  if (filter === "all") return undefined;
  return filter === "open";
}

function listEntry(challenge: IChallenge): string {
  const host = challenge.hosted_by_club || !challenge.host
    ? "the club"
    : escapeChallengeText(memberName(challenge.host));
  const parts = [
    `**${escapeChallengeText(challenge.name)}**`,
    CHALLENGE_FORMAT_LABELS[challenge.challenge_format],
    describeScheduleShort(challenge),
    challenge.open ? "Open" : "Closed",
  ];
  const sub = [`Hosted by ${host}`];
  if (challenge.hidden) sub.push("Hidden");
  return `${parts.join(" · ")}\n-# ${sub.join(" · ")}`;
}

/**
 * /challenge list: one page of the Challenges the member may see, newest first, with a
 * select to show one and buttons to page. API errors are thrown for the caller.
 */
export async function buildChallengeListView(
  input: { actingUserId: string; filter: ChallengeListFilter; page: number },
  deps: IChallengeBrowseDeps = {},
): Promise<IChallengeView> {
  const api = deps.api ?? CHALLENGE_API;
  const result = await api.listChallenges({
    actingUserId: input.actingUserId,
    open: listOpenParam(input.filter),
    page: input.page,
    per: CHALLENGE_PAGE_SIZE,
  });
  const title = LIST_TITLES[input.filter];
  const container = buildTextContainer(
    `## Challenges\n-# ${title} · page ${Math.min(input.page, result.pages)} of ${result.pages}`,
  );
  if (!result.items.length) {
    const none = input.filter === "all" ? "No Challenges yet." : `No ${title}.`;
    container.addTextDisplayComponents(buildTextDisplay(
      input.page > 1 ? "No Challenges on this page." : none,
    ));
  } else {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(buildTextDisplay(result.items.map(listEntry).join("\n")));
  }

  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (result.items.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CHALLENGE_LIST_SHOW_ID)
        .setPlaceholder("Show a Challenge")
        .addOptions(...result.items.map((challenge) => ({
          label: challenge.name.slice(0, DISCORD_SELECT_LABEL_MAX),
          value: String(challenge.id),
        }))),
    ));
  }
  if (result.pages > 1) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildChallengeListId(input.filter, Math.max(1, input.page - 1)))
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(input.page <= 1),
      new ButtonBuilder()
        .setCustomId(buildChallengeListId(input.filter, input.page + 1))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(input.page >= result.pages),
    ));
  }
  return view(container, rows);
}
