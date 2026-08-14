// Post-build script (runs after vite build): writes the precache manifest and
// the service worker.
//
// The SW is generated here from scripts/sw.template.js rather than copied from
// public/, so its cache-name marker can be stamped with the git SHA and vite
// can never overwrite it. The browser only runs a service worker's install
// step when its bytes change; a byte-identical sw.js would never re-read the
// (new) precache manifest, so old hashed assets would stay cached forever —
// iOS standalone apps in particular.
import { execSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('../dist', import.meta.url)));
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));

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

// Stamp the SW version marker with the short git SHA (falling back to a build
// timestamp so offline/local builds still get a distinct version).
let sha = 'unknown';
try {
  sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  sha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
const swTemplate = await readFile(join(SCRIPT_DIR, 'sw.template.js'), 'utf8');
await writeFile(join(DIST, 'sw.js'), swTemplate.replaceAll('__COMMIT__', sha));
console.log(`sw.js: generated with version ${sha}`);
