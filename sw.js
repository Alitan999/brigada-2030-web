// Brigada 2030 web — Service Worker.
// Las imágenes del juego se descargan UNA sola vez y quedan guardadas en el
// teléfono (Cache Storage). La segunda vez que se abre, el juego carga desde
// el teléfono, al instante e incluso sin internet. Si una imagen no está en
// el caché, se baja de la red y se guarda para la próxima.
// Versión del caché: súbela (v2, v3...) cada vez que cambie el arte.
// v2 (2026-11-25): TODAS las peticiones de red llevan tiempo límite. En
// conexiones móviles débiles un fetch puede quedarse colgado para siempre
// (ni resuelve ni rechaza) y eso dejaba la página en "Cargando" sin pintar
// nada, porque el fetch de la página no tenía timeout y el .catch nunca
// se disparaba. Ahora: si la red no responde a tiempo, se sirve lo guardado
// y si no hay nada guardado, la petición se reintenta una vez.
const CACHE = 'brigada2030-v2';
const CORE = ['./', './index.html', './sw.js'];

// Un fetch con tiempo límite: si no responde en `ms`, se abandona (la
// petición original puede seguir en segundo plano, pero ya no bloquea).
function fetchWithTimeout(url, ms) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.race([
      caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))),
      new Promise((resolve) => setTimeout(resolve, 8000))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página manda { type: 'PRECACHE', urls: [...] } con las imágenes del
// juego; se guardan en segundo plano, en tandas pequeñas, y se reporta el
// avance. Tandas de 4 (no 12) para no saturar la conexión del teléfono, y
// cada imagen con su propio tiempo límite para que una colgada no pare la
// tanda entera.
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'PRECACHE' && Array.isArray(d.urls)) {
    e.waitUntil(precacheAll(d.urls, e.source));
  }
});

async function precacheAll(urls, client) {
  const cache = await caches.open(CACHE);
  const total = urls.length;
  let done = 0;
  const BATCH = 4;
  const report = () => {
    if (client) client.postMessage({ type: 'PRECACHE_PROGRESS', done, total });
  };
  for (let i = 0; i < urls.length; i += BATCH) {
    const chunk = urls.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (u) => {
      try {
        const res = await fetchWithTimeout(u, 8000);
        if (res && res.ok) await cache.put(u, res);
      } catch (err) {
        // Una imagen que falla ahora se reintenta sola la próxima vez que
        // el juego la pida (el fetch de abajo la guarda al bajarla).
      }
      done++;
      report();
    }));
  }
  if (client) client.postMessage({ type: 'PRECACHE_DONE', done, total });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Imágenes/música del juego: primero el teléfono, si no está se baja y se guarda.
  // Si la descarga se cuelga, se devuelve un error rápido para que el juego
  // la marque como fallida y siga (antes se quedaba esperando para siempre).
  if (url.pathname.indexOf('/assets/') !== -1) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        return Promise.race([
          fetch(e.request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
          new Promise((resolve) => setTimeout(() => resolve(new Response('', { status: 504, statusText: 'Timeout' })), 10000))
        ]);
      })
    );
    return;
  }

  // La página (index.html): siempre lo nuevo de la red, y si no hay red, lo guardado.
  // Con tiempo límite: si la red no responde en 6 s, se sirve la copia
  // guardada; si no hay copia guardada, se reintenta la petición una vez.
  if (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      Promise.race([
        fetch(e.request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
        new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 6000))
      ]).then((res) => {
        if (res === 'TIMEOUT') {
          return caches.match(e.request).then((hit) => hit || fetch(e.request));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
