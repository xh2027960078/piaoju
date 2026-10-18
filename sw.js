/* 离线缓存：应用外壳优先走本地缓存 */
const CACHE = 'piaoju-v5';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './vendor/jszip.min.js',
  './js/data/options.js',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/store.js',
  './js/platform.js',
  './js/render.js',
  './js/charts.js',
  './js/picker.js',
  './js/forms.js',
  './js/xlsx.js',
  './js/naming.js',
  './js/pdftext.js',
  './js/appearance.js',
  './js/config.js',
  './js/telemetry.js',
  './js/assets.js',
  './js/env.js',
  './js/viewer.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './js/exporter.js',
  './js/views/periods.js',
  './js/views/detail.js',
  './js/views/chartsview.js',
  './js/views/exportview.js',
  './js/views/settingsview.js',
  './assets/template.xlsx',
  './manifest.webmanifest',
  './admin.html',
  './css/admin.css',
  './js/admin.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit)),
  );
});
