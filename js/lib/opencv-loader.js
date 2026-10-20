/* OpenCV.js 懒加载：只在扫描时加载一次，之后常驻
 * 注意：新版 UMD 构建里 window.cv 是一个 Promise（工厂返回 Module），
 * 必须先 await 它，再拿 cv.Mat。
 */

let cvPromise = null;

export function opencvAvailable() {
  return !!(window.cv && window.cv.Mat);
}

async function resolveModule(raw, onProgress) {
  if (!raw) throw new Error('opencv 未挂载到 window');
  if (raw.Mat) return raw;

  let mod = raw;
  if (typeof mod.then === 'function') {
    if (onProgress) onProgress(70, '初始化图像引擎');
    mod = await mod;
  } else if (typeof mod === 'function') {
    if (onProgress) onProgress(70, '初始化图像引擎');
    mod = await mod();
  }
  if (!mod || !mod.Mat) throw new Error('图像引擎未就绪（缺少 cv.Mat）');
  return mod;
}

export function loadOpenCV(onProgress) {
  if (opencvAvailable()) return Promise.resolve(window.cv);
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    if (onProgress) onProgress(10, '加载图像引擎');

    let settled = false;
    let waited = 0;
    const timer = setInterval(() => {
      waited += 200;
      if (!settled && onProgress && waited < 5000) onProgress(30, '加载图像引擎');
    }, 200);

    const finish = (err, mod) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (err) { cvPromise = null; reject(err); } else resolve(mod);
    };

    const script = document.createElement('script');
    script.src = 'vendor/opencv.js';
    script.async = true;

    const giveUp = setTimeout(() => finish(new Error('图像引擎初始化超时（60 秒）')), 60000);

    script.onload = async () => {
      try {
        if (onProgress) onProgress(55, '初始化图像引擎');
        const mod = await resolveModule(window.cv, onProgress);
        window.cv = mod;
        clearTimeout(giveUp);
        if (onProgress) onProgress(95, '图像引擎就绪');
        finish(null, mod);
      } catch (e) {
        clearTimeout(giveUp);
        finish(e);
      }
    };
    script.onerror = () => {
      clearTimeout(giveUp);
      finish(new Error('vendor/opencv.js 加载失败'));
    };

    document.head.appendChild(script);
  });

  return cvPromise;
}
