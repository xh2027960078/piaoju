/* OpenCV 扫描 Worker：在后台线程加载 opencv.js 并完成整条管线
 * 主线程只负责传像素、收结果，UI 不会因为解析 10MB 脚本而卡住。
 */

let cvPromise = null;

/** 由主线程取到 opencv.js 的内容并以 Blob URL 传入：
 *  Worker 里的 importScripts 不会经过 WebView 的资源拦截，直接取 appassets 路径会失败。
 */
function loadCv(blobUrl) {
  if (cvPromise) return cvPromise;
  if (!blobUrl) throw new Error('缺少 opencv 脚本地址');
  cvPromise = (async () => {
    importScripts(blobUrl);
    let mod = self.cv;
    if (typeof mod === 'function') mod = await mod();
    else if (mod && typeof mod.then === 'function') mod = await mod;
    if (!mod || !mod.Mat) throw new Error('cv.Mat 不可用');
    self.cv = mod;
    return mod;
  })();
  return cvPromise;
}

function orderPoints(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  return [
    pts[sum.indexOf(Math.min(...sum))],
    pts[diff.indexOf(Math.min(...diff))],
    pts[sum.indexOf(Math.max(...sum))],
    pts[diff.indexOf(Math.max(...diff))],
  ];
}

async function run(payload, progress, cvUrl) {
  progress(30, '加载图像引擎');
  const cv = await loadCv(cvUrl);
  progress(45, '检测纸张边缘');

  const { data, width: W, height: H, quad: override, mode } = payload;
  const src = cv.matFromImageData({ data: new Uint8ClampedArray(data), width: W, height: H });
  const trash = [];
  const keep = (m) => { trash.push(m); return m; };

  let quad = null;
  let found = false;

  if (override && override.length === 4) {
    quad = override.map(([x, y]) => ({ x, y }));
    found = true;
  } else {
    const ds = Math.min(1, 520 / Math.max(W, H));
    const dw = Math.max(32, Math.round(W * ds));
    const dh = Math.max(32, Math.round(H * ds));
    const small = keep(new cv.Mat());
    cv.resize(src, small, new cv.Size(dw, dh), 0, 0, cv.INTER_AREA);

    const gray = keep(new cv.Mat());
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    const blur = keep(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    // 在给定的二值图上找面积最大且能近似成四边形的轮廓
    const quadFromBinary = (bin) => {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < dw * dh * 0.1) { cnt.delete(); continue; }
        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
        if (approx.rows === 4 && area > bestArea) {
          bestArea = area;
          if (best) best.delete();
          best = approx;
        } else approx.delete();
        cnt.delete();
      }
      contours.delete();
      hierarchy.delete();
      if (!best) return null;
      const pts = [];
      for (let i = 0; i < 4; i++) {
        pts.push({ x: best.data32S[i * 2] / ds, y: best.data32S[i * 2 + 1] / ds });
      }
      best.delete();
      return { quad: orderPoints(pts), area: bestArea / (dw * dh) };
    };

    // 候选 1：Canny 边缘
    const edges = keep(new cv.Mat());
    cv.Canny(blur, edges, 50, 150);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, kernel);
    const candA = quadFromBinary(edges);

    // 候选 2：Otsu 亮区（白纸占大面积时更稳）
    const bright = keep(new cv.Mat());
    cv.threshold(blur, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const k2 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
    cv.morphologyEx(bright, bright, cv.MORPH_CLOSE, k2);
    const candB = quadFromBinary(bright);

    const valid = [candA, candB].filter((x) => x && x.area > 0.12 && x.area < 0.995);
    valid.sort((a, b) => b.area - a.area);
    if (valid.length) {
      quad = valid[0].quad;
      found = true;
    }
  }
  progress(60, '透视矫正');
  let warped;
  if (quad) {
    const wTop = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
    const wBot = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
    const hL = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    const hR = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
    const tw = Math.max(64, Math.round(Math.max(wTop, wBot)));
    const th = Math.max(64, Math.round(Math.max(hL, hR)));
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      quad[0].x, quad[0].y, quad[1].x, quad[1].y, quad[2].x, quad[2].y, quad[3].x, quad[3].y,
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, tw, 0, tw, th, 0, th]);
    const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
    warped = keep(new cv.Mat());
    cv.warpPerspective(src, warped, M, new cv.Size(tw, th), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    srcPts.delete();
    dstPts.delete();
  } else {
    warped = src;
  }

  progress(72, '去除阴影');
  let result = warped;
  if (mode !== 'original') {
    const sw = Math.max(8, Math.round(warped.cols / 12));
    const sh = Math.max(8, Math.round(warped.rows / 12));
    const smallBg = keep(new cv.Mat());
    cv.resize(warped, smallBg, new cv.Size(sw, sh), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(smallBg, smallBg, new cv.Size(0, 0), 6);
    const bg = keep(new cv.Mat());
    cv.resize(smallBg, bg, new cv.Size(warped.cols, warped.rows), 0, 0, cv.INTER_LINEAR);
    const flat = keep(new cv.Mat());
    cv.divide(warped, bg, flat, 232);
    result = flat;

    if (mode === 'bw') {
      progress(88, '二值化');
      const g = keep(new cv.Mat());
      cv.cvtColor(flat, g, cv.COLOR_RGBA2GRAY);
      const bin = keep(new cv.Mat());
      cv.adaptiveThreshold(g, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 12);
      const k2 = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2, 2)));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k2);
      result = keep(new cv.Mat());
      cv.cvtColor(bin, result, cv.COLOR_GRAY2RGBA);
    } else if (mode === 'gray') {
      progress(88, '灰度增强');
      const g = keep(new cv.Mat());
      cv.cvtColor(flat, g, cv.COLOR_RGBA2GRAY);
      const cl = keep(cv.createCLAHE(2.5, new cv.Size(8, 8)));
      cl.apply(g, g);
      const eq = keep(new cv.Mat());
      cv.equalizeHist(g, eq);
      result = keep(new cv.Mat());
      cv.cvtColor(eq, result, cv.COLOR_GRAY2RGBA);
    } else {
      progress(88, '增强对比');
      const rgb = keep(new cv.Mat());
      cv.cvtColor(flat, rgb, cv.COLOR_RGBA2RGB);
      const lab = keep(new cv.Mat());
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      const planes = keep(new cv.MatVector());
      cv.split(lab, planes);
      const L = keep(planes.get(0));
      const cl = keep(cv.createCLAHE(2.8, new cv.Size(8, 8)));
      cl.apply(L, L);
      planes.set(0, L);
      const merged = keep(new cv.Mat());
      cv.merge(planes, merged);
      const back = keep(new cv.Mat());
      cv.cvtColor(merged, back, cv.COLOR_Lab2RGB);
      result = keep(new cv.Mat());
      cv.cvtColor(back, result, cv.COLOR_RGB2RGBA);
    }
  }

  progress(96, '生成图像');
  const out = new Uint8ClampedArray(result.data.length);
  out.set(result.data);
  const w = result.cols;
  const h = result.rows;

  trash.forEach((m) => { try { m.delete(); } catch (e) { /* ignore */ } });

  return {
    data: out,
    width: w,
    height: h,
    found,
    quad: quad ? quad.map((p) => [p.x, p.y]) : null,
  };
}

self.onmessage = async (e) => {
  const { id, payload, cvUrl, type } = e.data || {};
  if (!id) return;
  if (type === 'warmup') {
    const progress = (pct, label) => self.postMessage({ id, type: 'progress', pct, label });
    try {
      progress(30, '解析图像引擎');
      const cv = await loadCv(cvUrl);
      progress(95, '引擎就绪');
      self.postMessage({ id, type: 'warmup-done', hasMat: !!cv.Mat });
    } catch (err) {
      self.postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
    }
    return;
  }
  const progress = (pct, label) => self.postMessage({ id, type: 'progress', pct, label });
  try {
    const res = await run(payload, progress, cvUrl);
    self.postMessage({ id, type: 'done', result: res }, [res.data.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
  }
};
