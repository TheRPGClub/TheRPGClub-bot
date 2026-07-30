import { ComponentType, type Message } from "discord.js";
import {
  buildLinkPreviewContainer,
  extractFirstUrl,
  extractPreviewTitle,
  fetchOpenGraphData,
  isInterstitialPreview,
  isInterstitialTitle,
  INTERSTITIAL_RETRY_DELAYS_MS,
  type IOpenGraphData,
} from "../functions/LinkPreviewEmbeds.js";
import { buildContainerSend } from "../functions/ComponentsV2Utils.js";
import { sleep } from "../utilities/DelayUtils.js";
import { logWarn } from "../utilities/LogUtils.js";

const LOG_CONTEXT = "LinkPreviewRecovery";
const STUCK_REPLY_SEARCH_LIMIT = 50;

interface IRawComponent {
  type: number;
  content?: string;
  components?: IRawComponent[];
}

export type PreviewRenderStatus =
  | "rendered"
  | "skipped-existing-embed"
  | "no-url"
  | "no-preview-data"
  | "still-interstitial";

export interface IPreviewRenderResult {
  status: PreviewRenderStatus;
  deletedStuckReply: boolean;
  url?: string;
}

export interface IPreviewRenderOptions {
  /** Leave the message alone when Discord already rendered its own embed. */
  skipWhenEmbedded: boolean;
  /** Look for a previously posted interstitial preview reply and delete it first. */
  sweepStuckReplies: boolean;
}

export interface IPreviewFetchResult {
  data: IOpenGraphData | undefined;
  interstitial: boolean;
}

function collectTextContent(components: readonly IRawComponent[], out: string[]): void {
  for (const component of components) {
    if (component.type === ComponentType.TextDisplay && component.content) {
      out.push(component.content);
    }
    if (component.components) collectTextContent(component.components, out);
  }
}

/** Flatten every text display in a Components V2 message into plain strings. */
export function collectTextDisplayContents(message: Message): string[] {
  const raw = message.components.map((component) => component.toJSON() as IRawComponent);
  const contents: string[] = [];
  collectTextContent(raw, contents);
  return contents;
}

/** True when the message is one of our preview containers stuck on a bot check. */
export function isStuckPreviewMessage(message: Message): boolean {
  const title = extractPreviewTitle(collectTextDisplayContents(message));
  return isInterstitialTitle(title);
}

/**
 * Find the bot's own preview reply to `sourceMessage` when it rendered an
 * interstitial. Read from live message state so this survives a bot restart.
 */
export async function findStuckPreviewReply(
  sourceMessage: Message,
): Promise<Message | undefined> {
  const channel = sourceMessage.channel;
  if (!("messages" in channel)) return undefined;

  const clientUserId = sourceMessage.client.user.id;
  const recent = await channel.messages.fetch({
    after: sourceMessage.id,
    limit: STUCK_REPLY_SEARCH_LIMIT,
  });

  return recent.find((candidate) =>
    candidate.author.id === clientUserId
    && candidate.reference?.messageId === sourceMessage.id
    && isStuckPreviewMessage(candidate));
}

/**
 * Fetch Open Graph data, retrying on the backoff schedule while the response is
 * an anti-bot interstitial. Non-interstitial results return on the first pass.
 */
export async function fetchPreviewDataWithRetry(url: string): Promise<IPreviewFetchResult> {
  let data = await fetchOpenGraphData(url);
  for (const delayMs of INTERSTITIAL_RETRY_DELAYS_MS) {
    if (!data || !isInterstitialPreview(data)) return { data, interstitial: false };
    await sleep(delayMs);
    data = await fetchOpenGraphData(url);
  }

  if (data && isInterstitialPreview(data)) {
    logWarn(LOG_CONTEXT, `Still behind a browser check after retries: ${url}`);
    return { data: undefined, interstitial: true };
  }
  return { data, interstitial: false };
}

async function deleteStuckReply(sourceMessage: Message): Promise<boolean> {
  try {
    const stuck = await findStuckPreviewReply(sourceMessage);
    if (!stuck) return false;
    await stuck.delete();
    return true;
  } catch (error) {
    logWarn(LOG_CONTEXT, `Failed to clear stuck preview for ${sourceMessage.id}: ${error}`);
    return false;
  }
}

/**
 * Rebuild the link preview for `sourceMessage`, clearing any interstitial
 * container the bot posted previously. Posting is skipped rather than left
 * broken when the page never resolves.
 */
export async function renderLinkPreviewForMessage(
  sourceMessage: Message,
  options: IPreviewRenderOptions,
): Promise<IPreviewRenderResult> {
  const deletedStuckReply = options.sweepStuckReplies
    ? await deleteStuckReply(sourceMessage)
    : false;

  if (options.skipWhenEmbedded && sourceMessage.embeds.length > 0) {
    return { status: "skipped-existing-embed", deletedStuckReply };
  }

  const url = extractFirstUrl(sourceMessage.content);
  if (!url) return { status: "no-url", deletedStuckReply };

  const { data, interstitial } = await fetchPreviewDataWithRetry(url);
  if (!data) {
    return {
      status: interstitial ? "still-interstitial" : "no-preview-data",
      deletedStuckReply,
      url,
    };
  }

  const { container, files } = await buildLinkPreviewContainer(data);
  const { components, flags } = buildContainerSend(container);
  await sourceMessage.reply({ components, flags, files });

  return { status: "rendered", deletedStuckReply, url };
}
