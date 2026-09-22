// Sahayak service worker: app shell offline; API calls always go to the network.
const CACHE = "sahayak-shell-v1";
const SHELL = ["/", "/index.html", "/app.js", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || ["/brief","/visits","/ask","/whatsapp","/rollup","/audit","/health"].some(p => u.pathname.startsWith(p))) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
