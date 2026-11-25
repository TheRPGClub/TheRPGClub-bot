import { AttachmentBuilder, type Client, type ContainerBuilder } from "discord.js";
import {
  gotyAdminApi,
  type IGotyAdminApi,
} from "./GotyVoteApi.js";
import {
  parseGotyEventPayload,
  type IGotyEventAward,
  type IGotyEventGame,
  type IGotyEventPayload,
} from "../classes/GotyEventPayload.js";
import type { GotyVotingEventKind, IGotyVotingEvent } from "../classes/VotingEvents.js";
import { ADMIN_CHANNEL_ID, ANNOUNCEMENT_CHANNEL_ID } from "../config/channels.js";
import { POST_FEATURE_KEYS } from "../config/featureGate.js";
import { fetchSendableChannel } from "../functions/ChannelUtils.js";
import {
  buildComponentsV2Flags,
  buildContentContainer,
  buildTextContainer,
  safeV2TextContent,
} from "../functions/ComponentsV2Utils.js";
import { toUnixTimestamp } from "../functions/DateFormatUtils.js";
import {
  featurePostDestination,
  routeFeaturePost,
  type IFeatureFlagSource,
} from "../functions/FeatureGate.js";
import { buildGotyTiePrompt } from "../functions/GotyAdminHelpers.js";
import { addVoteImageToContainer } from "../functions/NominationListComponents.js";
import { logError, logInfo, logWarn } from "../utilities/LogUtils.js";
import { composeVoteImage } from "./collageGenerator.js";
import { commandMention } from "./CommandMentionService.js";
import { featureFlagCache } from "./FeatureAccessService.js";
import { getFeatureState, logSuppressedPost } from "./FeaturePostRouting.js";
import { fetchGameCoverBuffer, fetchImageBuffer } from "./GameImageService.js";
import type { GotyDecidedBy } from "./GotyVoteApi.js";
import type { VotingEventOutcome } from "./VotingEventHandlers.js";

// The GOTY Vote's posts (bot#1582, spec api#471): the goty_* events the API's sweep queues
// in the voting outbox, claimed and acked by VotingEventService with the round events.
// Each payload is a snapshot (IGotyEventPayload), so nothing is read back from the API
// except the tie prompt, which reads the live ties so a settled one is not offered again.
// Public posts go to the channel GOTM voting announcements use, routed by the goty_vote
// Feature (bot-dev in Preview, nothing when Off); the tie prompt goes to the admin channel,
// as the round's does. Every post leads with the GOTY Vote's name ("GOTY Vote 2026").

const TEXT_MAX = 3500;
/**
 * A message's text displays share Discord's 4000-character limit, so the results post
 * (a header and one block per Award) trims each Award's block to this.
 */
const DECIDED_AWARD_TEXT_MAX = 1100;

/** A composed cover image for one Award's ballot, sent with its message. */
export interface IGotyBallotImage {
  file: AttachmentBuilder;
  url: string;
}

