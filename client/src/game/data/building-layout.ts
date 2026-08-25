import type { AgentActivity } from '../../types/agent';

export interface BuildingDef {
  id: string;
  label: string;
  activity: AgentActivity;
  x: number;
  y: number;
  imageKey: string;
  scale: number;
  description: string;
  toolCalls: string[];
}

/**
 * World is much larger (2800x1800) so we can render a thick decorative forest
 * around the village. The **interactive** village itself stays compact — all
 * buildings fit inside a ~1100×700 area centred at (1400, 720) — so every
 * functional target remains on-screen at default zoom.
 */
export const WORLD_WIDTH = 2800;
export const WORLD_HEIGHT = 1800;

/**
 * Main village clear-zone (no forest inside here). Forest fills everything
 * outside this ellipse, with a secondary clearing around the NPC hamlet.
 */
export const CITY_CLEAR = { x: 1400, y: 780, rx: 520, ry: 420 };

/** Plaza/fountain anchor — drives road hub & heroes' visual centre. */
export const PLAZA = { x: 1320, y: 790 };

/**
 * Organic, non-symmetric placement of the 8 functional buildings. Kept tight
 * (≈700×550 spread) so the whole interactive map is readable without zoom-out.
 */
export const BUILDING_DEFS: BuildingDef[] = [
  { id: 'library',    label: 'Library',    activity: 'reading',   x: 1060, y: 600,  imageKey: 'building-library',    scale: 0.52, description: 'Agents come here to read and search code',                toolCalls: ['Read', 'Grep', 'Glob'] },
  { id: 'alchemist',  label: 'Alchemist',  activity: 'debugging', x: 1210, y: 460,  imageKey: 'building-alchemist',  scale: 0.50, description: 'Agents come here to debug and fix errors',                toolCalls: ['(fixing after errors)'] },
  { id: 'castle',     label: 'Castle',     activity: 'thinking',  x: 1430, y: 430,  imageKey: 'building-castle',     scale: 0.46, description: 'Agents come here to think and reason',                    toolCalls: ['(AI thinking/planning)'] },
  { id: 'watchtower', label: 'Watchtower', activity: 'reviewing', x: 1650, y: 470,  imageKey: 'building-watchtower', scale: 0.42, description: 'Agents come here to review code and dispatch subagents',  toolCalls: ['Agent', 'review'] },
  { id: 'chapel',     label: 'Chapel',     activity: 'git',       x: 1790, y: 610,  imageKey: 'building-chapel',     scale: 0.38, description: 'Agents come here to commit and push code',                toolCalls: ['git commit', 'git push', 'git merge'] },
  { id: 'tavern',     label: 'Tavern',     activity: 'idle',      x: 1510, y: 810,  imageKey: 'building-tavern',     scale: 0.50, description: 'Agents rest here while waiting for user input',           toolCalls: ['(idle/waiting)'] },
  { id: 'forge',      label: 'Forge',      activity: 'editing',   x: 1150, y: 970,  imageKey: 'building-forge',      scale: 0.42, description: 'Agents come here to write and edit code',                 toolCalls: ['Edit', 'Write'] },
  { id: 'arena',      label: 'Arena',      activity: 'bash',      x: 1700, y: 970,  imageKey: 'building-arena',      scale: 0.42, description: 'Agents come here to run commands and tests',              toolCalls: ['Bash'] },
];

/** South gate — where heroes first spawn before walking into the village. */
export const VILLAGE_GATE = { x: 1400, y: 1130 };

/**
 * Small purple NPC village tucked into the NE forest, visually separated
 * from the main village by a strip of woods.
 */
export const NPC_VILLAGE = { x: 2420, y: 1430, radius: 180 };

/** Number of construction plots the yard provides. */
export const CONSTRUCTION_PLOT_COUNT = 6;

