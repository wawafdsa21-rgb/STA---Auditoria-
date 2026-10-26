/* Auditoria de Ruas – Santa Therezinha: funcionamento offline */
const VERSION = 'sta-v16';
const CORE = ['./', './index.html', './style.css', './script.js', './manifest.json', './icon-192.png', './icon-512.png',
  './lib/html2canvas.min.js', './lib/jspdf.umd.min.js', './lib/xlsx.full.min.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // envios à planilha passam direto
  const u = new URL(req.url);
  if (u.hostname.endsWith('google.com') || u.hostname.endsWith('googleusercontent.com')) return;
  if (u.origin === location.origin) { e.respondWith(networkFirst(req)); return; }
  if (/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u.hostname)) e.respondWith(cacheFirst(req));
});

// Site: tenta a versão nova (até 4 s); sem internet ou rede lenta, usa a cópia salva.
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; });
  net.catch(() => {});
  const cached = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('./index.html') : undefined);
  if (!cached) return net;
  try { return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(0), 4000))]); }
  catch (e) { return cached; }
}

// Bibliotecas e fontes: usa a cópia salva; baixa só na primeira vez.
async function cacheFirst(req) {
  const c = await caches.open(VERSION);
  const m = await c.match(req);
  if (m) return m;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
  return r;
}
