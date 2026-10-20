/* 基于 OpenCV.js 的扫描管线
 * Canny → findContours → approxPolyDP → getPerspectiveTransform → warpPerspective
 * → 光照归一化 → Lab 空间 CLAHE → 可选自适应二值
 */
import { loadOpenCV } from './opencv-loader.js';

/** 把四个点排成 左上、右上、右下、左下 */
function orderPoints(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.y - p.x);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

export async function cvScanDocument(img, opts = {}, onProgress = () => {}) {
  const cv = await loadOpenCV(onProgress);
  const mode = opts.mode || 'auto';
  const maxOut = opts.maxOut || 1600;
  const override = opts.quad || null;
  const wantStages = !!opts.wantStages;
  const stages = {};

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.min(1, maxOut / Math.max(iw, ih));
  const W = Math.round(iw * scale);
  const H = Math.round(ih * scale);

  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const bctx = base.getContext('2d');
  bctx.drawImage(img, 0, 0, W, H);

  onProgress(15, '检测纸张边缘');
  const src = cv.imread(base);
  const trash = [];
  const keep = (m) => { trash.push(m); return m; };

  let quad = null;
  let found = false;

  if (override && override.length === 4) {
    quad = override.map(([x, y]) => ({ x: x * scale, y: y * scale }));
    found = true;
  } else {
    // 检测用小图
    const detScale = Math.min(1, 520 / Math.max(W, H));
    const dw = Math.max(32, Math.round(W * detScale));
    const dh = Math.max(32, Math.round(H * detScale));
    const small = keep(new cv.Mat());
    cv.resize(src, small, new cv.Size(dw, dh), 0, 0, cv.INTER_AREA);

    const gray = keep(new cv.Mat());
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    const blur = keep(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    const edges = keep(new cv.Mat());
    cv.Canny(blur, edges, 50, 150);
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, kernel);

    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < dw * dh * 0.1) { c.delete(); continue; }
      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      if (approx.rows === 4 && area > bestArea) {
        bestArea = area;
        if (best) best.delete();
        best = approx;
      } else {
        approx.delete();
      }
      c.delete();
    }

    if (best && bestArea > dw * dh * 0.12) {
      const pts = [];
      for (let i = 0; i < 4; i++) pts.push({ x: best.data32S[i * 2] / detScale, y: best.data32S[i * 2 + 1] / detScale });
      quad = orderPoints(pts);
      found = true;
    }
    if (best) best.delete();
  }

  onProgress(40, '透视矫正');
  const outW = quad
    ? Math.round(Math.max(Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y), Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y)))
    : W;
  const outH = quad
    ? Math.round(Math.max(Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y), Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y)))
    : H;

  let warped;
  if (quad && outW > 60 && outH > 60) {
    const k = Math.min(1, maxOut / Math.max(outW, outH));
    const tw = Math.max(64, Math.round(outW * k));
    const th = Math.max(64, Math.round(outH * k));
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [quad[0].x, quad[0].y, quad[1].x, quad[1].y, quad[2].x, quad[2].y, quad[3].x, quad[3].y]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, tw, 0, tw, th, 0, th]);
    const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
    warped = keep(new cv.Mat());
    cv.warpPerspective(src, warped, M, new cv.Size(tw, th), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    srcPts.delete();
    dstPts.delete();
    onProgress(55, '去除阴影');
  } else {
    warped = src;
    found = false;
  }

  const rectifiedCanvas = document.createElement('canvas');
  rectifiedCanvas.width = warped.cols;
  rectifiedCanvas.height = warped.rows;
  cv.imshow(rectifiedCanvas, warped);
  if (wantStages) stages.rectified = rectifiedCanvas;

  // ---- 增强 ----
  let result = warped;
  if (mode !== 'original') {
    // 1) 光照归一化：用大核模糊估计背景，再做除法
    const smallBg = keep(new cv.Mat());
    const bw2 = Math.max(8, Math.round(warped.cols / 12));
    const bh2 = Math.max(8, Math.round(warped.rows / 12));
    cv.resize(warped, smallBg, new cv.Size(bw2, bh2), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(smallBg, smallBg, new cv.Size(0, 0), 6);
    const bg = keep(new cv.Mat());
    cv.resize(smallBg, bg, new cv.Size(warped.cols, warped.rows), 0, 0, cv.INTER_LINEAR);

    const flat = keep(new cv.Mat());
    cv.divide(warped, bg, flat, 232);
    if (wantStages) {
      const c = document.createElement('canvas');
      c.width = flat.cols; c.height = flat.rows;
      cv.imshow(c, flat);
      stages.flattened = c;
    }
    result = flat;

    if (mode === 'bw') {
      const g = keep(new cv.Mat());
      cv.cvtColor(flat, g, cv.COLOR_RGBA2GRAY);
      const bin = keep(new cv.Mat());
      cv.adaptiveThreshold(g, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 12);
      // 去掉孤立噪点
      const k3 = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2, 2)));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, k3);
      result = keep(new cv.Mat());
      cv.cvtColor(bin, result, cv.COLOR_GRAY2RGBA);
    } else if (mode === 'gray') {
      const g = keep(new cv.Mat());
      cv.cvtColor(flat, g, cv.COLOR_RGBA2GRAY);
      const cl = keep(new cv.createCLAHE(2.5, new cv.Size(8, 8)));
      cl.apply(g, g);
      const eq = keep(new cv.Mat());
      cv.equalizeHist(g, eq);
      result = keep(new cv.Mat());
      cv.cvtColor(eq, result, cv.COLOR_GRAY2RGBA);
    } else {
      // 彩色：在 Lab 亮度通道上做 CLAHE，保住印章颜色
      const lab = keep(new cv.Mat());
      cv.cvtColor(flat, lab, cv.COLOR_RGBA2RGB);
      cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);
      const planes = keep(new cv.MatVector());
      cv.split(lab, planes);
      const L = keep(planes.get(0));
      const cl = keep(cv.createCLAHE(2.8, new cv.Size(8, 8)));
      cl.apply(L, L);
      planes.set(0, L);
      const merged = keep(new cv.Mat());
      cv.merge(planes, merged);
      const rgb = keep(new cv.Mat());
      cv.cvtColor(merged, rgb, cv.COLOR_Lab2RGB);
      result = keep(new cv.Mat());
      cv.cvtColor(rgb, result, cv.COLOR_RGB2RGBA);
    }
    onProgress(85, '增强对比');
  }

  const out = document.createElement('canvas');
  out.width = result.cols;
  out.height = result.rows;
  cv.imshow(out, result);

  trash.forEach((m) => { try { m.delete(); } catch (e) { /* ignore */ } });
  onProgress(96, '生成图像');

  return {
    canvas: out,
    found,
    quad: quad ? quad.map((p) => [p.x, p.y]) : null,
    width: out.width,
    height: out.height,
    stages,
  };
}
