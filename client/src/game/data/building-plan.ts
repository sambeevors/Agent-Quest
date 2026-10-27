import { DESIRE_JITTER, gateNode, type DesireNode, type Point, type Rect } from './desire-paths';
import { drawnRoadReach } from './path-tiles';

/**
 * How the village's standing structures become road-routing input.
 *
 * Shared by `VillageScene.rebuildRoads()` and the tests that lay out the
 * shipped map without Phaser, so the two can never disagree about where a
 * road is allowed to go.
 *
 * Pure — no Phaser.
 */

/**
 * A structure the roads must keep off: an activity building.
 */
export interface RoadSite {
  id: string;
  /** Where its track ends — just outside the door. */
  door: Point;
  /** Ground the drawn road may not touch, in world space. */
  keepOut: Rect;
}

/**
 * The sprite's drawn rect from its bottom-centre anchor — every structure in
 * the village is placed by the middle of its ground line.
 *
 * This IS the road keep-out, deliberately the whole sprite rather than a
 * ground band. Measured off the baked art, the halls' walls run 81–100% of
 * the image width right down to the ground (forge, tavern, castle and
 * alchemist edge to edge), so a narrower band let tracks run under the
 * corners of the walls; and a road allowed behind the upper storey shows as
 * dirt poking out past the eaves and over the roof line, since roads draw
 * beneath every sprite. `sunnyside.test.ts` pins that each baked building's
 * opaque pixels really do fill its image, so the image rect is honest.
 */
export function spriteRect(x: number, y: number, w: number, h: number): Rect {
  return { x: x - w / 2, y: y - h, w, h };
}

/**
 * How far a track's CENTRELINE must keep from a keep-out rect so that no
 * drawn tile touches it: the rasteriser's reach, plus the organic wobble the
 * centreline may still take after routing, plus a hair so a tile edge never
 * sits flush against a wall.
 */
export function roadClearance(cell: number): number {
  return drawnRoadReach(cell) + DESIRE_JITTER + 2;
}

/**
 * Every door meets the network on a straight lead running due south, from
 * just outside the building's clearance ring up to the door. Left to the
 * router, the last leg into a door arrives diagonally from a ring corner, so
 * the track's drawn width sweeps along the bottom of the wall beside the
 * doorway; a lead brings the road in square, and the only dirt under the
 * building is the doorstep itself.
 */
export function doorLead(site: RoadSite, clearance: number): Point {
  return { x: site.door.x, y: site.keepOut.y + site.keepOut.h + clearance + 1 };
}

/**
 * The part of a sprite its own door lead may draw under: the doorstep. The
 * lead ends at the door, just below the sprite, and its drawn cells reach up
 * to one road reach either side of and above that point — the door art draws
 * over them. Nothing else of the keep-out may carry road.
 */
export function doorApproach(site: RoadSite, cell: number): Rect {
  const reach = drawnRoadReach(cell);
  const bottom = site.keepOut.y + site.keepOut.h;
  return { x: site.door.x - reach, y: bottom - reach, w: reach * 2, h: reach };
}

export interface RoadPlan {
  nodes: DesireNode[];
  obstacles: Rect[];
  clearance: number;
}

/** Routing input for the whole village: every site plus the jetty gate. */
export function planRoads(sites: readonly RoadSite[], spawn: Point, cell: number): RoadPlan {
  const clearance = roadClearance(cell);
  const nodes: DesireNode[] = sites.map((s) => ({
    id: s.id,
    x: s.door.x,
    y: s.door.y,
    lead: doorLead(s, clearance),
  }));
  // The gate is where heroes arrive, so it needs a track even though nothing
  // stands there. It is the bank end of the lake's jetty, and the road must
  // meet the deck head-on and square — see gateNode.
  nodes.push(gateNode(spawn, cell));
  return { nodes, obstacles: sites.map((s) => s.keepOut), clearance };
}
