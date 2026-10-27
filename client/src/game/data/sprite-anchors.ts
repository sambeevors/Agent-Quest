import type { FrameExtent } from '../pokemon';

/**
 * Where a centre-origin character sprite's head and feet are, as world-px
 * offsets from its position. Negative is up.
 *
 * Measured off the art rather than assumed from the frame: a party icon's
 * Pokémon sits a few rows above its 32px frame's bottom, and a trainer with a
 * hat reaches the very top of its frame where a bare head stops short.
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
