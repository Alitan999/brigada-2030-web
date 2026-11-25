// Brigada 2030 web — Service Worker.
// Las imágenes del juego se descargan UNA sola vez y quedan guardadas en el
// teléfono (Cache Storage). La segunda vez que se abre, el juego carga desde
// el teléfono, al instante e incluso sin internet. Si una imagen no está en
// el caché, se baja de la red y se guarda para la próxima.
// Versión del caché: súbela (v2, v3...) cada vez que cambie el arte.
const CACHE = 'brigada2030-v1';
const CORE = ['./', './index.html', './sw.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
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
// juego; se guardan en segundo plano, en tandas, y se reporta el avance.
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
  const BATCH = 12;
  const report = () => {
    if (client) client.postMessage({ type: 'PRECACHE_PROGRESS', done, total });
  };
  for (let i = 0; i < urls.length; i += BATCH) {
    const chunk = urls.slice(i, i + BATCH);
    await Promise.all(chunk.map(async (u) => {
      try {
        const res = await fetch(u);
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
  if (url.pathname.indexOf('/assets/') !== -1) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // La página (index.html): siempre lo nuevo de la red, y si no hay red, lo guardado.
  if (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
