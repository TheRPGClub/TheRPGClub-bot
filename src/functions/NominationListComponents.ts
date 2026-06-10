import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import crypto from "node:crypto";
import Member from "../classes/Member.js";
import type { INominationEntry } from "../classes/Nomination.js";
import Game from "../classes/Game.js";
import { safeV2TextContent } from "./ComponentsV2Utils.js";
import { buildActionButton } from "./uiComponents.js";
import { composeVoteImage, type VoteImageType } from "../services/collageGenerator.js";
import { getUserEmojiString } from "../services/UserEmojiService.js";
import {
  getOrReplaceBackblazeImage,
  hasBackblazeB2Config,
} from "../services/BackblazeB2Service.js";
import { truncateWithEllipsis } from "../utilities/ValidationUtils.js";
import { logError } from "../utilities/LogUtils.js";

const MAX_SECTIONS_PER_CONTAINER = 10;
const MAX_REASON_LENGTH = 1500;
const MAX_SELECT_OPTIONS = 25;

export type NominationWindow = {
  closesAt: Date;
  nextVoteAt: Date;
  targetRound: number;
};

export type NominationListPayload = {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  files: AttachmentBuilder[];
};

export async function buildNominationListPayload(
  kindLabel: string,
  commandLabel: string,
  window: NominationWindow,
  nominations: INominationEntry[],
  altLayout: boolean,
  options?: { includeDetailSelect?: boolean },
): Promise<NominationListPayload> {
  const { files, voteImageUrl } = await buildNominationAttachments(
    kindLabel,
    window.targetRound,
    nominations,
  );
   
  const components = await buildNominationContainers(
    kindLabel,
    commandLabel,
    window,
    nominations,
    voteImageUrl,
    altLayout,
    options?.includeDetailSelect ?? true,
  );
  // eslint-disable-next-line local/dynamic-components-require-chunking
  return { components, files };
}

async function buildNominationContainers(
  kindLabel: string,
  commandLabel: string,
  window: NominationWindow,
  nominations: INominationEntry[],
  voteImageUrl: string | null,
  altLayout: boolean,
  includeDetailSelect: boolean,
): Promise<Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>> {
  const nominatorDisplayNames = await buildNominatorDisplayNames(nominations);
  const containers: ContainerBuilder[] = [];
  const headerContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(buildHeaderContent(kindLabel, window), 250),
    ),
  );
  containers.push(headerContainer);
  let container = new ContainerBuilder();
  void altLayout;
  addVoteImageToContainer(container, voteImageUrl);

  if (!nominations.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No nominations yet."),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(buildFooterContent(commandLabel, window), 1000),
      ),
    );
    return [...containers, container];
  }

  let sectionCount = 0;
  nominations.forEach((nomination) => {
    if (sectionCount >= MAX_SECTIONS_PER_CONTAINER) {
      containers.push(container);
      container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Continued"));
      sectionCount = 0;
    }
    addNominationContent(
      container,
      nomination,
      nominatorDisplayNames.get(nomination.userId) ?? nomination.userId,
    );
    sectionCount += 1;
  });

  containers.push(container);
  const lastContainer = containers[containers.length - 1];
  if (lastContainer) {
    lastContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeV2TextContent(buildFooterContent(commandLabel, window), 1000),
      ),
    );
  }
  const selectRows = includeDetailSelect ? buildNominationSelectRows(nominations, kindLabel) : [];
  return [...containers, ...selectRows];
}

function addNominationContent(
  container: ContainerBuilder,
  nomination: INominationEntry,
  displayName: string,
): void {
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      safeV2TextContent(buildNominationText(nomination), 1800),
    ),
  );
   
  let button = buildActionButton({ customId: `user-header-label:${nomination.userId}`, label: displayName, style: ButtonStyle.Secondary });
  const emojiString = getUserEmojiString(nomination.userId);
  if (emojiString) {
    const match = emojiString.match(/^<:([^:]+):(\d+)>$/);
    if (match) {
      button = button.setEmoji({ name: match[1], id: match[2] });
    }
  }
  section.setButtonAccessory(button);
  container.addSectionComponents(section);
}

function buildNominationText(nomination: INominationEntry): string {
  if (nomination.reason) {
    return `**${nomination.gameTitle}**\n> ${trimReason(nomination.reason)}`;
  }
  return `**${nomination.gameTitle}**\n-# *No reason provided.*`;
}

function buildHeaderContent(
  kindLabel: string,
  window: NominationWindow,
): string {
  return `## ${kindLabel} Nominations - Round ${window.targetRound}`;
}

function buildFooterContent(commandLabel: string, window: NominationWindow): string {
  const voteLabel = formatDate(window.nextVoteAt);
  return `-# Round ${window.targetRound} voting will open on ${voteLabel}. Nominate a game (or edit your existing nomination) with ${commandLabel}.`;
}

