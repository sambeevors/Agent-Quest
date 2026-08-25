/**
 * Fantasy names for the heroes on the map.
 *
 * A session's real identity — the Claude Code slug (`bubbly-waddling-cat`),
 * the project folder a Codex session runs in, or a subagent's descriptor
 * ("Explore") — reads like a log line rather than a villager, so every hero
 * gets a first name and a surname drawn from the two tables below.
 *
 * The name is DERIVED from the agent id rather than stored on `AgentState`:
 * that keeps it stable across page reloads and server restarts (unlike
 * `heroClass` / `heroColor`, which are round-robin counters in the server's
 * state manager and reshuffle when it restarts), needs no protocol change,
 * and lets the Activity Feed name an agent it no longer tracks.
 *
 * Names are labels only. Keep each part to ~10 characters — the canvas label
 * is 14px monospace and long ones overrun neighbouring heroes.
 */

/** Given names. 60 entries; paired with LAST_NAMES this is 3600 combinations. */
export const FIRST_NAMES = [
  'Aeric',   'Alrik',   'Ansel',   'Belisa',  'Briala',  'Bryn',
  'Caldis',  'Corvin',  'Cyrion',  'Dagna',   'Dorin',   'Eirwen',
  'Elowen',  'Emeric',  'Faelan',  'Fenric',  'Galen',   'Grimm',
  'Gwendra', 'Halric',  'Hesper',  'Hollis',  'Ilvara',  'Iselle',
  'Joreth',  'Jorvik',  'Kaelen',  'Kestrel', 'Lucan',   'Lyra',
  'Maeve',   'Merrick', 'Nolwen',  'Nyra',    'Orin',    'Ovric',
  'Peregrin','Perrin',  'Quillon', 'Rhoswen', 'Rowena',  'Sable',
  'Selwyn',  'Thalia',  'Torvald', 'Ulla',    'Ulric',   'Varek',
  'Vesper',  'Wren',    'Wystan',  'Xanthe',  'Yarrow',  'Yrsa',
  'Zephyr',  'Zorin',   'Aldric',  'Fyren',   'Marek',   'Sorrel',
] as const;

/** Surnames. Place-and-weather flavoured, to sound like the village they walk. */
export const LAST_NAMES = [
  'Ambergale', 'Ashvale',   'Barrowdim', 'Blackmoor', 'Briarwood', 'Cinderfen',
  'Coldhollow','Dawnholt',  'Deepmarsh', 'Duskbane',  'Elmshadow', 'Emberly',
  'Fairwater', 'Fellmere',  'Fernwhisp', 'Frostwind', 'Galewind',  'Glimmerlin',
  'Grimsong',  'Havenlock', 'Highfell',  'Hollowfen', 'Ironbark',  'Ironquill',
  'Juniper',   'Larkspire', 'Mistvale',  'Mossgrove', 'Nightbloom','Northgale',
  'Oakenshade','Oldenkeep', 'Pinewatch', 'Quarrow',   'Ravenmoor', 'Rookmantle',
  'Silverbeck','Stonebrook','Stormvale', 'Thistledew','Thornwake', 'Umbershaw',
  'Valeworth', 'Whitethorn','Windmere',  'Yewmantle', 'Ashenford', 'Brackwater',
  'Cloudreach','Drakemoor', 'Everwarden','Foxglove',  'Greyhallow','Hawthorne',
  'Loambrook', 'Marrowfen', 'Reedwhistle','Snowmantle','Wildergrove','Yarrowdale',
] as const;

/**
 * Avalanche step (murmur3's finalizer). Without it the two table indices are
 * badly correlated: session ids differ only in their tail, a plain rolling
 * hash barely disturbs the low bits, and `% 60` reads exactly those — 500
 * uuids landed on 158 names instead of ~465.
 */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over the id, finalised. Two seeds give two independent draws. */
function hash(value: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  return mix(h);
}

/** The hero name for an agent id — deterministic, so it never changes under a walking hero. */
export function heroNameFor(agentId: string): string {
  const first = FIRST_NAMES[hash(agentId, 0x811c9dc5) % FIRST_NAMES.length]!;
  const last = LAST_NAMES[hash(agentId, 0x2545f491) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}
