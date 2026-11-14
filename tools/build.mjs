// =============================================================================
// Prepara la carpeta que se publica (Vercel u otro hosting estático): `npm run build`.
// Copia SOLO los archivos públicos de la app (los mismos que sirve `npm start`) y
// recalcula precache.json, para que la versión publicada siempre avise de que hay
// una actualización. Las pruebas, los documentos y las migraciones NO se publican.
// Uso: node tools/build.mjs [carpeta de salida]   (por defecto: dist)
// =============================================================================
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_TOP_LEVEL, buildPrecache } from './make-precache.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} [outDir] carpeta de salida (se vacía antes de copiar)
 * @param {string} [root] carpeta del proyecto
 * @returns {{ outDir: string, files: number, version: string }}
 */
export function build(outDir = join(ROOT, 'dist'), root = ROOT) {
  const out = resolve(outDir);
  // Seguridad: nunca vaciar la carpeta del proyecto ni una que la contenga.
  if (out === resolve(root) || resolve(root).startsWith(out + sep)) throw new Error(`Carpeta de salida no permitida: ${out}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const precache = buildPrecache(root);
  for (const entry of PUBLIC_TOP_LEVEL) {
    if (entry === 'precache.json') continue;
    const from = join(root, entry);
    if (!existsSync(from)) throw new Error(`Falta un archivo de la app: ${entry}`);
    cpSync(from, join(out, entry), { recursive: true });
  }
  writeFileSync(join(out, 'precache.json'), `${JSON.stringify(precache, null, 2)}\n`);
  return { outDir: out, files: precache.files.length, version: precache.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = build(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Listo para publicar en ${result.outDir}: ${result.files} archivos (versión ${result.version}).`);
}