export interface IGotyEventDeps {
  flags?: IFeatureFlagSource;
  /** Reads the live ties for the tie prompt. */
  adminApi?: Pick<IGotyAdminApi, "getVote">;
  /** The voting_opened ballot image; null leaves the message without one. */
  ballotImage?: (
    payload: IGotyEventPayload,
    award: IGotyEventAward,
  ) => Promise<IGotyBallotImage | null>;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function when(date: Date | null): string {
  if (!date) return "soon";
  const unix = toUnixTimestamp(date);
  return `<t:${unix}:R> (<t:${unix}:F>)`;
}

function bold(title: string): string {
  return `**${title.replace(/\*/g, "\\*")}**`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function titleList(games: IGotyEventGame[]): string[] {
  return games.map((game) => `- ${bold(game.title)}`);
}

function gamesById(award: IGotyEventAward, ids: number[]): IGotyEventGame[] {
  return ids.map((id) =>
    award.games.find((game) => game.gameId === id) ??
      { gameId: id, title: `Game ${id}`, coverUrl: null, votes: null, runoffVotes: null });
}

function notGivenLine(payload: IGotyEventPayload, award: IGotyEventAward): string {
  return `No candidates, so ${award.name} is not given for ${payload.year}.`;
}

const DECIDED_BY_TEXT: Readonly<Record<GotyDecidedBy, string>> = {
  vote: "won the vote",
  runoff: "won the runoff",
  admin: "picked by an admin after the runoff tied again",
  uncontested: "the only candidate, so it won without a vote",
};

/** nominations opened: how to nominate, when voting opens, and the two automatic ballots. */
export function buildGotyNominationsOpenedText(payload: IGotyEventPayload): string {
  const lines = [
    `## ${payload.name}: nominations are open`,
    `Nominate up to ${plural(payload.nominationCap, "game")} first released in ` +
      `${payload.year} for ${bold("Game of the Year")} with ` +
      `${commandMention("goty nominate")}. Change or withdraw them until voting opens.`,
    `Voting opens ${when(payload.votingOpensAt)} for all three Awards.`,
  ];
  for (const award of payload.awards) {
    if (award.award === "game_of_the_year") continue;
    lines.push(`### ${award.name}`);
    if (award.games.length === 0) {
      lines.push(notGivenLine(payload, award));
      continue;
    }
    lines.push(`The year's ${plural(award.games.length, "winner")}, no nominations needed:`);
    lines.push(...titleList(award.games));
  }
  return lines.join("\n");
}

/** A reminder 5 days or 1 day before voting opens. */
export function buildGotyNominationReminderText(
  payload: IGotyEventPayload,
  kind: GotyVotingEventKind,
): string {
  const days = payload.daysBefore ?? (kind === "goty_nomination_reminder_1d" ? 1 : 5);
  const lead = days === 1 ? "voting opens tomorrow" : `voting opens in ${days} days`;
  const nominated = payload.awards.find((award) => award.award === "game_of_the_year");
  const lines = [
    `## ${payload.name}: ${lead}`,
    `Voting opens ${when(payload.votingOpensAt)}, and ${bold("Game of the Year")} ` +
      "nominations close then.",
    `Nominate up to ${plural(payload.nominationCap, "game")} first released in ` +
      `${payload.year} with ${commandMention("goty nominate")}.`,
  ];
  if (nominated) {
    lines.push(`${plural(nominated.games.length, "game")} nominated so far.`);
  }
  return lines.join("\n");
}

/** voting opened: one Award's ballot. */
export function buildGotyBallotText(payload: IGotyEventPayload, award: IGotyEventAward): string {
  const lines = [`## ${payload.name}: ${award.name}`];
  if (award.games.length === 0) {
    lines.push(notGivenLine(payload, award));
  } else if (award.uncontested) {
    lines.push(
      `${bold(award.games[0].title)} is the only candidate, so it wins ` +
        `${award.name} ${payload.year} without a vote.`,
    );
  } else {
    lines.push(
      `Voting is open. Vote for up to ${plural(award.cap, "game")} of these ` +
        `${award.games.length} with ${commandMention("goty vote")}. ` +
        `Voting closes ${when(payload.votingClosesAt)}.`,
      ...titleList(award.games),
    );
  }
  return lines.join("\n");
}

function winnerLine(award: IGotyEventAward): string | null {
  if (!award.winner) return null;
  return `Winner: ${bold(award.winner.title)} (${DECIDED_BY_TEXT[award.winner.decidedBy]}).`;
}

function voteCount(count: number | null): string {
  return count === null ? "" : `: ${plural(count, "vote")}`;
}

/** runoff opened: the tied Awards' runoff games, and the Awards already decided. */
export function buildGotyRunoffOpenedText(payload: IGotyEventPayload): string {
  const lines = [
    `## ${payload.name}: runoff is open`,
    "A tied Award goes to a runoff with one vote each. Vote with " +
      `${commandMention("goty vote")} before it closes ${when(payload.runoffClosesAt)}.`,
  ];
  for (const award of payload.awards) {
    lines.push(`### ${award.name}`);
    if (award.runoffBallot.length > 0) {
      lines.push("Tied in the vote:");
      lines.push(
        ...gamesById(award, award.runoffBallot).map(
          (game) => `- ${bold(game.title)}${voteCount(game.votes)}`,
        ),
      );
    } else {
      lines.push(winnerLine(award) ?? (award.games.length === 0
        ? notGivenLine(payload, award)
        : "Decided without a runoff."));
    }
  }
  return lines.join("\n");
}

/** runoff closed: each runoff's tally and winner, or the tie an admin now settles. */
export function buildGotyRunoffClosedText(payload: IGotyEventPayload): string {
  const lines = [`## ${payload.name}: runoff results`];
  const runoffs = payload.awards.filter((award) => award.runoffBallot.length > 0);
  if (runoffs.length === 0) lines.push("No Award went to the runoff.");
  for (const award of runoffs) {
    lines.push(`### ${award.name}`);
    lines.push(
      ...gamesById(award, award.runoffBallot)
        .sort((a, b) => (b.runoffVotes ?? 0) - (a.runoffVotes ?? 0))
        .map((game) => `- ${bold(game.title)}${voteCount(game.runoffVotes)}`),
    );
    if (award.pendingTie.length > 0) {
      lines.push("The runoff tied again, so an admin picks the winner.");
    } else {
      lines.push(winnerLine(award) ?? "No winner was recorded.");
    }
  }
  return lines.join("\n");
}

function tallyLine(game: IGotyEventGame, runoffBallot: number[]): string {
  // The payload sends 0 runoff votes for a game that was not in the runoff, so only the
  // runoff's own games show a runoff count.
  const runoff = runoffBallot.includes(game.gameId) && game.runoffVotes !== null
    ? `, ${plural(game.runoffVotes, "runoff vote")}`
    : "";
  return `- ${bold(game.title)}${voteCount(game.votes)}${runoff}`;
}

/** decided: one Award's winner and its full tally. */
export function buildGotyDecidedAwardText(
  payload: IGotyEventPayload,
  award: IGotyEventAward,
): string {
  const lines = [`### ${award.name} ${payload.year}`];
  if (award.games.length === 0) {
    lines.push(notGivenLine(payload, award));
    return lines.join("\n");
  }
  lines.push(winnerLine(award) ?? "No winner was recorded.");
  if (!award.uncontested) {
    lines.push(
      ...[...award.games]
        .sort((a, b) =>
          (b.votes ?? 0) - (a.votes ?? 0) || (b.runoffVotes ?? 0) - (a.runoffVotes ?? 0))
        .map((game) => tallyLine(game, award.runoffBallot)),
    );
  }
  return lines.join("\n");
}

export function buildGotyDecidedHeader(payload: IGotyEventPayload): string {
  return [
    `## ${payload.name}: the winners`,
    `The club's picks for ${payload.year}. See every year with ` +
      `${commandMention("goty results")}.`,
  ].join("\n");
}

const PREVIEW_NOTICE =
  "-# Preview: the GOTY Vote Feature is in Preview, so this posted here " +
  "instead of announcements.";

// ---------------------------------------------------------------------------
// Ballot image
// ---------------------------------------------------------------------------

/**
 * The Award's covers composed into one image, as the GOTM vote panels have (the same
 * collage), sent as a file. Null when no cover could be read.
 */
export async function buildGotyBallotImage(
  payload: IGotyEventPayload,
  award: IGotyEventAward,
): Promise<IGotyBallotImage | null> {
  const covers = await Promise.all(
    award.games.map(async (game) => {
      const imageData = game.coverUrl
        ? await fetchImageBuffer(game.coverUrl)
        : (await fetchGameCoverBuffer(game.gameId))?.buffer ?? null;
      return imageData ? { gameId: game.gameId, title: game.title, imageData } : null;
    }),
  );
  const found = covers.filter((cover) => cover !== null);
  if (found.length === 0) return null;
  // The collage only checks the number is positive; the year stands in for the round.
  const image = await composeVoteImage({
    roundNumber: payload.year,
    voteType: "GOTM",
    covers: found,
  });
  const name = `goty_${payload.year}_${award.award}.png`;
  return { file: new AttachmentBuilder(image, { name }), url: `attachment://${name}` };
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

interface IGotyMessage {
  components: ContainerBuilder[];
  files?: AttachmentBuilder[];
}

async function send(client: Client, channelId: string, message: IGotyMessage): Promise<void> {
  const channel = await fetchSendableChannel(client, channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} was not found or cannot be sent to.`);
  }
  await channel.send({
    components: message.components,
    files: message.files ?? [],
    flags: buildComponentsV2Flags(false),
    allowedMentions: { parse: [] },
  });
}

function textMessage(text: string, preview: boolean): IGotyMessage {
  const content = preview ? `${text}\n${PREVIEW_NOTICE}` : text;
  return { components: [buildTextContainer(safeV2TextContent(content, TEXT_MAX))] };
}

async function ballotMessage(
  payload: IGotyEventPayload,
  award: IGotyEventAward,
  preview: boolean,
  ballotImage: NonNullable<IGotyEventDeps["ballotImage"]>,
): Promise<IGotyMessage> {
  const message = textMessage(buildGotyBallotText(payload, award), preview);
  if (award.games.length < 2) return message;
  const image = await ballotImage(payload, award).catch((err: unknown) => {
    // The ballot matters more than its art: post it without the image.
    logError("GotyVotingEventHandlers.ballotImage", err);
    return null;
  });
  if (image) {
    addVoteImageToContainer(message.components[0], image.url);
    message.files = [image.file];
  }
  return message;
}

/**
 * Tells the admin channel which Awards' ballots did not post. The event is acked once any
 * ballot posted (a retry would repost the rest), so without this alert the missing ones
 * would be lost silently.
 */
async function alertMissingBallots(
  client: Client,
  channelId: string,
  payload: IGotyEventPayload,
  failures: string[],
): Promise<void> {
  const text = [
    `## ${payload.name}: ballot posts missing`,
    `These ballots could not be posted in <#${channelId}> and will not be retried:`,
    ...failures.map((failure) => `- ${failure}`),
    `Members can still vote with ${commandMention("goty vote")}. Post the missing ` +
      "ballots by hand if wanted.",
  ].join("\n");
  try {
    await send(client, ADMIN_CHANNEL_ID, textMessage(text, false));
  } catch (err) {
    logError("GotyVotingEventHandlers.ballotAlert", err);
  }
}

/**
 * The voting_opened messages, one per Award. A failed Award is logged and the rest still
 * post; only when none went out does it throw for a retry (which would repost the ones that
 * did, as for the round's panels). A partial failure is acked and alerted to the admin
 * channel.
 */
async function postBallots(
  client: Client,
  channelId: string,
  payload: IGotyEventPayload,
  preview: boolean,
  ballotImage: NonNullable<IGotyEventDeps["ballotImage"]>,
): Promise<void> {
  let posted = 0;
  const failures: string[] = [];
  for (const award of payload.awards) {
    try {
      await send(client, channelId, await ballotMessage(payload, award, preview, ballotImage));
      posted += 1;
    } catch (err) {
      logError("GotyVotingEventHandlers.ballot", err);
      failures.push(`${award.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (posted === 0) {
    throw new Error(`No ${payload.name} ballot could be posted.\n${failures.join("\n")}`);
  }
  if (failures.length > 0) {
    logWarn("GotyVotingEventHandlers.ballot", failures.join("\n"));
    await alertMissingBallots(client, channelId, payload, failures);
  }
}

function decidedMessage(payload: IGotyEventPayload, preview: boolean): IGotyMessage {
  const header = preview
    ? `${buildGotyDecidedHeader(payload)}\n${PREVIEW_NOTICE}`
    : buildGotyDecidedHeader(payload);
  return {
    components: [
      buildTextContainer(safeV2TextContent(header, TEXT_MAX)),
      ...payload.awards.map((award) =>
        buildContentContainer(
          safeV2TextContent(buildGotyDecidedAwardText(payload, award), DECIDED_AWARD_TEXT_MAX),
          award.winner?.coverUrl ?? null,
        )),
    ],
  };
}

/**
 * The admin channel's tie prompt (/admin goty-tie's selects), from the live ties so a tie
 * settled since the event was queued is not offered. Skipped when none is left.
 */
async function postTiePrompt(
  client: Client,
  event: IGotyVotingEvent,
  adminApi: Pick<IGotyAdminApi, "getVote">,
): Promise<VotingEventOutcome> {
  const vote = await adminApi.getVote(event.gotyYear);
  if (!vote || vote.ties.length === 0) return "skipped";
  const lead = "The runoff tied again. Pick each tied Award's winner below " +
    `(or with ${commandMention("admin goty-tie")}).`;
  await send(client, ADMIN_CHANNEL_ID, { components: buildGotyTiePrompt(vote, lead) });
  return "delivered";
}

/**
 * Performs the Discord side of one goty_* event. Throws to have it retried. While the
 * goty_vote Feature is Off, a public post is skipped (acked, nothing posted); in Preview it
 * goes to the bot-dev channel with a notice. The admin tie prompt always goes out.
 */
export async function handleGotyVotingEvent(
  client: Client,
  event: IGotyVotingEvent,
  deps: IGotyEventDeps = {},
): Promise<VotingEventOutcome> {
  if (event.kind === "goty_tie_pending") {
    return postTiePrompt(client, event, deps.adminApi ?? gotyAdminApi);
  }
  const payload = parseGotyEventPayload(event.payload, event.gotyYear);
  if (!payload) {
    throw new Error(`Voting event ${event.id} (${event.kind}) has no readable GOTY payload.`);
  }

  const featureKey = POST_FEATURE_KEYS.gotyVote;
  const state = await getFeatureState(featureKey, deps.flags ?? featureFlagCache);
  const channelId = routeFeaturePost(state, ANNOUNCEMENT_CHANNEL_ID);
  if (!channelId) {
    logSuppressedPost(featureKey, `voting event ${event.id} (${event.kind})`);
    return "skipped";
  }
  const preview = featurePostDestination(state) === "bot_dev";

  switch (event.kind) {
    case "goty_nominations_opened":
      await send(client, channelId, textMessage(buildGotyNominationsOpenedText(payload), preview));
      break;
    case "goty_nomination_reminder_5d":
    case "goty_nomination_reminder_1d":
      await send(
        client,
        channelId,
        textMessage(buildGotyNominationReminderText(payload, event.kind), preview),
      );
      break;
    case "goty_voting_opened":
      await postBallots(
        client,
        channelId,
        payload,
        preview,
        deps.ballotImage ?? buildGotyBallotImage,
      );
      break;
    case "goty_runoff_opened":
      await send(client, channelId, textMessage(buildGotyRunoffOpenedText(payload), preview));
      break;
    case "goty_runoff_closed":
      await send(client, channelId, textMessage(buildGotyRunoffClosedText(payload), preview));
      break;
    case "goty_decided":
      await send(client, channelId, decidedMessage(payload, preview));
      break;
  }
  logInfo("GotyVotingEventHandlers", `Posted ${event.kind} for ${payload.name}.`);
  return "delivered";
}
