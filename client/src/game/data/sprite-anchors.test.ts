import { describe, expect, test } from 'bun:test';
import { spriteAnchors } from './sprite-anchors';
import { HERO_EXTENT, sunnysideTheme } from '../themes/sunnyside';

describe('spriteAnchors', () => {
  test('offsets are measured from the frame centre and scale with the sprite', () => {
    const a = spriteAnchors({ frameHeight: 64, headY: 20, footY: 39 }, 2);
    expect(a.headOffset).toBe(-24);
    expect(a.footOffset).toBe(14);
  });

  test('a Sunnyside hero stands ~11px below its centre, not at the frame bottom', () => {
    // The frame bottom is 51px below centre at heroScale 1.6. Feet there put
    // farmers ~40px above the bed they water and sorted heroes in front of
    // the trees they stood behind.
    const { headOffset, footOffset } = spriteAnchors(HERO_EXTENT, sunnysideTheme.heroScale);
    const frameHalf = (HERO_EXTENT.frameHeight / 2) * sunnysideTheme.heroScale;
    expect(footOffset).toBeGreaterThan(0);
    expect(footOffset).toBeLessThan(frameHalf / 2);
    // The head is well inside the frame too, so a name hung above it sits
    // on the hero rather than over the roof behind.
    expect(headOffset).toBeLessThan(0);
    expect(-headOffset).toBeLessThan(frameHalf / 2);
  });
});