export interface VillageAnnexes {
  /** Plots for Linear construction sites, in placement order. */
  plots: Array<{ x: number; y: number }>;
  /**
   * Ground the hamlet stands on. Scenery inside this rect is suppressed so the
   * settlement sits in a clearing instead of having trees grow through it.
   */
  clearing: { x: number; y: number; w: number; h: number };
}

/**
 * Lay out the Linear hamlet — its own settlement WEST of the main village,
 * rather than plots wedged into the existing streets.
 *
 * It gets its own ground for two reasons. Slotting sites between the activity
 * buildings put them on top of the village's roads and ate the space heroes
 * walk through; and conceptually these are a different thing — projects, not
 * agent activity — so reading them as a separate settlement across the fields
 * is clearer than reading them as more village.
 *
 * Positions are RELATIVE to wherever the activity buildings actually ended up,
 * because the map editor lets users move every one of them. Anchoring to the
 * real bounding box keeps the hamlet a consistent distance to the west on any
 * map instead of stranding it in the forest or overlapping the village.
 *
 * The plots form a loose double row facing the village, which the desire-path
 * generator then threads with its own lanes and a track back east.
 */
export function computeVillageAnnexes(
  buildings: ReadonlyArray<{ x: number; y: number }>,
): VillageAnnexes {
  // No buildings (the scene can render a bare map) — fall back to the built-in
  // layout's bounds so the hamlet still lands somewhere sensible.
  const xs = buildings.length > 0 ? buildings.map((b) => b.x) : BUILDING_DEFS.map((b) => b.x);
  const ys = buildings.length > 0 ? buildings.map((b) => b.y) : BUILDING_DEFS.map((b) => b.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  /** Gap of open ground between the village edge and the hamlet. */
  const SEPARATION = 300;
  /** Spacing between the hamlet's two columns and its rows. */
  const COL_SPACING = 165;
  const ROW_SPACING = 135;
  /**
   * Sit the hamlet BELOW the village's midline. The Party Bar overlays the
   * top-left of the viewport, and a settlement tucked under it is a settlement
   * nobody can read.
   */
  const SOUTHWARD_BIAS = 90;
  const centreY = (minY + maxY) / 2 + SOUTHWARD_BIAS;

  // Right-hand column sits nearest the village; the hamlet grows westward.
  const eastCol = clamp(minX - SEPARATION, 200, WORLD_WIDTH - 200);
  const westCol = clamp(eastCol - COL_SPACING, 200, WORLD_WIDTH - 200);

  const plots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < CONSTRUCTION_PLOT_COUNT; i++) {
    const row = Math.floor(i / 2);
    // Stagger alternate rows so the hamlet reads as organic rather than
    // gridded, and so labels on neighbouring plots do not line up and collide.
    const stagger = row % 2 === 0 ? 0 : 26;
    plots.push({
      x: (i % 2 === 0 ? eastCol : westCol) + stagger,
      y: clamp(centreY - ROW_SPACING + row * ROW_SPACING, 200, WORLD_HEIGHT - 200),
    });
  }

  // The clearing wraps the plots with room for their labels above and the
  // lanes between them.
  const px = plots.map((pt) => pt.x);
  const py = plots.map((pt) => pt.y);
  const MARGIN_X = 130;
  const MARGIN_TOP = 190; // buildings and their labels are drawn upward from the door
  const MARGIN_BOTTOM = 90;
  const clearing = {
    x: Math.min(...px) - MARGIN_X,
    y: Math.min(...py) - MARGIN_TOP,
    w: Math.max(...px) - Math.min(...px) + MARGIN_X * 2,
    h: Math.max(...py) - Math.min(...py) + MARGIN_TOP + MARGIN_BOTTOM,
  };

  return { plots, clearing };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function getBuildingForActivity(activity: AgentActivity): BuildingDef {
  const building = BUILDING_DEFS.find((b) => b.activity === activity);
  return building ?? BUILDING_DEFS.find((b) => b.activity === 'idle')!;
}
