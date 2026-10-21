// Service worker: makes DocShift installable and usable offline.
// The __PLACEHOLDERS__ are filled in by scripts/build.mjs.
const SHELL = "docshift-shell-__SHELL_VERSION__";
const VENDOR = "docshift-vendor-__VENDOR_VERSION__";
const SHARED = "docshift-shared";
const SHELL_FILES = __SHELL_FILES__;
// Libraries are precached, except the 16 MB pandoc engine, which is cached the first
// time it's used (the installed app fetches it in the background right away).
const VENDOR_FILES = __VENDOR_FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES);
    await (await caches.open(VENDOR)).addAll(VENDOR_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (![SHELL, VENDOR, SHARED].includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(receiveShare(req));
  } else if (req.method === "GET" && url.pathname.includes("/vendor/")) {
    event.respondWith(cacheFirst(req));
  } else if (req.method === "GET") {
    event.respondWith(networkFirst(req));
  }
});

// Libraries never change within a version, so serve them from the cache.
async function cacheFirst(req) {
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// The app itself: prefer the network so updates show up, fall back to the cache offline.
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === "navigate" && await cache.match("./"));
    if (hit) return hit;
    throw err;
  }
}

// Android "Share to DocShift": stash the files and hand over to the page.
async function receiveShare(req) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f) => f instanceof File);
  const cache = await caches.open(SHARED);
  for (const key of await cache.keys()) await cache.delete(key);
  await Promise.all(files.map((f, i) => cache.put(new URL(`shared/${i}`, self.registration.scope), new Response(f, {
    headers: { "Content-Type": f.type || "application/octet-stream", "X-Filename": encodeURIComponent(f.name) },
  }))));
  return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
}
