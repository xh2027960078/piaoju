/* 离线缓存：应用外壳走本地缓存；配置文件始终走网络 */
const CACHE = 'piaoju-v41';
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
  /*H5-STRIP-START*/
  './js/views/gamesview.js',
  './js/views/newsview.js',
  './js/views/allview.js',
  './js/views/toolsview.js',
  './js/views/tools/fmt.js',
  './js/views/tools/scan.js',
  './js/views/tools/collage.js',
  './js/views/tools/wheel.js',
  './js/lib/pdflite.js',
  './js/lib/scanner.js',
  /*H5-STRIP-END*/
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
  let path = '';
  try { path = new URL(req.url).pathname; } catch (err) { path = ''; }
  // 跨域接口（天气、热搜）直接放行，不进缓存
  let sameOrigin = true;
  try { sameOrigin = new URL(req.url).origin === location.origin; } catch (err) { sameOrigin = false; }
  if (!sameOrigin) return;
  // 页面导航（打开 index.html / admin.html）永远先要网络，离线才用缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }
  // 更新包与版本清单不缓存
  if (path.indexOf('/app/') >= 0) return;
  // 配置与后台页面随时可能改：始终优先网络，取不到再用缓存
  if (path.endsWith('/js/config.js') || path.indexOf('/admin') >= 0) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }
  // 其余同源资源：网络优先，失败（离线）再用缓存，保证更新后刷新即生效
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req)),
  );
});
