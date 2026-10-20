/**
 * How a hero works the farm: which bed it tends next, and how long it stays.
 *
 * A hero at the Farm used to stand on a grid position for as long as its
 * session kept publishing — a watering animation played at nobody. The farm
 * is the one building whose art has things to DO in it (fifteen tilled beds,
 * baked at known coordinates), so its heroes move between them: water a crop
 * for a few seconds, pick another, walk over, water that one.
 *
 * The choice is deliberately NOT seeded, unlike the scenery and road
 * generators. Those must be identical on every reload or the village appears
 * to rearrange itself; this is creature motion, in the same family as
 * `Critter`'s wandering — the whole point is that you can't predict it.
 */

/** Seconds a hero spends watering one bed before moving to another. */
const TEND_MIN_MS = 4500;
const TEND_MAX_MS = 11000;

/** How long until this hero moves to another bed. Re-rolled per hop, so a
 *  pair of farmers never falls into step. */
export function nextTendDelay(rand: () => number = Math.random): number {
  return TEND_MIN_MS + rand() * (TEND_MAX_MS - TEND_MIN_MS);
}

/**
 * Pick the next bed for a hero currently on `current` (null if it is walking
 * in from outside), avoiding beds other heroes have claimed — two farmers
 * standing in the same row would read as one hero with a rendering bug.
 *
 * Returns null when there is nowhere else to go: the hero stays where it is
 * rather than hopping in place. With more heroes than beds, whoever missed
 * out keeps trying on its own timer.
 */
export function pickBed(
  bedCount: number,
  taken: ReadonlySet<number>,
  current: number | null,
  rand: () => number = Math.random,
): number | null {
  const free: number[] = [];
  for (let i = 0; i < bedCount; i++) {
    if (i !== current && !taken.has(i)) free.push(i);
  }
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))]!;
}
