/* 文档扫描核心：自动找纸张四角 → 透视矫正 → 增强 */

function toGray(data, w, h) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return g;
}

function otsu(grayArr) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < grayArr.length; i++) hist[grayArr[i]]++;
  const total = grayArr.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/** 在降采样图上找出纸张的最大亮色连通块的四个角 */
function detectQuad(grayArr, w, h) {
  const thr = otsu(grayArr);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = grayArr[i] > thr ? 1 : 0;

  const label = new Int32Array(w * h).fill(-1);
  let best = null;
  const stack = new Int32Array(w * h);
  let nextLabel = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = nextLabel;
    let count = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let tl = null;
    let tr = null;
    let br = null;
    let bl = null;
    let tlScore = Infinity;
    let trScore = -Infinity;
    let brScore = -Infinity;
    let blScore = Infinity;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx / w) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const s = x + y;
      const d = x - y;
      if (s < tlScore) { tlScore = s; tl = [x, y]; }
      if (s > brScore) { brScore = s; br = [x, y]; }
      if (d > trScore) { trScore = d; tr = [x, y]; }
      if (d < blScore) { blScore = d; bl = [x, y]; }

      if (x > 0 && mask[idx - 1] && label[idx - 1] < 0) { label[idx - 1] = nextLabel; stack[sp++] = idx - 1; }
      if (x < w - 1 && mask[idx + 1] && label[idx + 1] < 0) { label[idx + 1] = nextLabel; stack[sp++] = idx + 1; }
      if (y > 0 && mask[idx - w] && label[idx - w] < 0) { label[idx - w] = nextLabel; stack[sp++] = idx - w; }
      if (y < h - 1 && mask[idx + w] && label[idx + w] < 0) { label[idx + w] = nextLabel; stack[sp++] = idx + w; }
    }

    nextLabel++;
    const area = (maxX - minX + 1) * (maxY - minY + 1);
    if (!best || area > best.area) {
      best = { area, count, quad: [tl, tr, br, bl], box: [minX, minY, maxX, maxY] };
    }
  }

  if (!best || !best.quad.every(Boolean)) return null;
  const imgArea = w * h;
  if (best.area < imgArea * 0.25) return null;

  // 四角不能太靠近边界，否则说明整张图都是"纸"
  const [minX, minY, maxX, maxY] = best.box;
  const fillsFrame = (maxX - minX) > w * 0.97 && (maxY - minY) > h * 0.97;
  if (fillsFrame) return null;

  return best.quad;
}

/** 解 8 元线性方程：把 dst 四点映射到 src 四点的单应矩阵 */
export function __testHomography(src, dst) { return solveHomography(src, dst); }

function solveHomography(src, dst) {
  // 求 dst -> src 的映射（用于反向采样）
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dst[i];
    const [x, y] = src[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); b.push(y);
  }
  // 高斯消元
  for (let i = 0; i < 8; i++) {
    let piv = i;
    for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-9) return null;
    if (piv !== i) { const t = A[piv]; A[piv] = A[i]; A[i] = t; const tb = b[piv]; b[piv] = b[i]; b[i] = tb; }
    const d = A[i][i];
    for (let c = i; c < 8; c++) A[i][c] /= d;
    b[i] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === i) continue;
      const f = A[r][i];
      if (!f) continue;
      for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return b; // a,b,c,d,e,f,g,h
}

function sampleBilinear(data, w, h, x, y, out, o) {
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] * (1 - dx) + data[i10 + c] * dx;
    const bot = data[i01 + c] * (1 - dx) + data[i11 + c] * dx;
    out[o + c] = top * (1 - dy) + bot * dy;
  }
  out[o + 3] = 255;
}

/** 把四边形区域透视矫正成矩形 */
function warp(srcData, w, h, quad, outW, outH) {
  const dst = [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]];
  const M = solveHomography(quad, dst);
  if (!M) return null;
  const out = new ImageData(outW, outH);
  const od = out.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = M[6] * x + M[7] * y + 1;
      const sx = (M[0] * x + M[1] * y + M[2]) / den;
      const sy = (M[3] * x + M[4] * y + M[5]) / den;
      sampleBilinear(srcData, w, h, sx, sy, od, (y * outW + x) * 4);
    }
  }
  return out;
}

