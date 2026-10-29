import type { AgentActivity } from '../types/agent';
import type { UiIcon } from '../game/pokemon';

/**
 * What each station hands out for time spent there — Game Dev Tycoon's
 * research points, in FireRed's bag. The count is the metric: a pile of
 * Nuggets is time on Nugget Bridge running commands, a pile of Potions is
 * time waiting at the Pokémon Center for the user.
 *
 * Each item belongs to the place, not the tool, the same register the
 * trainers' chatter speaks in (game/data/hero-chatter.ts). The icons are
 * FireRed's own bag icons (`ITEM_ICONS` in the bake), bar the flower, which
 * is lifted off the flower bed itself.
 */
export interface StationItem {
  icon: UiIcon;
  name: string;
  plural: string;
  /** The place that hands it out. */
  place: string;
}

export const STATION_ITEMS: Record<AgentActivity, StationItem> = {
  reading: { icon: 'mail', name: 'Orange Mail', plural: 'Orange Mail', place: 'Trade House' },
  editing: { icon: 'bicycle', name: 'Bicycle', plural: 'Bicycles', place: 'Bike Shop' },
  thinking: { icon: 'spoon', name: 'Twisted Spoon', plural: 'Twisted Spoons', place: 'Badge House' },
  bash: { icon: 'nugget', name: 'Nugget', plural: 'Nuggets', place: 'Nugget Bridge' },
  git: { icon: 'flower', name: 'Flower', plural: 'Flowers', place: 'Flower Bed' },
  debugging: { icon: 'antidote', name: 'Antidote', plural: 'Antidotes', place: 'Poké Mart' },
  reviewing: { icon: 'tm', name: 'TM', plural: 'TMs', place: 'Cerulean Gym' },
  idle: { icon: 'potion', name: 'Potion', plural: 'Potions', place: 'Pokémon Center' },
};

/** Bag order: the work first, the waiting last. */
export const STATION_ORDER: readonly AgentActivity[] = [
  'reading', 'editing', 'thinking', 'bash', 'git', 'debugging', 'reviewing', 'idle',
];

export function itemLabel(activity: AgentActivity, count: number): string {
  const item = STATION_ITEMS[activity];
  return count === 1 ? item.name : item.plural;
}

/** Station time as the Bag shows it: "3h 12m", "12m", "<1m". */
export function formatStationTime(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
