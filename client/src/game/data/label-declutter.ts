/**
 * Keep hero name labels from printing over each other — and keep a crowd's
 * names readable as belonging to someone.
 *
 * Heroes queue at a door on a grid narrower than a full fantasy name, so side
 * by side the names merge into one word ("Fernwhispnwhisp"). Lifting each
 * name until it cleared the rest (the first version of this) did stop the
 * overprinting, but a crowd of five rose into a column of rows over the roof
 * with nothing to say which name was whose.
 *
 * So labels are laid out per CROWD — a set of labels whose rest boxes touch,
 * directly or through a neighbour:
 *
 * - Rows fill nearest hero first (largest foot y), so the hero in front keeps
 *   its name lowest, closest to its head.
 * - A row takes names until one more would slide some name so far that its
 *   hero no longer stands under it (see HEAD_MARGIN); then a new row starts
 *   above. On the door grid a rank of three typical names fits in one row,
 *   so a crowd mostly stays at head height and rises only for long names.
 * - Within a row, names keep their heroes' left-to-right order and spread
 *   SIDEWAYS just enough to clear each other, each overlapping run centred on
 *   the mean of its heroes' x — so a name sits over its own hero wherever
 *   there is room, and no further from it than the run's width forces.
 *
 * A crowd whose finished layout collides with another crowd's is merged with
 * it and laid out again, so two crowds that brush against each other share
 * one tidy layout. The result is an offset per label; the sprite draws a thin
 * leader from any name moved off its hero back to the hero's head (see
 * `leaderSegment`). Pure and deterministic, so a crowd always lays out the
 * same way.
 */

export interface LabelBox {
  id: string;
  /** Horizontal centre of the label, world px. */
  x: number;
  /** Bottom edge of the label at rest (no lift), world px. */
  bottom: number;
  width: number;
  height: number;
  /** Placement order, highest first — the hero's foot y. */
  priority: number;
}

export interface LabelOffset {
  /** Sideways shift of the label's centre, world px (negative = left). */
  dx: number;
  /** How far the label is raised above its rest position, world px (≥ 0). */
  lift: number;
}

/** Minimum clear air between two rows of labels, world px. */
export const LABEL_GAP = 2;

/**
 * Minimum clear air between two names side by side, world px. Wider than the
 * row gap: names packed 2px apart in a row read as one sentence
 * ("Maeve Stormvale Belisa Umbershaw"); the eye needs about two word spaces
 * to see where one hero's name ends.
 */
export const NAME_SPACING = 8;

/**
 * How far inside either end of its name a hero must still stand after the
 * row is spread, world px. This is what keeps a name in a row readable as
 * its hero's without any line: the hero's head is under its own name, never
 * under the gap between two, or a neighbour's. Past it the row is full and
 * the next name starts a row above, where it gets a leader.
 */
export const HEAD_MARGIN = 8;

/** A leader shorter than this isn't drawn — the name already sits on its hero. */
export const LEADER_MIN_LENGTH = 6;

/** Leaders stop this far short of the name's edge and the hero's hair. */
const LEADER_END_GAP = 2;

/** The leader never starts closer than this to either end of the name. */
const LEADER_END_INSET = 8;

export interface Segment { x0: number; y0: number; x1: number; y1: number }

/**
 * The leader line from a placed name back to its hero's head, or null when
 * none is needed.
 *
 * It starts from the point on the name's bottom edge nearest the hero (inset
 * from the ends, so it never hangs off the last letter), not from the name's
 * centre: a row spread sideways leaves most heroes still standing under their
 * own name, and a line from the centre would just underline it. Measured
 * that way, a name over its own hero has no leader at all, and one only
 * appears where the layout has actually moved a name off its hero — lifted
 * into a row above, or slid past the end of it.
 */
export function leaderSegment(
  labelX: number,
  labelWidth: number,
  labelBottom: number,
  headX: number,
  headY: number,
): Segment | null {
  const inset = Math.min(LEADER_END_INSET, labelWidth / 2);
  const x0 = Math.min(Math.max(headX, labelX - labelWidth / 2 + inset), labelX + labelWidth / 2 - inset);
  const y0 = labelBottom + LEADER_END_GAP;
  // A name slid sideways at head height has its bottom edge level with the
  // hair: its leader runs across, not down.
  const y1 = Math.max(y0, headY - LEADER_END_GAP);
  if (Math.hypot(headX - x0, y1 - y0) < LEADER_MIN_LENGTH) return null;
  return { x0, y0, x1: headX, y1 };
}

interface Rect { left: number; right: number; top: number; bottom: number }

function restRect(b: LabelBox): Rect {
  return { left: b.x - b.width / 2, right: b.x + b.width / 2, top: b.bottom - b.height, bottom: b.bottom };
}

function placedRect(b: LabelBox, o: LabelOffset): Rect {
  const x = b.x + o.dx;
  const bottom = b.bottom - o.lift;
  return { left: x - b.width / 2, right: x + b.width / 2, top: bottom - b.height, bottom };
}

