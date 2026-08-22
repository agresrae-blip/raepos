// RaePOS minimal service worker - enables Install/Add to Home Screen
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => { /* network-first passthrough */ });
