import { POKEMON_SHEET } from '../game/pokemon-sheet';

/**
 * What a partner has grown into by a given level, following FireRed's own
 * level-up evolutions (the bake's `evolutions`). Stones, trades and
 * friendship never come up, so those lines stop where they are.
 */

type Evolutions = Readonly<Record<string, { readonly level: number; readonly into: number }>>;

const EVOLUTIONS: Evolutions = POKEMON_SHEET.pokemon.evolutions;
const NAMES: Readonly<Record<string, string>> = POKEMON_SHEET.pokemon.names;

export function speciesAt(dex: number, level: number, evolutions: Evolutions = EVOLUTIONS): number {
  let out = dex;
  for (let evo = evolutions[out]; evo !== undefined && level >= evo.level; evo = evolutions[out]) {
    out = evo.into;
  }
  return out;
}

/** "Pidgeotto". Falls back to the dex number for a species the bake didn't name. */
export function speciesName(dex: number): string {
  return NAMES[dex] ?? `#${dex}`;
}
