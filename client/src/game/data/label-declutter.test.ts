import { describe, expect, test } from 'bun:test';
import { declutterLabels, HEAD_MARGIN, LABEL_GAP, NAME_SPACING, leaderSegment, type LabelBox, type LabelOffset } from './label-declutter';

/** A typical hero name, world px ("Maeve Stormvale" measures ~95). */
const NAME_W = 96;
const NAME_H = 18;
/** Door-grid spacing, as VillageScene stands a crowd. */
const SPACING_X = 68;
const SPACING_Y = 36;

function box(id: string, x: number, footY: number, width = NAME_W): LabelBox {
  // Label bottom sits ~30px above the feet, as a hero's name does.
  return { id, x, bottom: footY - 30, width, height: NAME_H, priority: footY };
}

function rect(b: LabelBox, o: LabelOffset) {
  const x = b.x + o.dx;
  const bottom = b.bottom - o.lift;
  return { x, left: x - b.width / 2, right: x + b.width / 2, top: bottom - b.height, bottom };
}

function placedRects(boxes: LabelBox[], offsets: Map<string, LabelOffset>) {
  return boxes.map((b) => rect(b, offsets.get(b.id)!));
}

function overlaps(a: ReturnType<typeof rect>, b: ReturnType<typeof rect>): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function expectNoOverlaps(boxes: LabelBox[], offsets: Map<string, LabelOffset>): void {
  const placed = placedRects(boxes, offsets);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
    }
  }
}

/** A crowd standing on the door grid, laid out as calcGridPositions does. */
function doorCrowd(count: number, doorX = 0, doorY = 100): LabelBox[] {
  const cols = Math.ceil(Math.sqrt(count));
  const offsetX = ((cols - 1) * SPACING_X) / 2;
  const boxes: LabelBox[] = [];
  for (let i = 0; i < count; i++) {
    boxes.push(box(`h${i}`, doorX - offsetX + (i % cols) * SPACING_X, doorY + Math.floor(i / cols) * SPACING_Y));
  }
  return boxes;
}