/** 增强：彩色白平衡 / 灰度对比 / 黑白自适应二值 */
function enhance(imageData, mode) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const gray = toGray(data, w, h);

  // 亮度拉伸（2% ~ 98% 分位）
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);

  if (mode === 'bw') {
    // 自适应阈值（积分图）
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum;
      }
    }
    const win = Math.max(15, Math.floor(w / 24));
    const half = win >> 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half);
      const y1 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half);
        const x1 = Math.min(w - 1, x + half);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = integ[(y1 + 1) * (w + 1) + (x1 + 1)] - integ[y0 * (w + 1) + (x1 + 1)]
          - integ[(y1 + 1) * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        const mean = sum / area;
        const v = gray[y * w + x];
        const black = v < mean * 0.88;
        const p = (y * w + x) * 4;
        const val = black ? 0 : 255;
        data[p] = val; data[p + 1] = val; data[p + 2] = val; data[p + 3] = 255;
      }
    }
    return imageData;
  }

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    let v = (gray[i] - lo) / span;
    if (v < 0) v = 0; if (v > 1) v = 1;
    const boosted = Math.pow(v, 0.92) * 255;
    if (mode === 'gray') {
      data[p] = boosted; data[p + 1] = boosted; data[p + 2] = boosted;
    } else {
      // 彩色：按灰度增益缩放 RGB，保持色彩，同时把纸面推白
      const g0 = Math.max(1, gray[i]);
      const k = boosted / g0;
      data[p] = Math.min(255, data[p] * k);
      data[p + 1] = Math.min(255, data[p + 1] * k);
      data[p + 2] = Math.min(255, data[p + 2] * k);
    }
    data[p + 3] = 255;
  }
  return imageData;
}

/**
 * 扫描一张图片：
 * @param {HTMLImageElement} img
 * @param {'auto'|'gray'|'bw'|'color'} mode
 * @param {number} maxOut 输出长边上限
 */
export function scanDocument(img, mode = 'auto', maxOut = 1600) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  // 检测用的小图
  const detW = Math.min(480, iw);
  const detH = Math.round((ih / iw) * detW);
  const det = document.createElement('canvas');
  det.width = detW;
  det.height = detH;
  const dctx = det.getContext('2d');
  dctx.drawImage(img, 0, 0, detW, detH);
  const detData = dctx.getImageData(0, 0, detW, detH);
  const gray = toGray(detData.data, detW, detH);
  const quadSmall = detectQuad(gray, detW, detH);

  // 全分辨率画布
  const scale = Math.min(1, maxOut / Math.max(iw, ih));
  const fullW = Math.round(iw * scale);
  const fullH = Math.round(ih * scale);
  const full = document.createElement('canvas');
  full.width = fullW;
  full.height = fullH;
  const fctx = full.getContext('2d');
  fctx.drawImage(img, 0, 0, fullW, fullH);
  const fullData = fctx.getImageData(0, 0, fullW, fullH);

  let resultData;
  let found = false;
  let quad = null;

  if (quadSmall) {
    quad = quadSmall.map(([x, y]) => [x * (fullW / detW), y * (fullH / detH)]);
    const wTop = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
    const wBot = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
    const hLeft = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
    const hRight = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
    let outW = Math.round(Math.max(wTop, wBot));
    let outH = Math.round(Math.max(hLeft, hRight));
    if (outW > 40 && outH > 40) {
      const k = Math.min(1, maxOut / Math.max(outW, outH));
      outW = Math.round(outW * k);
      outH = Math.round(outH * k);
      const warped = warp(fullData.data, fullW, fullH, quad, outW, outH);
      if (warped) { resultData = warped; found = true; }
    }
  }

  if (!resultData) {
    resultData = fullData;
    quad = [[0, 0], [fullW - 1, 0], [fullW - 1, fullH - 1], [0, fullH - 1]];
  }

  const out = document.createElement('canvas');
  out.width = resultData.width;
  out.height = resultData.height;
  out.getContext('2d').putImageData(enhance(resultData, mode === 'auto' ? 'color' : mode), 0, 0);
  return { canvas: out, found, quad };
}
