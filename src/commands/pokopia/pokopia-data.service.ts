import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const DATA_ROOT = resolve(fileURLToPath(new URL("../../../src/data/pokopia", import.meta.url)));

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_ROOT, filename), "utf8")) as T;
}

export type PokopiaSortField = "name" | "number";
export type PokopiaSortOrder = "asc" | "desc";

export interface IPokopiaPokemon {
  number: string;
  sprite: string;
  name: string;
  ability1: string;
  ability2: string;
  home: string;
  litterDrop: string | null;
  habitat1Image: string;
  habitat1Details: string;
  habitat2Image: string;
  habitat2Details: string;
  favorites: string[];
}

export interface IPokopiaHabitatPokemonRef {
  number: string;
  name: string;
  sprite: string;
}

export interface IPokopiaHabitat {
  habitat: string;
  slug: string;
  image: string;
  items: string[];
  pokemon: IPokopiaHabitatPokemonRef[];
}

const POKEMON: IPokopiaPokemon[] = loadJson<IPokopiaPokemon[]>("pokemon.json");
const HABITATS: IPokopiaHabitat[] = loadJson<IPokopiaHabitat[]>("habitats.json");

const pokemonByNumber = new Map<string, IPokopiaPokemon>(
  POKEMON.map((p) => [pokedexNumberKey(p.number), p]),
);
const habitatBySlug = new Map<string, IPokopiaHabitat>(
  HABITATS.map((h) => [h.slug, h]),
);

export function pokedexNumberKey(number: string): string {
  return number.replace("#", "").trim();
}

function pokedexSortNumber(number: string): number {
  const match = number.match(/\d+/);
  return match ? Number(match[0]) : Infinity;
}

export function getPokemonByNumber(number: string): IPokopiaPokemon | undefined {
  return pokemonByNumber.get(pokedexNumberKey(number));
}

export function getHabitatBySlug(slug: string): IPokopiaHabitat | undefined {
  return habitatBySlug.get(slug);
}

export function getSortedPokemon(
  sort: PokopiaSortField,
  order: PokopiaSortOrder,
): IPokopiaPokemon[] {
  const sorted = [...POKEMON].sort((a, b) => {
    if (sort === "number") {
      return pokedexSortNumber(a.number) - pokedexSortNumber(b.number);
    }
    return a.name.localeCompare(b.name);
  });
  return order === "desc" ? sorted.reverse() : sorted;
}

export function getSortedHabitats(order: PokopiaSortOrder): IPokopiaHabitat[] {
  const sorted = [...HABITATS].sort((a, b) => a.habitat.localeCompare(b.habitat));
  return order === "desc" ? sorted.reverse() : sorted;
}