describe('declutterLabels', () => {
  test('labels already clear of each other are not moved', () => {
    const boxes = [box('a', 0, 100), box('b', 400, 100)];
    const offsets = declutterLabels(boxes);
    expect(offsets.get('a')).toEqual({ dx: 0, lift: 0 });
    expect(offsets.get('b')).toEqual({ dx: 0, lift: 0 });
  });

  test('two heroes side by side spread their names sideways, not upwards', () => {
    const boxes = [box('a', 0, 100), box('b', SPACING_X, 100)];
    const offsets = declutterLabels(boxes);
    expectNoOverlaps(boxes, offsets);
    expect(offsets.get('a')!.lift).toBe(0);
    expect(offsets.get('b')!.lift).toBe(0);
    // Symmetric about the pair's midpoint, each pushed out by the same amount.
    const a = offsets.get('a')!.dx;
    const b = offsets.get('b')!.dx;
    expect(a).toBeLessThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a + b).toBeCloseTo(0, 6);
    // Exactly far enough apart to clear by the name spacing — no further.
    expect(SPACING_X + b - a).toBeCloseTo(NAME_W + NAME_SPACING, 6);
  });

  test('names keep their heroes’ left-to-right order', () => {
    const boxes = [box('l', 0, 100), box('m', 30, 100), box('r', 60, 100), box('rr', 90, 100)];
    const placed = placedRects(boxes, declutterLabels(boxes));
    for (let i = 1; i < placed.length; i++) {
      // Same row ⇒ strictly ordered; another row ⇒ order doesn't matter.
      if (placed[i]!.bottom === placed[i - 1]!.bottom) {
        expect(placed[i]!.x).toBeGreaterThan(placed[i - 1]!.x);
      }
    }
  });

  for (const count of [2, 3, 4, 5, 6, 9]) {
    test(`a crowd of ${count} at one door: no overlaps, lift capped at ~√n rows`, () => {
      const boxes = doorCrowd(count);
      const offsets = declutterLabels(boxes);
      expectNoOverlaps(boxes, offsets);
      const rows = Math.ceil(Math.sqrt(count));
      // Each label rises at most (rows - 1) label rows above its own head —
      // the old greedy stack rose up to (count - 1).
      for (const o of offsets.values()) expect(o.lift).toBeLessThanOrEqual((rows - 1) * (NAME_H + LABEL_GAP));
    });
  }

  test('a crowd of five reads as rows, not a column', () => {
    const boxes = doorCrowd(5);
    const placed = placedRects(boxes, declutterLabels(boxes));
    const rowBottoms = new Set(placed.map((p) => p.bottom));
    expect(rowBottoms.size).toBeLessThanOrEqual(2);
  });

  test('every hero in a door crowd stands under its own name', () => {
    for (const count of [2, 3, 4, 5, 6, 9]) {
      const boxes = doorCrowd(count);
      const offsets = declutterLabels(boxes);
      for (const b of boxes) {
        const r = rect(b, offsets.get(b.id)!);
        expect(b.x).toBeGreaterThanOrEqual(r.left + HEAD_MARGIN - 1e-9);
        expect(b.x).toBeLessThanOrEqual(r.right - HEAD_MARGIN + 1e-9);
      }
    }
  });

  test('a door crowd of typical names never leaves head height', () => {
    // Each rank of the grid fits its names in one row, so nothing is lifted.
    for (const count of [2, 4, 6, 9]) {
      for (const o of declutterLabels(doorCrowd(count)).values()) expect(o.lift).toBe(0);
    }
  });

  test('names too long to share a row rise into the row above', () => {
    const boxes = [box('a', 0, 100, 160), box('b', SPACING_X, 100, 160), box('c', 2 * SPACING_X, 100, 160)];
    const offsets = declutterLabels(boxes);
    expectNoOverlaps(boxes, offsets);
    expect([...offsets.values()].some((o) => o.lift > 0)).toBe(true);
  });

  test('the hero nearest the viewer keeps its name on its head', () => {
    const boxes = [box('back', 0, 100), box('front', 10, 120)];
    const offsets = declutterLabels(boxes);
    expect(offsets.get('front')!.lift).toBe(0);
    expectNoOverlaps(boxes, offsets);
  });

  test('labels only ever rise', () => {
    const boxes = [box('a', 0, 100), box('b', 30, 110), box('c', 60, 90), ...doorCrowd(7, 300)];
    for (const o of declutterLabels(boxes).values()) expect(o.lift).toBeGreaterThanOrEqual(0);
  });

  test('two crowds whose layouts collide are merged and still clear each other', () => {
    // Two door crowds close enough that their spread names would meet.
    const boxes = [
      ...doorCrowd(4, 0).map((b) => ({ ...b, id: `w${b.id}` })),
      ...doorCrowd(4, 180).map((b) => ({ ...b, id: `e${b.id}` })),
    ];
    expectNoOverlaps(boxes, declutterLabels(boxes));
  });

  test('names of different widths still clear each other', () => {
    const boxes = [box('a', 0, 100, 60), box('b', 20, 100, 150), box('c', 40, 100, 90)];
    expectNoOverlaps(boxes, declutterLabels(boxes));
  });

  test('deterministic whatever order the heroes are listed in', () => {
    const boxes = doorCrowd(6);
    const forward = declutterLabels(boxes);
    const reverse = declutterLabels([...boxes].reverse());
    const key = (m: Map<string, LabelOffset>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    expect(key(reverse)).toEqual(key(forward));
  });
});

describe('leaderSegment', () => {
  // A 120px name whose bottom edge sits at y=50, hero's hair at y=70.
  test('a name over its own hero needs no leader', () => {
    expect(leaderSegment(0, 120, 70, 0, 70)).toBeNull();
    // Slid sideways, but the hero still stands under the name's span.
    expect(leaderSegment(40, 120, 70, 0, 70)).toBeNull();
  });

  test('a name lifted into a row above gets a vertical leader to its own head', () => {
    const seg = leaderSegment(10, 120, 50, 0, 70)!;
    expect(seg).not.toBeNull();
    expect(seg.x0).toBe(0);
    expect(seg.x1).toBe(0);
    expect(seg.y0).toBeGreaterThan(50);
    expect(seg.y1).toBeLessThan(70);
  });

  test('a name slid past its hero leads from its nearest end, never its centre', () => {
    const seg = leaderSegment(100, 120, 50, 0, 70)!;
    expect(seg).not.toBeNull();
    expect(seg.x0).toBeGreaterThan(100 - 60); // within the name
    expect(seg.x0).toBeLessThan(100); // on the hero's side of its centre
    expect(seg.x1).toBe(0);
  });

  test('a name slid past its hero at head height still gets a leader', () => {
    const seg = leaderSegment(100, 120, 70, 0, 70);
    expect(seg).not.toBeNull();
    expect(seg!.x0).toBeLessThan(100);
  });
});
