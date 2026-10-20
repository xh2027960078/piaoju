/* 通过 Web Worker 调用 OpenCV 扫描管线，主线程不被 10MB 脚本阻塞 */

let cvBlobUrl = null;

/** 主线程把 opencv.js 取成 Blob，再交给 Worker（Worker 直接取资源拿不到） */
async function getCvBlobUrl(onProgress) {
  if (cvBlobUrl) return cvBlobUrl;
  if (onProgress) onProgress(8, '读取图像引擎');
  const res = await fetch('vendor/opencv.js', { cache: 'force-cache' });
  if (!res.ok) throw new Error('读取 opencv.js 失败：HTTP ' + res.status);
  const text = await res.text();
  if (!text || text.length < 100000) throw new Error('opencv.js 内容异常（' + (text ? text.length : 0) + ' 字符）');
  if (onProgress) onProgress(16, '准备图像引擎');
  const blob = new Blob([text], { type: 'application/javascript' });
  cvBlobUrl = URL.createObjectURL(blob);
  return cvBlobUrl;
}
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  // 经典 Worker：内部要用 importScripts 加载 opencv.js（module worker 不支持）
  worker = new Worker(new URL('./scan-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const msg = e.data || {};
    const task = pending.get(msg.id);
    if (!task) return;
    if (msg.type === 'progress') {
      task.onProgress(msg.pct, msg.label);
    } else if (msg.type === 'done') {
      pending.delete(msg.id);
      task.resolve(msg.result);
    } else if (msg.type === 'warmup-done') {
      pending.delete(msg.id);
      task.resolve(msg.hasMat);
    } else if (msg.type === 'error') {
      pending.delete(msg.id);
      task.reject(new Error(msg.message));
    }
  };
  worker.onerror = (e) => {
    const err = new Error((e && e.message) || 'Worker 加载失败');
    pending.forEach((t) => t.reject(err));
    pending.clear();
    worker = null;
  };
  return worker;
}

/**
 * @param {HTMLImageElement} img
 * @param {object} opts { mode, quad, maxOut }
 * @param {(pct:number,label:string)=>void} onProgress
 */
export async function cvScanInWorker(img, opts, onProgress) {
  const cvUrl = await getCvBlobUrl(onProgress);
  const maxOut = opts.maxOut || 1600;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.min(1, maxOut / Math.max(iw, ih));
  const W = Math.round(iw * scale);
  const H = Math.round(ih * scale);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  const imageData = ctx.getImageData(0, 0, W, H);

  const quad = opts.quad
    ? opts.quad.map(([x, y]) => [x * scale, y * scale])
    : null;

  const payload = {
    data: imageData.data,
    width: W,
    height: H,
    quad,
    mode: opts.mode || 'auto',
  };

  const id = ++seq;
  return new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => {
      pending.delete(id);
      reject(new Error('图像引擎响应超时（120 秒）'));
    }, 120000);
    pending.set(id, {
      onProgress: onProgress || (() => {}),
      resolve: (res) => {
        clearTimeout(watchdog);
        const out = document.createElement('canvas');
        out.width = res.width;
        out.height = res.height;
        const octx = out.getContext('2d');
        octx.putImageData(new ImageData(res.data, res.width, res.height), 0, 0);
        resolve({
          canvas: out,
          found: res.found,
          quad: res.quad ? res.quad.map(([x, y]) => [x / scale, y / scale]) : null,
          width: res.width,
          height: res.height,
          stages: {},
        });
      },
      reject: (err) => { clearTimeout(watchdog); reject(err); },
    });
    try {
      getWorker().postMessage({ id, payload, cvUrl }, [imageData.data.buffer]);
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}

export function workerAvailable() {
  return typeof Worker !== 'undefined';
}

/** 在 Worker 里预热引擎（不阻塞界面）；返回 Promise */
export function warmupWorkerEngine(onProgress) {
  const id = ++seq;
  return new Promise(async (resolve, reject) => {
    let cvUrl;
    try {
      cvUrl = await getCvBlobUrl(onProgress);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('引擎准备超时（120 秒）'));
    }, 120000);
    pending.set(id, {
      onProgress: onProgress || (() => {}),
      resolve: (res) => { clearTimeout(timer); resolve(res); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });
    try {
      getWorker().postMessage({ id, type: 'warmup', cvUrl });
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err);
    }
  });
}
