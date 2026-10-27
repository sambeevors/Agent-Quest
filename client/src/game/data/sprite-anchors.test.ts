import { describe, expect, test } from 'bun:test';
import { spriteAnchors } from './sprite-anchors';
import { SPRITE_SCALE, TRAINER_EXTENT } from '../pokemon';

describe('spriteAnchors', () => {
  test('offsets are measured from the frame centre and scale with the sprite', () => {
    const a = spriteAnchors({ frameHeight: 64, headY: 20, footY: 39 }, 2);
    expect(a.headOffset).toBe(-24);
    expect(a.footOffset).toBe(14);
  });

  test('a trainer stands on the bottom of its 16x32 frame, like the overworld sprite it is', () => {
    const { headOffset, footOffset } = spriteAnchors(TRAINER_EXTENT, SPRITE_SCALE);
    const frameHalf = (TRAINER_EXTENT.frameHeight / 2) * SPRITE_SCALE;
    expect(footOffset).toBeGreaterThan(frameHalf * 0.8);
    expect(footOffset).toBeLessThanOrEqual(frameHalf);
    expect(headOffset).toBeLessThan(0);
  });
});
