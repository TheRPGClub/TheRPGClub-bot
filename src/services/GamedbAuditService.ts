import { EmbedBuilder } from "discord.js";
import type { Client, TextBasedChannel } from "discord.js";
import axios from "axios";
import Game from "../classes/Game.js";
import { igdbService } from "./IGDB/IgdbService.js";

export type AutoAcceptResult = {
  updated: number;
  skipped: number;
  failed: number;
  logs: string[];
};

const MAX_LOG_CHARS = 3500;

async function performAutoAcceptImages(
  onProgress?: (line: string, processed: number) => Promise<void>,
  shouldStop?: () => boolean,
  titleWords?: string[],
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(true, false, false, false, titleWords);
  const candidates = games.filter((game) => !game.imageData && game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string, processed: number): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line, processed);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const game of candidates) {
    if (shouldStop?.()) {
      break;
    }
    processed += 1;
    let logged = false;
    try {
      if (!game.igdbId) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (Missing IGDB ID)`, processed);
        continue;
      }

      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details || !details.cover?.image_id) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB cover found)`, processed);
        continue;
      }

      const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const buffer = Buffer.from(resp.data);

      await Game.updateGameImage(game.id, buffer);
      updated++;
      logged = true;
      await addLog(`✅ Updated **${game.title}**`, processed);
    } catch (err: any) {
      failed++;
      logged = true;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`, processed);
    }

    if (!logged && onProgress) {
      await onProgress("", processed);
    }

    if (shouldStop?.()) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

async function performAutoAcceptVideos(
  onProgress?: (line: string, processed: number) => Promise<void>,
  shouldStop?: () => boolean,
  titleWords?: string[],
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(false, true, false, false, titleWords);
  const candidates = games.filter((game) => !game.featuredVideoUrl && game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string, processed: number): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line, processed);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const game of candidates) {
    if (shouldStop?.()) {
      break;
    }
    processed += 1;
    let logged = false;
    try {
      if (!game.igdbId) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (Missing IGDB ID)`, processed);
        continue;
      }

      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB details)`, processed);
        continue;
      }

      const videoUrl = Game.getFeaturedVideoUrl(details);
      if (!videoUrl) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB video found)`, processed);
        continue;
      }

      await Game.updateFeaturedVideoUrl(game.id, videoUrl);
      updated++;
      logged = true;
      await addLog(`✅ Updated **${game.title}**`, processed);
    } catch (err: any) {
      failed++;
      logged = true;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`, processed);
    }

    if (!logged && onProgress) {
      await onProgress("", processed);
    }

    if (shouldStop?.()) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

async function performAutoAcceptReleaseData(
  onProgress?: (line: string, processed: number) => Promise<void>,
  shouldStop?: () => boolean,
  titleWords?: string[],
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(false, false, false, true, titleWords);
  const candidates = games.filter((game) => game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string, processed: number): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line, processed);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const game of candidates) {
    if (shouldStop?.()) {
      break;
    }
    processed += 1;
    let logged = false;
    try {
      if (!game.igdbId) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (Missing IGDB ID)`, processed);
        continue;
      }

      const beforeCount = (await Game.getGameReleases(game.id)).length;
      await Game.importReleaseDatesFromIgdb(game.id, game.igdbId);
      const afterCount = (await Game.getGameReleases(game.id)).length;

      if (afterCount > beforeCount) {
        updated++;
        logged = true;
        await addLog(`✅ Updated **${game.title}**`, processed);
      } else {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB release dates found)`, processed);
      }
    } catch (err: any) {
      failed++;
      logged = true;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`, processed);
    }

    if (!logged && onProgress) {
      await onProgress("", processed);
    }

    if (shouldStop?.()) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