function buildNominationSelectRows(
  nominations: INominationEntry[],
  kindLabel: string,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = buildNominationSelectOptions(nominations);
  if (!options.length) {
    return [];
  }
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  for (let i = 0; i < options.length; i += MAX_SELECT_OPTIONS) {
    const slice = options.slice(i, i + MAX_SELECT_OPTIONS);
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildNominationSelectId(kindLabel, rows.length))
      .setPlaceholder("View a Nomination's details...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(slice);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  return rows;
}

function buildNominationSelectOptions(
  nominations: INominationEntry[],
): { label: string; value: string }[] {
  const seen = new Set<number>();
  const options: { label: string; value: string }[] = [];
  nominations.forEach((nomination) => {
    if (seen.has(nomination.gamedbGameId)) {
      return;
    }
    seen.add(nomination.gamedbGameId);
    options.push({
      label: truncateLabel(nomination.gameTitle, 100),
      value: nomination.gamedbGameId.toString(),
    });
  });
  return options;
}

function buildNominationSelectId(kindLabel: string, index: number): string {
  const prefix = kindLabel.toLowerCase() === "nr-gotm" ? "nr-gotm" : "gotm";
  return `${prefix}-nom-details:${index}`;
}

function truncateLabel(label: string, maxLength: number): string {
  return truncateWithEllipsis(label, maxLength);
}

function trimReason(reason: string): string {
  return truncateWithEllipsis(reason, MAX_REASON_LENGTH);
}

function formatDate(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

async function buildNominatorDisplayNames(
  nominations: INominationEntry[],
): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(nominations.map((nomination) => nomination.userId))];
  const records = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const member = await Member.getByUserId(userId).catch(() => null);
      const displayName = member?.globalName ?? member?.username ?? userId;
      return [userId, displayName] as const;
    }),
  );
  return new Map(records);
}

async function buildNominationAttachments(
  kindLabel: string,
  roundNumber: number,
  nominations: INominationEntry[],
): Promise<{
  files: AttachmentBuilder[];
  voteImageUrl: string | null;
}> {
  const files: AttachmentBuilder[] = [];
  const covers: Array<{ gameId: number; title: string; imageData: Buffer }> = [];
  const seen = new Set<number>();

  for (const nomination of nominations) {
    const gameId = nomination.gamedbGameId;
    if (!gameId || seen.has(gameId)) {
      continue;
    }
    seen.add(gameId);
    const game = await Game.getGameById(gameId);
    if (!game?.imageData) {
      continue;
    }
    covers.push({
      gameId,
      title: nomination.gameTitle,
      imageData: game.imageData,
    });
  }

  const voteImageUrl = await appendVoteImageAttachment(files, kindLabel, roundNumber, covers);
  return { files, voteImageUrl };
}

async function appendVoteImageAttachment(
  files: AttachmentBuilder[],
  kindLabel: string,
  roundNumber: number,
  covers: Array<{ gameId: number; title: string; imageData: Buffer }>,
): Promise<string | null> {
  const voteType = toVoteImageType(kindLabel);
  if (!voteType || !covers.length) {
    return null;
  }

  const sourceHash = buildNominationImageSourceHash(voteType, roundNumber, covers);
  if (hasBackblazeB2Config()) {
    try {
      const stored = await getOrReplaceBackblazeImage(
        `generated/noms/${voteType.toLowerCase()}/round-${roundNumber}`,
        sourceHash,
        () => composeVoteImage({
          roundNumber,
          voteType,
          covers,
        }),
      );
      return stored.url;
    } catch (error) {
      logError("NominationListComponents.backblazeUpload", error);
    }
  }

  const imageBuffer = await composeVoteImage({ roundNumber, voteType, covers });
  const filename = `noms_vote_${voteType.toLowerCase()}_round_${roundNumber}.png`;
  files.push(new AttachmentBuilder(imageBuffer, { name: filename }));
  return `attachment://${filename}`;
}

function toVoteImageType(kindLabel: string): VoteImageType | null {
  if (kindLabel === "GOTM" || kindLabel === "NR-GOTM") {
    return kindLabel;
  }
  return null;
}

function buildNominationImageSourceHash(
  voteType: VoteImageType,
  roundNumber: number,
  covers: Array<{ gameId: number; title: string; imageData: Buffer }>,
): string {
  const hash = crypto.createHash("sha256");
  // eslint-disable-next-line local/no-direct-interaction-response-methods
  hash.update(`type:${voteType}|round:${roundNumber}|count:${covers.length}|`);
  covers.forEach((cover) => {
    // eslint-disable-next-line local/no-direct-interaction-response-methods
    hash.update(`id:${cover.gameId}|title:${cover.title}|`);
    // eslint-disable-next-line local/no-direct-interaction-response-methods
    hash.update(cover.imageData);
  });
  return hash.digest("hex");
}

function addVoteImageToContainer(container: ContainerBuilder, voteImageUrl: string | null): void {
  if (!voteImageUrl) {
    return;
  }
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder()
        .setURL(voteImageUrl)
        .setDescription("Vote image"),
    ),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
  );
}
