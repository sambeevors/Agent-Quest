import type { FrameExtent } from '../themes/types';

/**
 * Where a centre-origin character sprite's head and feet are, as world-px
 * offsets from its position. Negative is up.
 *
 * Character frames are much taller than the figure drawn in them — a
 * Sunnyside hero is ~19 rows of a 64-row frame — so the frame's own edges
 * are no stand-in for either: hung off the frame top, a name floats ~35px
 * over the head; sorted on the frame bottom, a hero draws in front of a tree
 * it is standing behind.
 */
export interface SpriteAnchors {
  /** Centre → top of the head (hair included). */
  headOffset: number;
  /** Centre → ground line under the feet. */
  footOffset: number;
}

export function spriteAnchors(extent: FrameExtent, scale: number): SpriteAnchors {
  const mid = extent.frameHeight / 2;
  return {
    headOffset: (extent.headY - mid) * scale,
    footOffset: (extent.footY - mid) * scale,
  };
}