async function performAutoAcceptDescriptions(
  onProgress?: (line: string, processed: number) => Promise<void>,
  shouldStop?: () => boolean,
  titleWords?: string[],
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(false, false, true, false, titleWords);
  const candidates = games.filter((game) => !game.description && game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string, processed: number): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line, processed);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const game of candidates) {
    if (shouldStop?.()) {
      break;
    }
    processed += 1;
    let logged = false;
    try {
      if (!game.igdbId) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (Missing IGDB ID)`, processed);
        continue;
      }

      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details?.summary) {
        skipped++;
        logged = true;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB summary found)`, processed);
        continue;
      }

      await Game.updateGameDescription(game.id, details.summary);
      updated++;
      logged = true;
      await addLog(`✅ Updated **${game.title}**`, processed);
    } catch (err: any) {
      failed++;
      logged = true;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`, processed);
    }

    if (!logged && onProgress) {
      await onProgress("", processed);
    }

    if (shouldStop?.()) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

type AllAcceptStats = {
  images: { updated: number; skipped: number; failed: number };
  videos: { updated: number; skipped: number; failed: number };
  descriptions: { updated: number; skipped: number; failed: number };
  releases: { updated: number; skipped: number; failed: number };
  logs: string[];
};

async function performAutoAcceptAll(
  onProgress?: (line: string, processed: number) => Promise<void>,
  shouldStop?: () => boolean,
  titleWords?: string[],
): Promise<AllAcceptStats> {
  const games = await Game.getGamesForAudit(true, true, true, true, titleWords);
  const candidates = games.filter((game) => game.igdbId);

  const stats: AllAcceptStats = {
    images: { updated: 0, skipped: 0, failed: 0 },
    videos: { updated: 0, skipped: 0, failed: 0 },
    descriptions: { updated: 0, skipped: 0, failed: 0 },
    releases: { updated: 0, skipped: 0, failed: 0 },
    logs: [],
  };

  if (!candidates.length) {
    return stats;
  }

  const addLog = async (line: string, processed: number): Promise<void> => {
    stats.logs.push(line);
    if (onProgress) {
      await onProgress(line, processed);
    }
  };

  let processed = 0;

  for (const game of candidates) {
    if (shouldStop?.()) {
      break;
    }
    processed += 1;

    if (!game.igdbId) {
      stats.images.skipped++;
      stats.videos.skipped++;
      stats.descriptions.skipped++;
      stats.releases.skipped++;
      continue;
    }

    let details: Awaited<ReturnType<typeof igdbService.getGameDetails>> = null;
    try {
      details = await igdbService.getGameDetails(game.igdbId);
    } catch (err: any) {
      stats.images.failed++;
      stats.videos.failed++;
      stats.descriptions.failed++;
      stats.releases.failed++;
      await addLog(
        `❌ Failed **${game.title}**: IGDB fetch error: ${err?.message ?? String(err)}`,
        processed,
      );
      if (shouldStop?.()) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    if (!details) {
      stats.images.skipped++;
      stats.videos.skipped++;
      stats.descriptions.skipped++;
      stats.releases.skipped++;
      if (shouldStop?.()) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    const updates: string[] = [];
    const skips: string[] = [];
    const failures: string[] = [];

    // Image
    if (!game.imageData) {
      if (details.cover?.image_id) {
        try {
          const imageUrl =
            `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
          const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
          await Game.updateGameImage(game.id, Buffer.from(resp.data));
          stats.images.updated++;
          updates.push("image");
        } catch (err: any) {
          stats.images.failed++;
          failures.push(`image: ${err?.message ?? String(err)}`);
        }
      } else {
        stats.images.skipped++;
        skips.push("image");
      }
    }

    // Video
    if (!game.featuredVideoUrl) {
      const videoUrl = Game.getFeaturedVideoUrl(details);
      if (videoUrl) {
        try {
          await Game.updateFeaturedVideoUrl(game.id, videoUrl);
          stats.videos.updated++;
          updates.push("video");
        } catch (err: any) {
          stats.videos.failed++;
          failures.push(`video: ${err?.message ?? String(err)}`);
        }
      } else {
        stats.videos.skipped++;
        skips.push("video");
      }
    }

    // Description
    if (!game.description) {
      if (details.summary) {
        try {
          await Game.updateGameDescription(game.id, details.summary);
          stats.descriptions.updated++;
          updates.push("description");
        } catch (err: any) {
          stats.descriptions.failed++;
          failures.push(`description: ${err?.message ?? String(err)}`);
        }
      } else {
        stats.descriptions.skipped++;
        skips.push("description");
      }
    }

    // Release dates
    const releasesBefore = (await Game.getGameReleases(game.id)).length;
    try {
      await Game.importReleaseDatesFromIgdb(game.id, game.igdbId);
      const releasesAfter = (await Game.getGameReleases(game.id)).length;
      if (releasesAfter > releasesBefore) {
        stats.releases.updated++;
        updates.push("releases");
      } else {
        stats.releases.skipped++;
        skips.push("releases");
      }
    } catch (err: any) {
      stats.releases.failed++;
      failures.push(`releases: ${err?.message ?? String(err)}`);
    }

    if (updates.length || failures.length) {
      const parts: string[] = [];
      if (updates.length) parts.push(`✅ Updated: ${updates.join(", ")}`);
      if (failures.length) parts.push(`❌ Failed: ${failures.join("; ")}`);
      await addLog(`**${game.title}**: ${parts.join(" | ")}`, processed);
    }

    if (shouldStop?.()) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return stats;
}

