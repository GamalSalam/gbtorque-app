// ═══════════════════════════════════════════════════════════════════
// Gearbox Torque Analyzer -- Service Worker
//
// Purpose: once a user opens the app while online (or "installs" it to
// their phone's home screen), it keeps working with ZERO signal from
// then on. Whenever the app IS online, it quietly checks for a newer
// version in the background and lets the page know -- the page then
// shows a small "tap to update" banner instead of reloading on its own,
// so nobody loses in-progress form data mid-calculation.
//
// ── HOW TO SHIP AN UPDATE ─────────────────────────────────────────
// Bump CACHE_VERSION below (e.g. 'v1' -> 'v2') any time you change
// GearBalanceAnalyzer.html or any cached asset. That's the ONLY step
// required -- the version bump is what makes browsers detect this file
// as "changed" and go through the update flow below.
// ═══════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'gbtorque-cache-' + CACHE_VERSION;

// Must ALL exist -- cache.addAll() fails entirely if even one 404s.
const CORE_SHELL = [
    './index.html',
    './manifest.json',
    './assets/favicon.png',
    './assets/header-logo.png',
    './assets/linkage-diagram.png',
    './assets/icon-192.png',
    './assets/icon-512.png',
];

// Best-effort -- these are optional overrides some users may not have.
// Missing files here must NOT break installation of the core shell.
const OPTIONAL_SHELL = [
    './database.json',
    './equations.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_SHELL);
        await Promise.all(OPTIONAL_SHELL.map(async (url) => {
            try {
                const res = await fetch(url);
                if (res && res.ok) await cache.put(url, res);
            } catch (e) { /* fine if it doesn't exist -- skip silently */ }
        }));
    })());
    // Do NOT skipWaiting() here -- wait for the page to explicitly approve
    // the update (see the 'message' handler below) so an in-progress
    // session isn't yanked out from under the user.
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

// The page sends this once the user taps the "update available" banner.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // don't touch POSTs etc.

    const isHTML = req.mode === 'navigate' ||
                   (req.headers.get('accept') || '').includes('text/html');

    if (isHTML) {
        // Network-first for the app page itself: always try to get the
        // latest version when online; fall back to the cached copy the
        // instant the network is unavailable.
        event.respondWith((async () => {
            try {
                const fresh = await fetch(req);
                const cache = await caches.open(CACHE_NAME);
                cache.put(req, fresh.clone());
                return fresh;
            } catch (e) {
                const cached = await caches.match(req);
                return cached || caches.match('./GearBalanceAnalyzer.html');
            }
        })());
    } else {
        // Cache-first for everything else (images, manifest, etc.) --
        // instant offline load; refresh the cached copy in the background
        // whenever a network fetch happens to succeed.
        event.respondWith((async () => {
            const cached = await caches.match(req);
            const networkFetch = fetch(req).then((res) => {
                if (res && res.ok) {
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
                }
                return res;
            }).catch(() => null);
            return cached || (await networkFetch) || Response.error();
        })());
    }
});
