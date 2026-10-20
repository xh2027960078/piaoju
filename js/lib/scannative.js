/* 原生 OpenCV 扫描客户端（文件版）
 * 大图不走 JS 桥的字符串，改为：写入 cache/share → 原生读文件 → 原生写结果文件 → 用 content:// 加载
 */

let seq = 0;
const pending = new Map();
const AUTHORITY = 'com.piaoju.keeper.share';

export function nativeAvailable() {
  try {
    if (!window.Android || !window.Android.scanNativeVersion) return false;
    const v = String(window.Android.scanNativeVersion() || '');
    return v.indexOf('unavailable') !== 0;
  } catch (e) {
    return false;
  }
}

export function nativeVersion() {
  try { return String(window.Android.scanNativeVersion() || ''); } catch (e) { return ''; }
}

function contentUri(name) {
  return 'content://' + AUTHORITY + '/' + encodeURIComponent(name);
}

/** 通过原生桥分块读取 cache/share 里的文件，拼成 Blob */
async function readCacheFile(name) {
  const bridge = window.Android;
  if (!bridge || !bridge.cacheFileRead) throw new Error('原生读取不可用');
  const size = Number(bridge.cacheFileSize(name));
  if (!(size > 0)) throw new Error('结果文件为空');
  const CHUNK = 512 * 1024;
  const parts = [];
  for (let off = 0; off < size; off += CHUNK) {
    const b64 = String(bridge.cacheFileRead(name, off, Math.min(CHUNK, size - off)));
    if (b64.indexOf('err') === 0) throw new Error('读取结果失败：' + b64.slice(4));
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    parts.push(arr);
  }
  return new Blob(parts, { type: 'image/jpeg' });
}

/** 用原生桥把 Blob 写入 cache/share，返回文件名 */
function writeToCache(blob, name) {
  return new Promise((resolve, reject) => {
    try {
      const bridge = window.Android;
      if (!bridge || !bridge.beginFile) { reject(new Error('原生写入不可用')); return; }
      const token = String(bridge.beginFile(name, blob.type || 'image/jpeg', 'cache'));
      if (token.indexOf('err') === 0) { reject(new Error(token.slice(4))); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const dataUrl = String(reader.result || '');
          const b64 = dataUrl.split(',')[1] || '';
          const CHUNK = 1 << 21;
          for (let i = 0; i < b64.length; i += CHUNK) {
            const res = String(bridge.writeChunk(token, b64.slice(i, i + CHUNK)));
            if (res.indexOf('err') === 0) {
              try { bridge.endFile(token); } catch (e) { /* ignore */ }
              reject(new Error(res.slice(4)));
              return;
            }
          }
          const done = String(bridge.endFile(token));
          if (done.indexOf('ok') === 0) resolve(name);
          else reject(new Error(done.slice(4)));
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    } catch (e) { reject(e); }
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/jpeg', quality || 0.92);
  });
}

/** 把 img 画到 canvas（限制最大边），返回 canvas */
function normalizeCanvas(img, maxSide) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const k = Math.min(1, maxSide / Math.max(iw, ih));
  const cv = document.createElement('canvas');
  cv.width = Math.round(iw * k);
  cv.height = Math.round(ih * k);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

/**
 * 原生扫描（文件模式）
 * @param {HTMLImageElement} img
 * @param {{mode:string, quad:Array<[number,number]>|null, maxOut:number}} opts
 */
export async function scanNativeFile(img, opts) {
  const maxOut = opts.maxOut || 2200;
  const cv = normalizeCanvas(img, maxOut);
  const blob = await canvasToJpegBlob(cv, 0.92);

  const inName = 'src-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '.jpg';
  await writeToCache(blob, inName);

  // naturalWidth 在图片未解码完成时是 0，会让坐标变成 Infinity → JSON 变 null → 原生认为"没有四角"
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  let corners = 'null';
  if (opts.quad && opts.quad.length === 4 && iw > 0 && ih > 0) {
    const norm = opts.quad.map(([x, y]) => [Number((x / iw).toFixed(5)), Number((y / ih).toFixed(5))]);
    const bad = norm.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || a < -0.5 || a > 1.5 || b < -0.5 || b > 1.5);
    if (!bad) corners = JSON.stringify(norm);
  }

  const id = String(++seq);
  const json = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('处理超时（60 秒），请重试'));
    }, 60000);
    pending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    try {
      window.Android.scanNativeFile(id, inName, opts.mode || 'auto', corners);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e);
    }
  });

  if (!json || json.ok !== true) throw new Error((json && json.error) || '原生处理失败');

  // 原生直接返回压缩后的 base64，直接解码显示
  let url;
  if (json.image) {
    url = 'data:image/jpeg;base64,' + json.image;
  } else {
    const outBlob = await readCacheFile(json.file);
    url = URL.createObjectURL(outBlob);
  }
  let loaded;
  try {
    loaded = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('结果图片解码失败'));
      im.src = url;
    });
  } finally {
    if (url.indexOf('blob:') === 0) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const out = document.createElement('canvas');
  out.width = loaded.naturalWidth;
  out.height = loaded.naturalHeight;
  out.getContext('2d').drawImage(loaded, 0, 0);

  return {
    canvas: out,
    found: !!json.found,
    quad: json.quad && json.quad.length === 4 ? json.quad.map(([x, y]) => [x * iw, y * ih]) : null,
    width: out.width,
    height: out.height,
    stages: {},
  };
}

window.__onScanFileResult = (id, res) => {
  const task = pending.get(String(id));
  if (!task) return;
  pending.delete(String(id));
  let data;
  try { data = typeof res === 'string' ? JSON.parse(res) : res; } catch (e) { task.reject(new Error('结果解析失败')); return; }
  if (!data || data.ok !== true) { task.reject(new Error((data && data.error) || '原生失败')); return; }
  task.resolve(data);
};
