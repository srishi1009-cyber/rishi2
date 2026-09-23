// ============================================================
// RISHI MUSIC - SERVICE WORKER
// ============================================================

// Change this version whenever you make an important
// update to your application.

const CACHE_NAME = "rishi-music-v3";


// ============================================================
// FILES TO CACHE
// ============================================================

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json"
];


// ============================================================
// INSTALL
// ============================================================

self.addEventListener("install", (event) => {

    console.log(
        "[Rishi Music SW] Installing new version..."
    );

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then((cache) => {

                console.log(
                    "[Rishi Music SW] Caching app files..."
                );

                return cache.addAll(APP_SHELL);
            })

            .then(() => {

                // Immediately activate the new service worker.
                return self.skipWaiting();
            })
    );
});


// ============================================================
// ACTIVATE
// ============================================================

self.addEventListener("activate", (event) => {

    console.log(
        "[Rishi Music SW] Activating new version..."
    );

    event.waitUntil(

        caches.keys()
            .then((cacheNames) => {

                return Promise.all(

                    cacheNames.map((cacheName) => {

                        // Delete old Rishi Music caches
                        if (
                            cacheName.startsWith(
                                "rishi-music-"
                            ) &&
                            cacheName !== CACHE_NAME
                        ) {

                            console.log(
                                "[Rishi Music SW] Removing old cache:",
                                cacheName
                            );

                            return caches.delete(
                                cacheName
                            );
                        }

                        return Promise.resolve();
                    })
                );
            })

            .then(() => {

                // Take control of all open pages
                // immediately.
                return self.clients.claim();
            })
    );
});


// ============================================================
// FETCH
// ============================================================

self.addEventListener("fetch", (event) => {

    const request = event.request;


    // Only handle GET requests.
    if (request.method !== "GET") {
        return;
    }


    const url = new URL(request.url);


    // ========================================================
    // DO NOT INTERFERE WITH OTHER ORIGINS
    // ========================================================

    if (
        url.origin !== self.location.origin
    ) {

        return;
    }


    // ========================================================
    // HTML PAGES
    // ========================================================
    //
    // Network first:
    //
    // 1. Try GitHub for latest index.html
    // 2. If offline, use cached version
    //

    if (
        request.mode === "navigate" ||
        request.destination === "document"
    ) {

        event.respondWith(

            fetch(request)
                .then((response) => {

                    // Save the newest HTML
                    // in the cache.

                    if (
                        response &&
                        response.status === 200
                    ) {

                        const responseClone =
                            response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {

                                cache.put(
                                    request,
                                    responseClone
                                );
                            });
                    }


                    return response;
                })

                .catch(() => {

                    return caches.match(
                        request
                    )
                        .then((cachedResponse) => {

                            return (
                                cachedResponse ||
                                caches.match(
                                    "./index.html"
                                )
                            );
                        });
                })
        );

        return;
    }


    // ========================================================
    // JAVASCRIPT / CSS / MANIFEST
    // ========================================================
    //
    // Network first.
    //
    // This is important because when you update app.js
    // or style.css on GitHub, the new version should be
    // downloaded instead of permanently using the old cache.
    //

    if (
        request.destination === "script" ||
        request.destination === "style" ||
        request.destination === "manifest"
    ) {

        event.respondWith(

            fetch(request)
                .then((response) => {

                    if (
                        response &&
                        response.status === 200
                    ) {

                        const responseClone =
                            response.clone();

                        caches.open(CACHE_NAME)
                            .then((cache) => {

                                cache.put(
                                    request,
                                    responseClone
                                );
                            });
                    }


                    return response;
                })

                .catch(() => {

                    return caches.match(
                        request
                    );
                })
        );

        return;
    }


    // ========================================================
    // IMAGES / ICONS / OTHER APP FILES
    // ========================================================
    //
    // Cache first:
    //
    // 1. Use cached file if available
    // 2. Otherwise download it
    //

    event.respondWith(

        caches.match(request)
            .then((cachedResponse) => {

                if (cachedResponse) {

                    return cachedResponse;
                }


                return fetch(request)
                    .then((response) => {

                        if (
                            response &&
                            response.status === 200 &&
                            response.type === "basic"
                        ) {

                            const responseClone =
                                response.clone();

                            caches.open(
                                CACHE_NAME
                            )
                                .then((cache) => {

                                    cache.put(
                                        request,
                                        responseClone
                                    );
                                });
                        }


                        return response;
                    });
            })
    );
});


// ============================================================
// MESSAGE HANDLER
// ============================================================
//
// Allows the webpage to tell the service worker to
// immediately activate a new version.
//

self.addEventListener("message", (event) => {

    if (
        event.data &&
        event.data.type === "SKIP_WAITING"
    ) {

        self.skipWaiting();
    }
});