/* Offline support. Same-origin requests are network-first, so a deploy shows up on the next load and the
   app shell and data never mix versions; the cache is only the fallback when offline. Data files are cached
   as they're opened (your municipality, its dictionary, the map), never the whole catalog. Fonts are cache-first. */
const CACHE = "wakeru-v1";
const SHELL = ["./", "index.html", "css/styles.css", "js/app.js", "js/onboarding.js", "js/schedule.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/favicon-32.png", "data/municipalities.json", "data/shared/items.json", "data/shared/glossary.json", "data/map/japan.json"];
const FONTS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== "GET") return;
  if(FONTS.includes(url.origin)) return e.respondWith(caches.match(req).then(hit => hit ?? fetch(req).then(res => store(req, res))));
  if(url.origin !== location.origin) return; // GSI reverse geocoding etc. stay online-only
  e.respondWith(fetch(req).then(res => store(req, res))
    .catch(() => caches.match(req, {ignoreSearch:true}).then(hit => hit ?? (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
function store(req, res){
  if(res.ok || res.type === "opaque"){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
  return res;
}
