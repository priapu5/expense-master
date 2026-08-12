// Post-build: list every file in dist/ (except sw.js and the manifest itself)
// so the service worker can precache the app shell. Paths are relative to the
// SW's location so the app works at any sub-path (GitHub Pages, LAN, etc.).
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('../dist', import.meta.url)));

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = (await walk(DIST)).filter(
  (f) => !f.endsWith('precache-manifest.json') && !f.endsWith('sw.js'),
);
const list = files.map((f) => './' + relative(DIST, f).split(sep).join('/'));
await writeFile(join(DIST, 'precache-manifest.json'), JSON.stringify(list, null, 2));
console.log(`precache-manifest.json: ${list.length} files`);
