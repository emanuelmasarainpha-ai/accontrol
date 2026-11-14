// =============================================================================
// SERVICE WORKER — hace que ACCONTROL abra sin conexión y sea instalable.
//
// Estrategia "primero la red, si falla el caché":
//   - Con internet (o con tu servidor local), siempre carga la versión más nueva
//     de cada archivo y la guarda.
//   - Sin conexión, usa la última copia guardada.
// Así, cuando editas el código no te quedas "pegado" en una versión vieja.
//
// IMPORTANTE: este archivo NO guarda ni toca tus datos financieros. Esos viven
// en IndexedDB y el Service Worker nunca los lee ni los envía a ningún lado.
// =============================================================================
const CACHE_PREFIX = 'accontrol-app-';
const NETWORK_TIMEOUT_MS = 4000;

let cacheName = null;

/**
 * Nombre del caché según la versión indicada en precache.json.
 * Devuelve null si no se pudo averiguar (por ejemplo, sin conexión en un arranque en frío);
 * en ese caso se usan las copias ya guardadas sin necesitar el nombre.
 */
async function currentCacheName() {
  if (cacheName) return cacheName;
  try {
    const response = await fetch('precache.json', { cache: 'no-store' });
    const { version } = await response.json();
    cacheName = `${CACHE_PREFIX}${version}`;
    return cacheName;
  } catch {
    return null; // no se guarda el fallo: se vuelve a intentar en la próxima petición
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch('precache.json', { cache: 'no-store' });
      const { version, files } = await response.json();
      const cache = await caches.open(`${CACHE_PREFIX}${version}`);
      await cache.addAll(files.map((file) => new Request(file, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = await currentCacheName();
      if (keep) {
        for (const name of await caches.keys()) {
          if (name.startsWith(CACHE_PREFIX) && name !== keep) await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Solo archivos de la propia app. Nunca se intercepta nada de otros sitios.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/precache.json')) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (response.ok && response.type === 'basic') {
      const name = await currentCacheName();
      if (name) {
        const cache = await caches.open(name);
        await cache.put(request, response.clone());
      }
    }
    return response;
  } catch {
    // Sin red (o muy lenta): se busca en TODOS los cachés de la app, sin depender de saber la versión actual.
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ??
      (request.mode === 'navigate' ? await caches.match('./') : undefined);
    if (cached) return cached;
    return new Response('Sin conexión y este archivo aún no está guardado.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