function trimLogLines(lines: string[]): string[] {
  const copy = [...lines];
  let content = copy.join("\n");
  while (content.length > MAX_LOG_CHARS) {
    copy.shift();
    content = copy.join("\n");
  }
  return copy;
}

async function resolveTextChannel(
  client: Client,
  channelId: string,
): Promise<TextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }
  return channel as TextBasedChannel;
}

export async function runAutoAcceptImagesAudit(
  client: Client,
  channelId: string,
  titleWords?: string[],
): Promise<void> {
  const channel = await resolveTextChannel(client, channelId);
  if (!channel || typeof (channel as any).send !== "function") {
    return;
  }

  let currentEmbed = new EmbedBuilder()
    .setTitle("GameDB Auto Accept Images")
    .setDescription("Starting auto accept run...")
    .setColor(0x0099ff);

  let message = await (channel as any).send({ embeds: [currentEmbed] });
  let currentChunk = 0;
  let logLines: string[] = [];

  const updateEmbed = async (line?: string, processed?: number): Promise<void> => {
    if (processed && processed > 0) {
      const chunk = Math.floor((processed - 1) / 50);
      if (chunk !== currentChunk) {
        currentChunk = chunk;
        currentEmbed = new EmbedBuilder()
          .setTitle("GameDB Auto Accept Images")
          .setDescription("Processing...")
          .setColor(0x0099ff);
        message = await (channel as any).send({ embeds: [currentEmbed] });
        logLines = [];
      }
    }

    if (line) {
      logLines.push(line);
    }
    const trimmed = trimLogLines(logLines);
    const content = trimmed.length ? trimmed.join("\n") : "Processing...";
    currentEmbed.setDescription(content);
    await message.edit({ embeds: [currentEmbed] }).catch(() => {});
  };

  const { updated, skipped, failed, logs } = await performAutoAcceptImages(
    updateEmbed, undefined, titleWords,
  );
  if (!logs.length) {
    currentEmbed
      .setDescription("No games found with missing images and valid IGDB IDs.")
      .setColor(0x2ecc71);
    await message.edit({ embeds: [currentEmbed] }).catch(() => {});
    return;
  }

  const summary =
    `\n**Run Complete**\n✅ Updated: ${updated}\n` +
    `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
  await updateEmbed(summary);
  currentEmbed.setColor(0x2ecc71);
  await message.edit({ embeds: [currentEmbed] }).catch(() => {});
}

export function startGamedbAutoImageAuditService(
  client: Client,
  channelId: string,
  intervalMs: number,
  titleWords?: string[],
): void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runAutoAcceptImagesAudit(client, channelId, titleWords);
    } catch (err) {
      console.error("GameDB auto accept image audit failed:", err);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, intervalMs);
}

export {
  performAutoAcceptImages,
  performAutoAcceptVideos,
  performAutoAcceptReleaseData,
  performAutoAcceptDescriptions,
  performAutoAcceptAll,
};
export type { AllAcceptStats };