function collide(a: Rect, b: Rect, hgap: number, vgap: number): boolean {
  return a.left < b.right + hgap && b.left < a.right + hgap && a.top < b.bottom + vgap && b.top < a.bottom + vgap;
}

function byId(a: LabelBox, b: LabelBox): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Spread one row of labels sideways until none overlap, keeping their order.
 * The classic 1D cluster merge: every label starts as its own run centred on
 * its hero; any two adjacent runs that overlap fuse into one packed run,
 * centred where the summed squared displacement of its members is least
 * (the mean of their desired centres, less each one's offset in the pack).
 */
function spreadRow(row: LabelBox[], gap: number): Map<string, number> {
  const items = [...row].sort((a, b) => a.x - b.x || byId(a, b));
  interface Run { members: LabelBox[]; left: number; width: number }
  const runs: Run[] = [];
  const place = (members: LabelBox[]): Run => {
    // Pack left to right; `rel` is each member's centre relative to the left edge.
    let cursor = 0;
    let sum = 0;
    for (const m of members) {
      sum += m.x - (cursor + m.width / 2);
      cursor += m.width + gap;
    }
    const width = cursor - gap;
    return { members, left: sum / members.length, width };
  };
  for (const item of items) {
    runs.push(place([item]));
    // Fuse backwards while the newest run overlaps the one before it.
    while (runs.length > 1) {
      const last = runs[runs.length - 1]!;
      const prev = runs[runs.length - 2]!;
      if (prev.left + prev.width + gap <= last.left) break;
      runs.splice(runs.length - 2, 2, place([...prev.members, ...last.members]));
    }
  }
  const dx = new Map<string, number>();
  for (const run of runs) {
    let cursor = run.left;
    for (const m of run.members) {
      dx.set(m.id, cursor + m.width / 2 - m.x);
      cursor += m.width + gap;
    }
  }
  return dx;
}

/**
 * Lay out one crowd: nearest heroes first, each row taking names while every
 * hero in it still stands under its own name, each row spread sideways and
 * stacked just above the row beneath.
 */
function layoutCrowd(crowd: LabelBox[], gap: number, spacing: number, out: Map<string, LabelOffset>): void {
  if (crowd.length === 1) {
    out.set(crowd[0]!.id, { dx: 0, lift: 0 });
    return;
  }
  const order = [...crowd].sort((a, b) => b.priority - a.priority || a.x - b.x || byId(a, b));
  const fits = (row: LabelBox[], dx: Map<string, number>): boolean =>
    row.every((b) => Math.abs(dx.get(b.id) ?? 0) <= Math.max(0, b.width / 2 - HEAD_MARGIN));

  let ceiling = Infinity; // top of the row below, minus the gap
  let start = 0;
  while (start < order.length) {
    // Grow the row while it still fits; a lone name always does.
    let row = [order[start]!];
    let dx = spreadRow(row, spacing);
    for (let end = start + 1; end < order.length; end++) {
      const wider = order.slice(start, end + 1);
      const widerDx = spreadRow(wider, spacing);
      if (!fits(wider, widerDx)) break;
      row = wider;
      dx = widerDx;
    }
    // The row sits at the highest head among its members (so it covers none
    // of their faces) and never lower than just above the row beneath it.
    const bottom = Math.min(ceiling, ...row.map((b) => b.bottom));
    for (const b of row) out.set(b.id, { dx: dx.get(b.id) ?? 0, lift: b.bottom - bottom });
    ceiling = bottom - Math.max(...row.map((b) => b.height)) - gap;
    start += row.length;
  }
}

/** Offset for each label, by id ({0, 0} for one that already stands clear). */
export function declutterLabels(
  boxes: readonly LabelBox[],
  gap: number = LABEL_GAP,
  spacing: number = NAME_SPACING,
): Map<string, LabelOffset> {
  const sorted = [...boxes].sort(byId);
  const n = sorted.length;

  // Union-find over labels; crowds start as connected components of
  // touching rest boxes.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent[Math.max(ra, rb)] = Math.min(ra, rb);
    return true;
  };
  const rest = sorted.map(restRect);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (collide(rest[i]!, rest[j]!, spacing, gap)) union(i, j);
    }
  }

  // Lay out, then merge any two crowds whose layouts collide and go again.
  // Every pass that loops merges at least two crowds, so this ends within n.
  for (;;) {
    const crowds = new Map<number, LabelBox[]>();
    sorted.forEach((b, i) => {
      const root = find(i);
      const list = crowds.get(root);
      if (list === undefined) crowds.set(root, [b]);
      else list.push(b);
    });
    const out = new Map<string, LabelOffset>();
    for (const crowd of crowds.values()) layoutCrowd(crowd, gap, spacing, out);

    const placed = sorted.map((b) => placedRect(b, out.get(b.id)!));
    let merged = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (find(i) !== find(j) && collide(placed[i]!, placed[j]!, 0, 0) && union(i, j)) merged = true;
      }
    }
    if (!merged) return out;
  }
}
