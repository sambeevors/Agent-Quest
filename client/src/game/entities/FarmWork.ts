import * as Phaser from 'phaser';
import type { HeroSprite } from './HeroSprite';
import { nextTendDelay, pickBed } from '../data/farm-work';

/**
 * The Farm's work roster: which hero is watering which bed, and when it moves
 * on to another.
 *
 * Every other building stations its heroes on a fixed grid, which is right —
 * they are queueing at a door. The farm is an enclosure with fifteen tilled
 * beds baked into its floor at known coordinates, so its heroes work it
 * instead: walk in through the gate to a bed, water it for a few seconds,
 * then cross to another. The hops are straight lines (`walkDirect`), because
 * the road graph would route a step between two beds out through the gate and
 * back in again.
 *
 * The roster is the only thing that decides where a farm hero stands, so it
 * owns the whole farm's positioning — `VillageScene.repositionBuilding`
 * hands the building over rather than laying out a grid.
 */
export class FarmWork {
  private readonly scene: Phaser.Scene;
  private readonly beds: ReadonlyArray<{ x: number; y: number }>;
  private readonly getHero: (heroId: string) => HeroSprite | undefined;
  private readonly onArrive: (heroId: string) => void;
  /** Bed index each worker has claimed — also what stops two sharing a row. */
  private readonly assigned = new Map<string, number>();
  private readonly timers = new Map<string, Phaser.Time.TimerEvent>();

  constructor(
    scene: Phaser.Scene,
    beds: ReadonlyArray<{ x: number; y: number }>,
    getHero: (heroId: string) => HeroSprite | undefined,
    onArrive: (heroId: string) => void,
  ) {
    this.scene = scene;
    this.beds = beds;
    this.getHero = getHero;
    this.onArrive = onArrive;
  }

  /**
   * Reconcile the roster with the heroes currently assigned to the farm.
   * Idempotent: a worker already at a bed keeps it (and its timer), so an
   * unrelated agent update doesn't restart everyone's watering.
   */
  setWorkers(heroIds: readonly string[]): void {
    const wanted = new Set(heroIds);
    for (const heroId of [...this.assigned.keys()]) {
      if (!wanted.has(heroId)) this.release(heroId);
    }
    for (const heroId of heroIds) {
      if (this.assigned.has(heroId)) continue;
      const hero = this.getHero(heroId);
      if (hero === undefined) continue;
      const bed = pickBed(this.beds.length, this.claimedBeds(), null);
      if (bed === null) continue; // More heroes than beds — try again next update.
      this.assigned.set(heroId, bed);
      // Entering from outside the fence, so this leg follows the roads and
      // passes through the gate like any other arrival.
      hero.moveTo(...this.standAt(hero, bed), hero.currentActivity, () => {
        this.onArrive(heroId);
        this.scheduleHop(heroId);
      });
    }
  }

  destroy(): void {
    for (const heroId of [...this.assigned.keys()]) this.release(heroId);
  }

  /** Where a hero stands to work `bed`: feet on the bed, so the crop shows
   *  below them rather than the hero straddling the row. */
  private standAt(hero: HeroSprite, bed: number): [number, number] {
    const spot = this.beds[bed]!;
    return [spot.x, spot.y - hero.footOffset];
  }

  private claimedBeds(): Set<number> {
    return new Set(this.assigned.values());
  }

  private release(heroId: string): void {
    this.assigned.delete(heroId);
    this.timers.get(heroId)?.remove();
    this.timers.delete(heroId);
  }

  /** Water the current bed for a few seconds, then cross to another. */
  private scheduleHop(heroId: string): void {
    this.timers.get(heroId)?.remove();
    this.timers.set(heroId, this.scene.time.delayedCall(nextTendDelay(), () => {
      this.timers.delete(heroId);
      const hero = this.getHero(heroId);
      const current = this.assigned.get(heroId);
      if (hero === undefined || current === undefined) return;
      const claimed = this.claimedBeds();
      claimed.delete(current);
      const bed = pickBed(this.beds.length, claimed, current);
      if (bed === null) {
        // Nowhere free right now (a busy farm); keep working this one.
        this.scheduleHop(heroId);
        return;
      }
      this.assigned.set(heroId, bed);
      hero.walkDirect(...this.standAt(hero, bed), hero.currentActivity, () => {
        this.scheduleHop(heroId);
      });
    }));
  }
}
