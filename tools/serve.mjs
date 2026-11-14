// =============================================================================
// SERVIDOR LOCAL DE DESARROLLO (sin librerías externas)
//
//   npm start                 -> http://localhost:5173
//   npm start -- --port 5200  -> usa otro puerto
//
// Escucha en toda tu red Wi-Fi para que puedas abrir la app desde tu celular
// (mismo Wi-Fi). Solo entrega los archivos de la app (index.html, src/, icons/...);
// el resto de la carpeta del proyecto NO se expone.
// =============================================================================
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_TOP_LEVEL, buildPrecache } from './make-precache.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

const HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} text */
function send(res, status, text) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return send(res, 400, 'Dirección no válida');
    }
    if (pathname === '/') pathname = '/index.html';

    // precache.json se calcula al momento, así siempre refleja tus archivos actuales.
    if (pathname === '/precache.json') {
      res.writeHead(200, { ...HEADERS, 'Content-Type': MIME['.json'] });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(buildPrecache(ROOT)));
    }

    const relative = normalize(pathname).replace(/^[/\\]+/, '');
    const top = relative.split(sep)[0];
    if (!PUBLIC_TOP_LEVEL.includes(top) || relative.includes('..')) return send(res, 404, 'No encontrado');

    const filePath = join(ROOT, relative);
    if (!filePath.startsWith(ROOT + sep)) return send(res, 404, 'No encontrado');
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) return send(res, 404, 'No encontrado');

    const body = await readFile(filePath);
    res.writeHead(200, { ...HEADERS, 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(error);
    send(res, 500, 'Error interno del servidor');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nEl puerto ${PORT} ya está en uso (¿tienes otra copia abierta?).`);
    console.error(`Cierra la otra copia o usa otro puerto:  npm start -- --port ${PORT + 1}\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\nACCONTROL está corriendo.\n');
  console.log(`  En esta computadora:  http://localhost:${PORT}`);
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  for (const address of lan) console.log(`  En tu celular (mismo Wi-Fi):  http://${address}:${PORT}`);
  console.log('\nPara detenerlo: Ctrl + C\n');
});
