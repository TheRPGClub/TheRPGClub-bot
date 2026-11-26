import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SeparatorBuilder,
} from "@discordjs/builders";
import { ButtonStyle, SeparatorSpacingSize } from "discord-api-types/v10";
import type { Client } from "discord.js";
import { FUN_FACT_INK } from "../config/codex.js";
import { loreEntryPageUrl } from "../config/website.js";
import { clubToday } from "../functions/ClubDate.js";
import {
  buildComponentsV2View,
  buildErrorReply,
  buildTextDisplay,
  type IComponentsV2View,
} from "../functions/ComponentsV2Utils.js";
import {
  answerPublicOrPrivate,
  publicAnswerWaitMs,
  type IPublicAnswerIo,
  type PublicOrPrivateAnswer,
} from "../functions/PublicAnswer.js";
import { buildApiRefusalMessage } from "../utilities/ApiErrorUtils.js";
import { commandMention } from "./CommandMentionService.js";
import {
  FUN_FACT_API,
  type ICodexEntry,
  type IFunFactApi,
} from "./CodexApi.js";

// The Fun Fact posts (spec api#397, bot#1562): the Daily Fun Fact in general chat and the
// /funfact reply. Both are design 1B's pink card: the label, the Fun Fact as a heading, a
// divider, "Added by @author", and Read the story when it links to a Lore Entry. Mentions
// are `<@id>` tokens, so Discord shows names, and the post pings nobody.

/** The card's label: the 15:00 post, or one a member asked for with /funfact. */
export type FunFactCardLabel = "Daily Fun Fact" | "Fun Fact";

/** The Fun Fact as a heading: each line its own, since Discord heads one line at a time. */
function headingOf(body: string | null): string {
  return (body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `## ${line}`)
    .join("\n");
}

/** The first Lore Entry the Fun Fact links to, whose story Read the story opens. */
function linkedLoreEntryId(entry: ICodexEntry): number | null {
  return entry.links.find((link) => link.part === "lore_entry")?.id ?? null;
}

/** Design 1B: the Fun Fact as a card edged in the Fun Facts ink. */
export function buildFunFactCard(
  entry: ICodexEntry,
  label: FunFactCardLabel,
): IComponentsV2View {
  const container = new ContainerBuilder()
    .setAccentColor(FUN_FACT_INK)
    .addTextDisplayComponents(
      buildTextDisplay(`-# ${label}`),
      buildTextDisplay(headingOf(entry.body)),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(buildTextDisplay(`-# Added by <@${entry.author.user_id}>`));
  const loreEntryId = linkedLoreEntryId(entry);
  if (loreEntryId !== null) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Read the story")
          .setURL(loreEntryPageUrl(loreEntryId)),
      ),
    );
  }
  return buildComponentsV2View([container.toJSON()]);
}

/** What the Daily Fun Fact job reads and posts. */
export interface ICodexJobDeps {
  /** GET /codex/fun_facts/:id with the service token; null when it was deleted (404). */
  fetchFunFact(id: number): Promise<ICodexEntry | null>;
  /** Posts to a text channel. Throws the discord.js error, or when it can't hold posts. */
  postMessage(channelId: string, post: IComponentsV2View): Promise<void>;
  /** The time now, for the club date. */
  now(): Date;
}

export function createCodexJobDeps(client: Client): ICodexJobDeps {
  return {
    fetchFunFact: (id) => FUN_FACT_API.get(id),
    postMessage: async (channelId, post) => {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isSendable()) {
        throw new Error(`Channel ${channelId} is missing or the bot cannot post in it.`);
      }
      await channel.send(post);
    },
    now: () => new Date(),
  };
}

/**
 * The Daily Fun Fact for `clubDate`: posts Fun Fact `entryId` in `channelId`, unless the
 * club day has passed (a job held up past midnight in New York) or the Fun Fact was deleted
 * since it was drawn. Both are dropped without a post, and the result says why.
 */
export async function postDailyFunFact(
  job: { clubDate: string; entryId: number },
  channelId: string,
  deps: ICodexJobDeps,
): Promise<string> {
  const today = clubToday(deps.now());
  if (job.clubDate < today) {
    return `Not posted: the Daily Fun Fact for ${job.clubDate} is stale (today is ${today}).`;
  }
  const entry = await deps.fetchFunFact(job.entryId);
  if (!entry) {
    return `Not posted: Fun Fact ${job.entryId} was deleted since it was drawn.`;
  }
  await deps.postMessage(channelId, buildFunFactCard(entry, "Daily Fun Fact"));
  return `Posted Fun Fact ${job.entryId} as the Daily Fun Fact for ${job.clubDate}.`;
}

/** A private reply in the Fun Facts ink; mentions in it never ping. */
function privateFunFactView(content: string): IComponentsV2View {
  const container = new ContainerBuilder()
    .setAccentColor(FUN_FACT_INK)
    .addTextDisplayComponents(buildTextDisplay(content));
  return buildComponentsV2View([container.toJSON()], true);
}

/**
 * What /funfact shows: the drawn Fun Fact as a public post, the private "none yet" reply,
 * or a failed draw (the API's refusal with its request and response), shown privately.
 */
export type FunFactDrawReply =
  | { post: IComponentsV2View }
  | { empty: IComponentsV2View }
  | { error: string };

/**
 * /funfact: draws the next Fun Fact as the member (the same queue as the Daily Fun Fact)
 * and shows it as design 2B, the 1B card labelled "Fun Fact". Discord's own "used
 * /funfact" line names who asked, so the card credits only the author.
 */
export async function drawFunFactReply(
  input: { actingUserId: string },
  deps: { api?: IFunFactApi } = {},
): Promise<FunFactDrawReply> {
  const api = deps.api ?? FUN_FACT_API;
  let entry: ICodexEntry | null;
  try {
    entry = await api.draw(input.actingUserId);
  } catch (err: unknown) {
    return { error: buildApiRefusalMessage(err, "Could not draw a Fun Fact.") };
  }
  if (!entry) {
    return {
      empty: privateFunFactView(
        "There aren't any Fun Facts yet. Regulars can add one with " +
          `${commandMention("codex fun-fact add")}.`,
      ),
    };
  }
  return { post: buildFunFactCard(entry, "Fun Fact") };
}

/** How /funfact answers its interaction (the command wires these to discord.js). */
export type IFunFactAnswerIo = IPublicAnswerIo;

/**
 * How long /funfact may wait on the draw before deferring: the shared public-answer timing
 * (`PUBLIC_ANSWER_BY_MS`, `PUBLIC_ANSWER_WAIT_MAX_MS`), as /patch-notes uses.
 */
export function funFactDrawWaitMs(ranAt: number, now: number): number {
  return publicAnswerWaitMs(ranAt, now);
}

/**
 * Answers /funfact with `draw`. A draw back within `waitMs` is answered at once, so an
 * empty queue or a failed draw is only ever private. A slower one is deferred publicly
 * (a Fun Fact is the usual answer) before Discord's 3 seconds run out; if it then brings
 * no Fun Fact, the public placeholder is swapped for a private reply.
 */
export async function answerFunFact(
  draw: Promise<FunFactDrawReply>,
  io: IFunFactAnswerIo,
  waitMs: number,
): Promise<void> {
  const answer = draw.then((reply): PublicOrPrivateAnswer =>
    "post" in reply ? { public: reply.post } : { private: privateDrawReply(reply) });
  await answerPublicOrPrivate(answer, io, waitMs);
}

function privateDrawReply(reply: Exclude<FunFactDrawReply, { post: unknown }>): object {
  return "empty" in reply ? reply.empty : buildErrorReply(reply.error, true);
}
