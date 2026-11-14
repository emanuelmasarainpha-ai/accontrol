// =============================================================================
// Genera precache.json: la lista de archivos que el Service Worker guarda para
// que ACCONTROL abra SIN conexión. Se ejecuta solo al iniciar `npm start`.
// Si publicas la app en un hosting estático, ejecuta antes:  npm run precache
// =============================================================================
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Carpetas y archivos que forman la app instalada (nada más sale al público). */
const PUBLIC_ENTRIES = ['index.html', 'manifest.webmanifest', 'icons', 'src'];
const PUBLIC_EXTENSIONS = new Set(['.html', '.js', '.css', '.png', '.svg', '.webmanifest', '.woff2', '.txt']);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * @param {string} [root]
 * @returns {{ version: string, files: string[] }}
 */
export function buildPrecache(root = ROOT) {
  const files = [];
  for (const entry of PUBLIC_ENTRIES) {
    const full = join(root, entry);
    const list = statSync(full).isDirectory() ? walk(full) : [full];
    for (const file of list) {
      const ext = file.slice(file.lastIndexOf('.'));
      if (PUBLIC_EXTENSIONS.has(ext)) files.push(relative(root, file).split(sep).join('/'));
    }
  }
  files.sort();

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(root, file)));
  }
  return { version: hash.digest('hex').slice(0, 12), files: ['./', ...files] };
}

export const PUBLIC_TOP_LEVEL = [...PUBLIC_ENTRIES, 'sw.js', 'precache.json'];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = buildPrecache();
  writeFileSync(join(ROOT, 'precache.json'), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`precache.json listo: ${data.files.length} archivos (versión ${data.version}).`);
}
