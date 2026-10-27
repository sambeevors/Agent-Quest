import { cp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Copy the packaged app into /Applications, replacing any previous install.
 * A login item points at the app's path, so it has to live somewhere stable
 * rather than in this repo's `release/` folder, which every package rebuilds.
 */
const APP = 'PokéAgent.app';
// The app's name before the rebrand: replaced, not left beside the new one.
const LEGACY_APP = 'Agent Quest.app';
const release = resolve(import.meta.dir, '..', 'release');

const builds = (await readdir(release)).filter((d) => d.startsWith('mac'));
const build = builds.find((d) => d === `mac-${process.arch}`) ?? builds[0];
if (build === undefined) throw new Error(`No mac build in ${release} — run \`bun run package\` first.`);

const dest = join('/Applications', APP);
// Quit a running copy first, or it keeps the old binary and holds :4444.
for (const name of ['PokéAgent', 'Agent Quest']) {
  Bun.spawnSync(['osascript', '-e', `tell application "${name}" to quit`]);
}
await rm(dest, { recursive: true, force: true });
await rm(join('/Applications', LEGACY_APP), { recursive: true, force: true });
await cp(join(release, build, APP), dest, { recursive: true, verbatimSymlinks: true });
console.log(`Installed ${dest}`);
Bun.spawnSync(['open', dest]);
