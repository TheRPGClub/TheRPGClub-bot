import { ActionRowBuilder, ButtonBuilder, ContainerBuilder } from "@discordjs/builders";
import { ButtonStyle, MessageFlags } from "discord-api-types/v10";
import { buildTextDisplay } from "../functions/ComponentsV2Utils.js";
import { buildChallengeSantaId } from "../functions/ChallengeCustomIds.js";
import { escapeChallengeText, listJoin } from "../functions/ChallengeCopy.js";
import { commandMention } from "./CommandMentionService.js";
import { challengeTextView, type IChallengeView } from "./ChallengeBrowse.js";
import {
  CHALLENGE_API,
  challengeRefusalText,
  type IChallenge,
  type IChallengeApi,
  type IChallengeOpenSignup,
  type IChallengeRun,
} from "./ChallengeApi.js";
import {
  CHALLENGE_EDITION_API,
  type EditionPhase,
  type IChallengeEdition,
  type IChallengeEditionApi,
} from "./ChallengeEditionApi.js";
import type { ChallengeRunResult } from "./ChallengeRuns.js";
import { editionDay, editionName } from "./ChallengeSignupPosts.js";
import { plural } from "../utilities/TextUtils.js";
import { CHALLENGE_ASSIGNMENT_READ } from "../config/challenges.js";

// Secret Santa sign-up from Discord (spec api#376, bot#1551): /challenge santa join and
// leave, the posts' Sign up button, and the buttons of their replies. The API decides
// every rule (the cutoff, the 5-game minimum, leaving after the draw until the pick
// deadline); its refusals are shown as given, with the request and response.

export interface ISantaSignupDeps {
  editions?: Pick<IChallengeEditionApi, "getEdition" | "signUp" | "withdraw">;
  challenges?: Pick<IChallengeApi, "getChallenge" | "listChallenges">;
}

/** Which Edition: one a button names, or the latest of a Challenge (null: find it). */
export type SantaTarget =
  | { editionId: number; actingUserId: string }
  | { challengeId: number | null; actingUserId: string };

/** What a Secret Santa command does to an Edition. */
export type SantaAction = "join" | "leave" | "pick";

/**
 * The phases each command acts in (join while sign-up runs, leave until the picks close,
 * pick between the draw and the reveal), and how its replies say there is no such Edition.
 */
const ACTIONS: Readonly<Record<SantaAction, {
  phases: readonly EditionPhase[];
  /** "Secret Santa has no Edition <state> right now." */
  state: string;
  /** "A and B both <doing>." */
  doing: string;
  none: string;
}>> = {
  join: {
    phases: ["signup"],
    state: "taking sign-ups",
    doing: "take sign-ups",
    none: "No Secret Santa is taking sign-ups right now. Sign-up opens the day after each " +
      "reveal.",
  },
  leave: {
    phases: ["signup", "picking"],
    state: "under way",
    doing: "are under way",
    none: "No Secret Santa is under way right now, so there is nothing to leave.",
  },
  pick: {
    phases: ["picking"],
    state: "taking picks",
    doing: "take picks",
    none: "No Secret Santa is taking picks right now. Santas pick after the draw, until " +
      "the pick deadline.",
  },
};

