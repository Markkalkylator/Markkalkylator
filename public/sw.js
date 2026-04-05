const CACHE = "markkalkylator-v1";

// Filer som cachas vid installation (app-skalet)
const PRECACHE = [
  "/",
  "/verktyg",
  "/pdf.worker.min.mjs",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  // Rensa gamla cache-versioner
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skippa Clerk, Stripe och API-anrop — alltid nätverket
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("clerk") ||
    url.hostname.includes("stripe") ||
    request.method !== "GET"
  ) {
    return;
  }

  // Strategi: Nätverk-först, med cache som fallback
  e.respondWith(
    fetch(request)
      .then((res) => {
        // Spara lyckade svar i cache
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
