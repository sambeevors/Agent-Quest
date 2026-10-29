import { describe, expect, it } from 'bun:test';
import { speciesAt, speciesName } from './evolution';

describe('speciesAt', () => {
  it('follows FireRed’s level-up line', () => {
    expect(speciesAt(16, 17)).toBe(16); // Pidgey
    expect(speciesAt(16, 18)).toBe(17); // Pidgeotto
    expect(speciesAt(16, 36)).toBe(18); // Pidgeot
  });

  it('never evolves by stone or trade', () => {
    expect(speciesAt(25, 100)).toBe(25); // Pikachu needs a Thunder Stone
    expect(speciesAt(64, 100)).toBe(64); // Kadabra needs a trade
  });

  it('every evolution the bake lists has its icon baked', async () => {
    const { POKEMON_SHEET } = await import('../game/pokemon-sheet');
    const baked = new Set<number>(POKEMON_SHEET.pokemon.partners);
    for (const evo of Object.values(POKEMON_SHEET.pokemon.evolutions)) expect(baked.has(evo.into)).toBe(true);
  });
});

describe('speciesName', () => {
  it('prints names the way the panels set them', () => {
    expect(speciesName(17)).toBe('Pidgeotto');
  });
});
