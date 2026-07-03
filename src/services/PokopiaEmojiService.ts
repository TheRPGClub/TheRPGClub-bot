import type { Client } from "discord.js";
import { sleep } from "../utilities/DelayUtils.js";
import { logError, logInfo } from "../utilities/LogUtils.js";
import { resolveAssetPath } from "../functions/AssetPath.js";
import {
  getSortedHabitats,
  getSortedPokemon,
  pokedexNumberKey,
} from "../commands/pokopia/pokopia-data.service.js";

const POKEMON_EMOJI_PREFIX = "pkp_";
const HABITAT_EMOJI_PREFIX = "pkh_";
const LITTER_DROP_EMOJI_PREFIX = "pkl_";
const CREATION_THROTTLE_MS = 600;
const EMOJI_NAME_MAX = 32;

export interface IPokopiaEmoji {
  id: string;
  name: string;
}

const pokemonEmojiCache = new Map<string, IPokopiaEmoji>();
const habitatEmojiCache = new Map<string, IPokopiaEmoji>();
const litterDropEmojiCache = new Map<string, IPokopiaEmoji>();
let initialized = false;

function sanitizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildEmojiName(prefix: string, key: string, seen: Map<string, string>): string {
  const budget = EMOJI_NAME_MAX - prefix.length;
  const base = sanitizeKey(key).slice(0, budget) || "x";
  let candidate = `${prefix}${base}`;
  let suffixIndex = 1;
  while (seen.has(candidate) && seen.get(candidate) !== key) {
    const suffix = `_${suffixIndex}`;
    candidate = `${prefix}${base.slice(0, Math.max(0, budget - suffix.length))}${suffix}`;
    suffixIndex += 1;
  }
  seen.set(candidate, key);
  return candidate;
}

export function getPokemonEmoji(number: string): IPokopiaEmoji | null {
  return pokemonEmojiCache.get(pokedexNumberKey(number)) ?? null;
}

export function getHabitatEmoji(slug: string): IPokopiaEmoji | null {
  return habitatEmojiCache.get(slug) ?? null;
}

export function getLitterDropEmoji(image: string): IPokopiaEmoji | null {
  return litterDropEmojiCache.get(image) ?? null;
}

export async function startPokopiaEmojiService(client: Client): Promise<void> {
  if (initialized) return;
  initialized = true;
  syncPokopiaEmoji(client).catch((err) => {
    logError("PokopiaEmojiService.initialSync", err);
  });
}

async function syncPokopiaEmoji(client: Client): Promise<void> {
  const app = client.application;
  if (!app) {
    logError("PokopiaEmojiService", "client.application not available");
    return;
  }

  const existing = await app.emojis.fetch();
  const existingByName = new Map<string, string>();
  for (const [, emoji] of existing) {
    if (!emoji.name || !emoji.id) continue;
    existingByName.set(emoji.name, emoji.id);
  }

  const seenNames = new Map<string, string>();
  let created = 0;

  const uniquePokemon = new Map<string, string>();
  for (const pokemon of getSortedPokemon("number", "asc")) {
    uniquePokemon.set(pokedexNumberKey(pokemon.number), pokemon.sprite);
  }

  for (const [key, sprite] of uniquePokemon) {
    const name = buildEmojiName(POKEMON_EMOJI_PREFIX, key, seenNames);
    const existingId = existingByName.get(name);
    if (existingId) {
      pokemonEmojiCache.set(key, { id: existingId, name });
      continue;
    }
    try {
      const emoji = await app.emojis.create({
        attachment: resolveAssetPath("images", "pokopia", "pokedex", sprite),
        name,
      });
      if (emoji.id) {
        pokemonEmojiCache.set(key, { id: emoji.id, name });
        created += 1;
        await sleep(CREATION_THROTTLE_MS);
      }
    } catch (err) {
      logError("PokopiaEmojiService.createPokemonEmoji", err);
    }
  }

  const uniqueHabitats = new Map<string, string>();
  for (const habitat of getSortedHabitats("asc")) {
    uniqueHabitats.set(habitat.slug, habitat.image);
  }

  for (const [slug, image] of uniqueHabitats) {
    const name = buildEmojiName(HABITAT_EMOJI_PREFIX, slug, seenNames);
    const existingId = existingByName.get(name);
    if (existingId) {
      habitatEmojiCache.set(slug, { id: existingId, name });
      continue;
    }
    try {
      const emoji = await app.emojis.create({
        attachment: resolveAssetPath("images", "pokopia", "habitat_dex", image),
        name,
      });
      if (emoji.id) {
        habitatEmojiCache.set(slug, { id: emoji.id, name });
        created += 1;
        await sleep(CREATION_THROTTLE_MS);
      }
    } catch (err) {
      logError("PokopiaEmojiService.createHabitatEmoji", err);
    }
  }

  const uniqueLitterDrops = new Map<string, string>();
  for (const pokemon of getSortedPokemon("number", "asc")) {
    if (pokemon.litterDrop) uniqueLitterDrops.set(pokemon.litterDrop, pokemon.litterDrop);
  }

  for (const [image] of uniqueLitterDrops) {
    const key = image.replace(/\.[^.]+$/, "");
    const name = buildEmojiName(LITTER_DROP_EMOJI_PREFIX, key, seenNames);
    const existingId = existingByName.get(name);
    if (existingId) {
      litterDropEmojiCache.set(image, { id: existingId, name });
      continue;
    }
    try {
      const emoji = await app.emojis.create({
        attachment: resolveAssetPath("images", "pokopia", "litter_drop", image),
        name,
      });
      if (emoji.id) {
        litterDropEmojiCache.set(image, { id: emoji.id, name });
        created += 1;
        await sleep(CREATION_THROTTLE_MS);
      }
    } catch (err) {
      logError("PokopiaEmojiService.createLitterDropEmoji", err);
    }
  }

  logInfo(
    "PokopiaEmojiService",
    `Sync complete. Created ${created} emoji. `
      + `Pokemon cache: ${pokemonEmojiCache.size}, Habitat cache: ${habitatEmojiCache.size}, `
      + `Litter drop cache: ${litterDropEmojiCache.size}`,
  );
}
