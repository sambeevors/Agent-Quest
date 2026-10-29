import type { Tile } from './town';

/**
 * Who is standing where — the reservations that keep trainers from walking
 * through each other, the way FireRed characters never share a block.
 *
 * A trainer holds the tile its feet are on, and while it steps it also
 * holds the tile it is stepping onto; the step's end lets the old one go.
 * Before every step it claims the next tile, and if someone else holds it,
 * `onBlocked` says what to do about it:
 *
 * - **Someone standing still** (parked at a slot, working the flower bed) is
 *   in the way for good, so the walker goes round them at once.
 * - **Someone walking** is usually just crossing; the walker waits a beat
 *   for them to pass, and only goes round after a few beats of no progress.
 * - **Two walkers face to face**, each wanting the other's tile, would wait
 *   on each other forever: one of them — the lower id, so they never both
 *   sidestep into each other again — steps aside straight away.
 * - **Nothing works** (a packed bridge, a single-file path): after a while
 *   the walker steps through anyway. A trainer is never stranded.
 *
 * Partners are not counted: they trot at heel and wait at doors, and a
 * doorstep blocked by a waiting Pokémon would shut the building.
 */

/** A beat of waiting for the tile ahead to clear, in ms (plus jitter). */
export const YIELD_WAIT_MS = 180;
/** Beats of waiting behind a walker before trying to go round it. */
export const DETOUR_AFTER_WAITS = 3;
/** Beats of waiting, with no way round, before stepping through anyway. */
export const PUSH_THROUGH_AFTER_WAITS: Readonly<Record<'standing' | 'walking', number>> = {
  // A trainer standing still won't move out of the way; a short pause reads
  // as "excuse me" without holding the walker up.
  standing: 4,
  // A walking one will, given time — a queue filing out of the spawn.
  walking: 20,
};

export type BlockedAction = 'wait' | 'detour' | 'push';

const key = (t: Tile): number => (t[1] << 16) | t[0];

export class Traffic {
  private readonly holders = new Map<number, string>();
  private readonly held = new Map<string, Set<number>>();
  private readonly walking = new Set<string>();
  /** The tile each blocked walker is waiting to step onto. */
  private readonly wants = new Map<string, number>();

  /** Who holds a tile, if anyone. */
  holder(tile: Tile): string | undefined {
    return this.holders.get(key(tile));
  }

  /** Hold `tile` for `id`. False (and nothing changes) if another holds it. */
  claim(id: string, tile: Tile): boolean {
    const k = key(tile);
    const holder = this.holders.get(k);
    if (holder !== undefined && holder !== id) return false;
    this.holders.set(k, id);
    let mine = this.held.get(id);
    if (mine === undefined) {
      mine = new Set();
      this.held.set(id, mine);
    }
    mine.add(k);
    this.wants.delete(id);
    return true;
  }

  /** Let go of everything but `tile`, which `id` claims if it is free. */
  settle(id: string, tile: Tile): void {
    const k = key(tile);
    for (const h of [...(this.held.get(id) ?? [])]) {
      if (h !== k) this.drop(id, h);
    }
    this.claim(id, tile);
  }

  /** Let go of every tile — gone indoors, or gone from town. */
  release(id: string): void {
    for (const h of [...(this.held.get(id) ?? [])]) this.drop(id, h);
    this.held.delete(id);
    this.walking.delete(id);
    this.wants.delete(id);
  }

  setWalking(id: string, walking: boolean): void {
    if (walking) this.walking.add(id);
    else {
      this.walking.delete(id);
      this.wants.delete(id);
    }
  }

  /**
   * Tiles `id` should plan its route around: those held by anyone standing
   * still, and everything `also` holds (the walker in its way right now).
   */
  obstacles(id: string, also?: string): (tx: number, ty: number) => boolean {
    return (tx, ty) => {
      const holder = this.holders.get((ty << 16) | tx);
      if (holder === undefined || holder === id) return false;
      return holder === also || !this.walking.has(holder);
    };
  }

  /**
   * `id` wants to step onto `tile`, which someone else holds, and has already
   * waited `waits` beats for it. What now?
   */
  onBlocked(id: string, tile: Tile, waits: number): { action: BlockedAction; blocker: string } {
    const blocker = this.holders.get(key(tile))!;
    this.wants.set(id, key(tile));
    const standing = !this.walking.has(blocker);
    if (waits >= PUSH_THROUGH_AFTER_WAITS[standing ? 'standing' : 'walking']) {
      return { action: 'push', blocker };
    }
    const theirs = this.wants.get(blocker);
    const faceToFace = theirs !== undefined && this.held.get(id)?.has(theirs) === true;
    const goRound = standing
      || (faceToFace && id < blocker)
      || (waits > 0 && waits % DETOUR_AFTER_WAITS === 0);
    return { action: goRound ? 'detour' : 'wait', blocker };
  }

  private drop(id: string, k: number): void {
    if (this.holders.get(k) === id) this.holders.delete(k);
    this.held.get(id)?.delete(k);
  }
}