function viewWithButtons(content: string, buttons: ButtonBuilder[]): IChallengeView {
  const container = new ContainerBuilder().addTextDisplayComponents(buildTextDisplay(content));
  return {
    components: [
      container.toJSON(),
      new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons).toJSON(),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function santaButton(
  action: "leave" | "withdraw" | "stay",
  editionId: number,
  label: string,
  style: ButtonStyle,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildChallengeSantaId(action, editionId))
    .setLabel(label)
    .setStyle(style);
}

/** A named Challenge's latest Edition when it is in one of `phases`. */
async function namedEdition(
  challengeId: number,
  input: { actingUserId: string; action: SantaAction },
  api: NonNullable<ISantaSignupDeps["challenges"]>,
): Promise<{ editionId: number } | ChallengeRunResult> {
  let challenge: IChallenge | null;
  try {
    challenge = await api.getChallenge(challengeId, input.actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Challenge.") };
  }
  if (!challenge) {
    return {
      view: challengeTextView(`There is no Challenge ${challengeId}, or it is hidden from you.`),
    };
  }
  const name = escapeChallengeText(challenge.name);
  if (challenge.challenge_format !== "assignment") {
    return {
      view: challengeTextView(
        `${name} isn't a Secret Santa. Start a Run of it with ` +
          `${commandMention("challenge start")}.`,
      ),
    };
  }
  const edition = challenge.assignment?.edition;
  if (!edition || !ACTIONS[input.action].phases.includes(edition.phase)) {
    return {
      view: challengeTextView(`${name} has no Edition ${ACTIONS[input.action].state} right now.`),
    };
  }
  return { editionId: edition.id };
}

/** The one Secret Santa whose latest Edition is in one of `phases`, when none is named. */
async function onlyEdition(
  input: { actingUserId: string; action: SantaAction },
  api: NonNullable<ISantaSignupDeps["challenges"]>,
): Promise<{ editionId: number } | ChallengeRunResult> {
  let challenges: IChallenge[];
  try {
    const page = await api.listChallenges({
      actingUserId: input.actingUserId,
      challengeFormat: "assignment",
      page: 1,
      per: CHALLENGE_ASSIGNMENT_READ,
    });
    challenges = page.items;
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Secret Santas.") };
  }
  const live = challenges.filter((challenge) => {
    const phase = challenge.assignment?.edition?.phase;
    return challenge.challenge_format === "assignment" && !!phase &&
      ACTIONS[input.action].phases.includes(phase);
  });
  if (live.length === 1) return { editionId: live[0]!.assignment!.edition!.id };
  if (!live.length) return { view: challengeTextView(ACTIONS[input.action].none) };
  const names = listJoin(live.map((challenge) => escapeChallengeText(challenge.name)));
  const doing = ACTIONS[input.action].doing;
  return {
    view: challengeTextView(
      `${names} ${live.length === 2 ? "both " : "all "}${doing}. Pick one with the ` +
        "challenge option.",
    ),
  };
}

/** The Edition a command acts on: the one named, or found by its Challenge. */
export async function resolveEdition(
  target: SantaTarget,
  action: SantaAction,
  deps: Pick<ISantaSignupDeps, "challenges">,
): Promise<{ editionId: number } | ChallengeRunResult> {
  if ("editionId" in target) return { editionId: target.editionId };
  const api = deps.challenges ?? CHALLENGE_API;
  const input = { actingUserId: target.actingUserId, action };
  return target.challengeId
    ? namedEdition(target.challengeId, input, api)
    : onlyEdition(input, api);
}

function joinedText(edition: IChallengeEdition): string {
  return [
    `## You're in ${editionName(edition)}`,
    `On ${editionDay(edition.signup_cutoff_on)} the draw makes you someone's Santa, and ` +
      `someone yours. On ${editionDay(edition.reveal_on)} everyone unwraps theirs.`,
    `-# ${plural(edition.signed_up_count, "member")} signed up · Changed your ` +
      `mind? Leave before ${editionDay(edition.signup_cutoff_on)}.`,
  ].join("\n");
}

/** Signs the acting member up (/challenge santa join, or a post's Sign up button). */
export async function santaJoinReply(
  target: SantaTarget,
  deps: ISantaSignupDeps = {},
): Promise<ChallengeRunResult> {
  const found = await resolveEdition(target, "join", deps);
  if (!("editionId" in found)) return found;
  const api = deps.editions ?? CHALLENGE_EDITION_API;
  try {
    const edition = await api.signUp(found.editionId, target.actingUserId);
    return {
      view: viewWithButtons(joinedText(edition), [
        santaButton("leave", edition.id, "Leave", ButtonStyle.Secondary),
      ]),
    };
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not sign you up.") };
  }
}

function leaveQuestion(edition: IChallengeEdition): IChallengeView {
  return viewWithButtons(
    [
      `## Leave ${editionName(edition)}?`,
      "The draw is done, so leaving now drops your pick: the member you're Santa for gets " +
        "a random game from their backlog on " +
        `${editionDay(edition.pick_deadline_on)} instead. Your own Secret Santa Run is ` +
        "Abandoned. This can't be undone.",
    ].join("\n"),
    [
      santaButton("withdraw", edition.id, "Leave Secret Santa", ButtonStyle.Danger),
      santaButton("stay", edition.id, "Stay in", ButtonStyle.Secondary),
    ],
  );
}

/** Whether leaving now would drop a drawn Santa's pick, so the member is asked first. */
function isDrawnSanta(edition: IChallengeEdition, actingUserId: string): boolean {
  if (edition.phase !== "picking" || !edition.signed_up) return false;
  const member = edition.members?.find((m) => m.user_id === actingUserId);
  return !member || (!member.left_out && !member.withdrawn);
}

async function withdraw(
  editionId: number,
  actingUserId: string,
  deps: ISantaSignupDeps,
): Promise<ChallengeRunResult> {
  const api = deps.editions ?? CHALLENGE_EDITION_API;
  let edition: IChallengeEdition | null;
  try {
    edition = await api.withdraw(editionId, actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not take you off Secret Santa.") };
  }
  if (!edition) {
    return { view: challengeTextView("That Edition is gone, so there is nothing to leave.") };
  }
  const left = `You left ${editionName(edition)}.`;
  return {
    view: challengeTextView(edition.phase === "signup"
      ? `${left} Changed your mind? Sign up again before ` +
        `${editionDay(edition.signup_cutoff_on)}.`
      : `${left} The member you were Santa for gets a random game on ` +
        `${editionDay(edition.pick_deadline_on)}.`),
  };
}

/**
 * Takes the acting member off an Edition (/challenge santa leave, or a Leave button).
 * Before the cutoff it happens at once; after the draw a Santa is asked first, since it
 * drops their pick and Abandons their Run. The API decides either way.
 */
export async function santaLeaveReply(
  target: SantaTarget,
  deps: ISantaSignupDeps = {},
): Promise<ChallengeRunResult> {
  const found = await resolveEdition(target, "leave", deps);
  if (!("editionId" in found)) return found;
  const api = deps.editions ?? CHALLENGE_EDITION_API;
  let edition: IChallengeEdition | null;
  try {
    edition = await api.getEdition(found.editionId, target.actingUserId);
  } catch (err: unknown) {
    return { error: challengeRefusalText(err, "Could not read the Edition.") };
  }
  if (!edition) {
    return { view: challengeTextView("That Edition is gone, so there is nothing to leave.") };
  }
  if (isDrawnSanta(edition, target.actingUserId)) return { view: leaveQuestion(edition) };
  return withdraw(edition.id, target.actingUserId, deps);
}

/** Leaves after the draw, once the member confirmed (the question's Leave button). */
export function santaWithdrawReply(
  input: { editionId: number; actingUserId: string },
  deps: ISantaSignupDeps = {},
): Promise<ChallengeRunResult> {
  return withdraw(input.editionId, input.actingUserId, deps);
}

/** "**Secret Santa 2026** · you're signed up. The draw is on 1 December." */
export function signedUpLine(
  signup: Pick<IChallengeOpenSignup, "challenge" | "year" | "signup_cutoff_on">,
): string {
  return `**${editionName(signup)}** · you're signed up. The draw is on ` +
    `${editionDay(signup.signup_cutoff_on)}.`;
}

/**
 * The my-runs advice for a Secret Santa Run: the Santa still picking before the reveal,
 * then the game picked and what to do with it. `today` is the club's date.
 */
export function assignmentAdvice(run: IChallengeRun, today: string): string[] {
  const name = `**${escapeChallengeText(run.challenge?.name ?? "Secret Santa")}` +
    `${run.edition ? ` ${run.edition.year}` : ""}**`;
  const game = run.assignment?.game;
  const revealOn = run.window?.starts_on;
  if (!game) {
    if (revealOn && today < revealOn) {
      return [
        `${name}: your Santa is picking a game from your backlog. It's revealed on ` +
          `${editionDay(revealOn)}.`,
      ];
    }
    return [`${name}: no game in your backlog could be picked, so this Run can't Finish.`];
  }
  const title = `**${escapeChallengeText(game.title)}**`;
  const picked = run.assignment?.picked_randomly
    ? `${title} was picked for you at random.`
    : `your Santa picked ${title}.`;
  const playing = (run.entries ?? []).some((entry) =>
    entry.game_id === game.game_id && entry.state === "in_progress");
  const next = playing
    ? `You're playing it. Log it with ${commandMention("game-completion add")} when you ` +
      "finish."
    : `Clear it to Finish: start it with ${commandMention("now-playing add")}.`;
  return [`${name}: ${picked} ${next}`];
}
