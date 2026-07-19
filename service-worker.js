/* ==========================================================================
   SISTEM ABSENSI KARYAWAN — PT Sentralindo Teguh Gemilang
   service-worker.js
   ========================================================================== */

// Naikkan angka versi ini setiap kali Anda mengubah file HTML/CSS/JS
// agar pengguna otomatis mendapatkan versi terbaru.
const CACHE_NAME = "absensi-stg-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png"
];

// Saat instalasi: simpan seluruh app shell ke cache.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Saat aktivasi: hapus cache versi lama.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Strategi: Network First untuk permintaan ke Google Apps Script (data absen),
// Cache First untuk seluruh file aplikasi (HTML/CSS/JS/ikon).
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Jangan pernah menyimpan cache untuk permintaan ke Google Apps Script —
  // data absen harus selalu dikirim langsung ke server, bukan dari cache.
  if (url.includes("script.google.com")){
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Simpan salinan file baru (misalnya font dari CDN) ke cache.
        if (event.request.method === "GET" && response.status === 200){
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => {
        // Jika offline dan file tidak ada di cache, tampilkan halaman utama.
        if (event.request.mode === "navigate"){
          return caches.match("./index.html");
        }
      });
    })
  );
});
