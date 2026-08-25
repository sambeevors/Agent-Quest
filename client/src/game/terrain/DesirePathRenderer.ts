import * as Phaser from 'phaser';
import type { DesireNetwork, DesireRoad, Point } from '../data/desire-paths';

/**
 * Draws a generated desire-path network as worn ground.
 *
 * The obvious implementation — stroke the polyline with a thick line — is what
 * this replaces. A stroked line has a mathematically perfect edge and one flat
 * colour, so it reads as a shape laid *on* the map rather than ground that has
 * been walked bare. Instead each track is stamped out of overlapping discs of
 * jittered radius and colour, which gives it a ragged, uneven edge and mottled
 * fill, and then scattered with grit and tufts where the dirt meets the grass.
 *
 * Everything is driven by deterministic noise seeded from world coordinates,
 * so a track looks identical on every reload rather than shimmering.
 */

/** Width of the least- and most-travelled tracks, in world px. */
const MIN_WIDTH = 22;
const MAX_WIDTH = 46;

/**
 * Dirt tones, sampled per stamp. The spread is what stops the fill reading as
 * a single flat colour; they stay within a narrow warm band so it still reads
 * as one surface.
 */
const DIRT = [0x9C7F55, 0x8E7249, 0xA98C60, 0x876C45, 0x94794F] as const;
/** Damp, darker soil under the edges — seats the track into the ground. */
const DAMP = 0x4E3D28;
/** Bare, sun-bleached centre that only appears on well-used routes. */
const CORE = 0xBFA478;
/** Grit scattered along the margins. */
const GRIT = [0x7A6340, 0x6B5637, 0x8C7550] as const;
/** Grass tufts encroaching from the verge. */
const TUFT = [0x6E8F3C, 0x5F7F33, 0x7C9B46] as const;

/** Deterministic [0, 1) from a coordinate pair plus a salt. */
function noise(x: number, y: number, salt: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))]!;
}

/** Even samples along a polyline, with the tangent at each one. */
function walk(points: readonly Point[], step: number): Array<{ p: Point; nx: number; ny: number }> {
  const out: Array<{ p: Point; nx: number; ny: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const steps = Math.max(1, Math.round(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        p: { x: a.x + dx * t, y: a.y + dy * t },
        nx: -dy / len,
        ny: dx / len,
      });
    }
  }
  const last = points[points.length - 1];
  if (last !== undefined) out.push({ p: last, nx: 0, ny: 0 });
  return out;
}

function stampRoad(
  gDamp: Phaser.GameObjects.Graphics,
  gBody: Phaser.GameObjects.Graphics,
  gDetail: Phaser.GameObjects.Graphics,
  road: DesireRoad,
): void {
  const t = Math.min(1, Math.max(0, road.traffic));
  const width = lerp(MIN_WIDTH, MAX_WIDTH, t);
  const half = width / 2;
  const samples = walk(road.points, Math.max(4, width * 0.2));

  // Damp margin: a wider, softer disc under everything.
  gDamp.fillStyle(DAMP, 0.22);
  for (const { p } of samples) {
    const r = (half + 5) * (0.94 + noise(p.x, p.y, 1) * 0.16);
    gDamp.fillCircle(p.x, p.y, r);
  }

  // Body: the ragged edge comes from per-stamp radius jitter, the mottling
  // from per-stamp colour.
  for (const { p } of samples) {
    const wobble = 0.86 + noise(p.x, p.y, 2) * 0.26;
    gBody.fillStyle(pick(DIRT, noise(p.x, p.y, 3)), 0.95);
    gBody.fillCircle(p.x, p.y, half * wobble);
  }

  // Bare centre — only meaningful once a route is actually busy.
  if (t > 0.3) {
    const coreAlpha = (t - 0.3) / 0.7 * 0.5;
    for (const { p } of samples) {
      const r = half * 0.5 * (0.7 + noise(p.x, p.y, 4) * 0.5);
      gDetail.fillStyle(CORE, coreAlpha);
      gDetail.fillCircle(p.x, p.y, r);
    }
  }

  // Grit and encroaching tufts along the verge. Sampled sparsely so the detail
  // reads as texture rather than a dotted outline.
  for (let i = 0; i < samples.length; i++) {
    const { p, nx, ny } = samples[i]!;
    const roll = noise(p.x, p.y, 5);
    if (roll > 0.34) continue;
    const side = noise(p.x, p.y, 6) < 0.5 ? -1 : 1;
    const offset = half * (0.72 + noise(p.x, p.y, 7) * 0.5);
    const gx = p.x + nx * offset * side;
    const gy = p.y + ny * offset * side;
    if (roll < 0.17) {
      gDetail.fillStyle(pick(GRIT, noise(p.x, p.y, 8)), 0.5);
      gDetail.fillCircle(gx, gy, 1 + noise(p.x, p.y, 9) * 1.8);
    } else {
      gDetail.fillStyle(pick(TUFT, noise(p.x, p.y, 10)), 0.55);
      gDetail.fillCircle(gx, gy, 1.4 + noise(p.x, p.y, 11) * 2.2);
    }
  }
}

/**
 * Render the network into a container. Returns it so the caller can destroy
 * and rebuild when the set of buildings changes (a Linear sync, say).
 *
 * The three graphics layers are separate so that ALL damp margins sit beneath
 * ALL bodies. Drawn road-by-road instead, a later track's dark margin would
 * paint a seam across an earlier track it crosses.
 */
export function renderDesirePaths(
  scene: Phaser.Scene,
  network: DesireNetwork,
  depth = -400,
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0).setDepth(depth);
  const gDamp = scene.add.graphics();
  const gBody = scene.add.graphics();
  const gDetail = scene.add.graphics();

  // Least-used first, so a busy spine paints over the spurs feeding into it —
  // which is how the junction looks on the ground.
  const ordered = [...network.roads].sort((a, b) => a.traffic - b.traffic);
  for (const road of ordered) stampRoad(gDamp, gBody, gDetail, road);

  container.add([gDamp, gBody, gDetail]);
  return container;
}
