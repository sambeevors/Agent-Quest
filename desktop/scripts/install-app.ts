import { cp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Copy the packaged app into /Applications, replacing any previous install.
 * A login item points at the app's path, so it has to live somewhere stable
 * rather than in this repo's `release/` folder, which every package rebuilds.
 */
const APP = 'PokeAgent.app';
// Earlier bundles, replaced rather than left beside this one: the app before
// the rebrand, and the first PokéAgent build, whose é crashed it at launch.
const LEGACY = [
  { app: 'Agent Quest.app', id: 'com.agentquest.desktop' },
  { app: 'PokéAgent.app', id: 'com.pokeagent.desktop' },
];
const release = resolve(import.meta.dir, '..', 'release');

const builds = (await readdir(release)).filter((d) => d.startsWith('mac'));
const build = builds.find((d) => d === `mac-${process.arch}`) ?? builds[0];
if (build === undefined) throw new Error(`No mac build in ${release} — run \`bun run package\` first.`);

const dest = join('/Applications', APP);
// Quit a running copy first, or it keeps the old binary and holds :4444.
// By bundle id, and only if running, so a missing app never raises a
// "Where is…?" dialog.
for (const id of new Set(['com.pokeagent.desktop', ...LEGACY.map((l) => l.id)])) {
  Bun.spawnSync(['osascript', '-e', `if application id "${id}" is running then tell application id "${id}" to quit`]);
}
// Quitting is asynchronous. Wait it out, or the copy opened below hands
// itself to the dying one through the single-instance lock and exits.
for (let i = 0; i < 40 && Bun.spawnSync(['pgrep', '-f', '/Applications/.*\\.app/Contents/MacOS/(PokeAgent|PokéAgent|Agent Quest)$']).exitCode === 0; i++) {
  await Bun.sleep(250);
}
await rm(dest, { recursive: true, force: true });
for (const l of LEGACY) await rm(join('/Applications', l.app), { recursive: true, force: true });
await cp(join(release, build, APP), dest, { recursive: true, verbatimSymlinks: true });
console.log(`Installed ${dest}`);
Bun.spawnSync(['open', dest]);
