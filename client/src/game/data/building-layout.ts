import type { AgentActivity } from '../../types/agent';
import { TOWN_BUILDINGS } from '../town/town';

export interface BuildingDef {
  /** The activity slot's id — stable across the app (settings, panels). */
  id: string;
  /** What the place is called in Cerulean City. */
  label: string;
  activity: AgentActivity;
  description: string;
  toolCalls: string[];
}

/**
 * Which place in Cerulean City each activity sends a trainer to. Where they
 * stand there — and what the place is called — comes from the baked town
 * (`TOWN_BUILDINGS`); this table only says what each one is FOR.
 */
const SLOTS: Array<Omit<BuildingDef, 'label'>> = [
  { id: 'library',    activity: 'reading',   description: 'Trainers come here to read and search code',                 toolCalls: ['Read', 'Grep', 'Glob'] },
  { id: 'alchemist',  activity: 'debugging', description: 'Trainers come here to stock up and fix errors',              toolCalls: ['(fixing after errors)'] },
  { id: 'castle',     activity: 'thinking',  description: 'Trainers come here to think and plan',                       toolCalls: ['(AI thinking/planning)'] },
  { id: 'watchtower', activity: 'reviewing', description: 'Trainers come here to review code and dispatch subagents',   toolCalls: ['Agent', 'review'] },
  { id: 'farm',       activity: 'git',       description: 'Trainers tend the flowers here when committing and pushing', toolCalls: ['git commit', 'git push', 'git merge'] },
  { id: 'tavern',     activity: 'idle',      description: 'Trainers rest here while waiting for user input',            toolCalls: ['(idle/waiting)'] },
  { id: 'forge',      activity: 'editing',   description: 'Trainers come here to write and edit code',                  toolCalls: ['Edit', 'Write'] },
  { id: 'arena',      activity: 'bash',      description: 'Trainers battle here while running commands and tests',      toolCalls: ['Bash'] },
];

export const BUILDING_DEFS: BuildingDef[] = SLOTS.map((s) => {
  const place = TOWN_BUILDINGS[s.id];
  if (place === undefined) throw new Error(`town has no place for '${s.id}'`);
  return { ...s, label: place.label };
});

export function getBuildingForActivity(activity: AgentActivity): BuildingDef {
  const building = BUILDING_DEFS.find((b) => b.activity === activity);
  return building ?? BUILDING_DEFS.find((b) => b.activity === 'idle')!;
}
