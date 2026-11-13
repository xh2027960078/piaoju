/* 文档扫描 v4 —— 完整图像处理管线
 * 1) 背景估计用灰度形态学闭运算（大核），真正抹掉文字只留光照
 * 2) 五种模式走不同处理链：原图 / 智能高清 / 去阴影 / 灰度 / 黑白
 * 3) 黑白用 Sauvola 局部自适应阈值 + 小连通域去噪，保住细线手写
 * 4) 光照归一化按比例相除，保留印章、彩色内容色相
 * 5) 透视采样缩小时做 2x2 超采样，避免文字断裂
 * 6) 每个阶段单独产出 canvas，便于对比与导出
 */

function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  return g;
}

/** 单调队列滑窗极值：O(n)，不再对每个像素扫描整个窗口 */
function slidingExtreme(src, w, h, r, isMax) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const deque = new Int32Array(Math.max(w, h));

  const better = isMax ? (a, b) => a >= b : (a, b) => a <= b;

  // 横向
  for (let y = 0; y < h; y++) {
    let head = 0;
    let tail = 0;
    const row = y * w;
    for (let x = 0; x < w + r; x++) {
      if (x < w) {
        const v = src[row + x];
        while (tail > head && better(v, src[row + deque[tail - 1]])) tail--;
        deque[tail++] = x;
      }
      const outX = x - r;
      if (outX >= 0) {
        while (deque[head] < outX - r) head++;
        tmp[row + outX] = src[row + deque[head]];
      }
    }
  }

  // 纵向
  for (let x = 0; x < w; x++) {
    let head = 0;
    let tail = 0;
    for (let y = 0; y < h + r; y++) {
      if (y < h) {
        const v = tmp[y * w + x];
        while (tail > head && better(v, tmp[deque[tail - 1] * w + x])) tail--;
        deque[tail++] = y;
      }
      const outY = y - r;
      if (outY >= 0) {
        while (deque[head] < outY - r) head++;
        out[outY * w + x] = tmp[deque[head] * w + x];
      }
    }
  }
  return out;
}
function grayClose(gray, w, h, r) {
  return slidingExtreme(slidingExtreme(gray, w, h, r, true), w, h, r, false);
}

function median3(src, w, h) {
  const out = new Float32Array(w * h);
  const buf = new Float32Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          buf[n++] = src[yy * w + xx];
        }
      }
      for (let i = 1; i < 9; i++) {
        const v = buf[i];
        let j = i - 1;
        while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
        buf[j + 1] = v;
      }
      out[y * w + x] = buf[4];
    }
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const div = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / div;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / div;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function percentiles(arr, lo, hi) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < arr.length; i++) hist[Math.min(255, Math.max(0, arr[i] | 0))]++;
  let acc = 0;
  let pLo = 0;
  let pHi = 255;
  const n = arr.length;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * lo) { pLo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * hi) { pHi = v; break; } }
  return [pLo, pHi];
}

function clahe(gray, w, h, tiles, clipLimit) {
  const tw = Math.ceil(w / tiles);
  const th = Math.ceil(h / tiles);
  const luts = [];
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x0 = tx * tw;
      const y0 = ty * th;
      const x1 = Math.min(w, x0 + tw);
      const y1 = Math.min(h, y0 + th);
      const hist = new Float64Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.min(255, Math.max(0, gray[y * w + x] | 0))]++;
          count++;
        }
      }
      if (!count) count = 1;
      const limit = Math.max(1, (clipLimit * count) / 256);
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
      }
      const add = excess / 256;
      for (let i = 0; i < 256; i++) hist[i] += add;
      const lut = new Uint8ClampedArray(256);
      let acc = 0;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        lut[i] = Math.round((acc / count) * 255);
      }
      luts.push(lut);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(tiles - 1, Math.max(0, y / th - 0.5));
    const ty0 = Math.floor(fy);
    const ty1 = Math.min(tiles - 1, ty0 + 1);
    const wy = fy - ty0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tiles - 1, Math.max(0, x / tw - 0.5));
      const tx0 = Math.floor(fx);
      const tx1 = Math.min(tiles - 1, tx0 + 1);
      const wx = fx - tx0;
      const v = Math.min(255, Math.max(0, gray[y * w + x] | 0));
      const l00 = luts[ty0 * tiles + tx0][v];
      const l10 = luts[ty0 * tiles + tx1][v];
      const l01 = luts[ty1 * tiles + tx0][v];
      const l11 = luts[ty1 * tiles + tx1][v];
      const top = l00 * (1 - wx) + l10 * wx;
      const bot = l01 * (1 - wx) + l11 * wx;
      out[y * w + x] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

function unsharp(gray, w, h, radius, amount, clampMax) {
  const blur = boxBlur(gray, w, h, radius);
  const out = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    let d = (gray[i] - blur[i]) * amount;
    if (d > clampMax) d = clampMax;
    if (d < -clampMax) d = -clampMax;
    const v = gray[i] + d;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

function sauvola(gray, w, h, win, k, r) {
  const iw = w + 1;
  const sum = new Float64Array(iw * (h + 1));
  const sum2 = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    let row2 = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      row += v;
      row2 += v * v;
      sum[(y + 1) * iw + (x + 1)] = sum[y * iw + (x + 1)] + row;
      sum2[(y + 1) * iw + (x + 1)] = sum2[y * iw + (x + 1)] + row2;
    }
  }
  const half = win >> 1;
  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = sum[(y1 + 1) * iw + (x1 + 1)] - sum[y0 * iw + (x1 + 1)]
        - sum[(y1 + 1) * iw + x0] + sum[y0 * iw + x0];
      const s2 = sum2[(y1 + 1) * iw + (x1 + 1)] - sum2[y0 * iw + (x1 + 1)]
        - sum2[(y1 + 1) * iw + x0] + sum2[y0 * iw + x0];
      const mean = s / area;
      const variance = Math.max(0, s2 / area - mean * mean);
      const std = Math.sqrt(variance);
      const threshold = mean * (1 + k * (std / r - 1));
      bin[y * w + x] = gray[y * w + x] < threshold ? 0 : 1;
    }
  }
  return bin;
}

function despeckle(bin, w, h, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = Uint8Array.from(bin);
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const comp = [start];
    while (sp > 0) {
      const cur = stack[--sp];
      const x = cur % w;
      const y = (cur / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!bin[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; comp.push(ni); }
        }
      }
    }
    if (comp.length < minArea) {
      for (const i of comp) out[i] = 1;
    }
  }
  return out;
}

/* ---------- 检测 ---------- */

function otsu(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, gray[i] | 0))]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function dilateBin(bin, w, h, times) {
  let cur = bin;
  for (let t = 0; t < times; t++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) { out[i] = 1; continue; }
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (cur[ny * w + nx]) { on = 1; break; }
          }
        }
        out[i] = on;
      }
    }
    cur = out;
  }
  return cur;
}

function erodeBin(bin, w, h, times) {
  let cur = bin;
  for (let t = 0; t < times; t++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) { out[i] = 0; continue; }
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (!cur[ny * w + nx]) { keep = 0; break; }
          }
        }
        out[i] = keep;
      }
    }
    cur = out;
  }
  return cur;
}

function largestComponent(bin, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null;
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pts = [];
    let count = 0;
    while (sp > 0) {
      const cur = stack[--sp];
      const x = cur % w;
      const y = (cur / w) | 0;
      pts.push(x, y);
      count++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (bin[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; }
        }
      }
    }
    if (!best || count > best.count) best = { pts, count };
  }
  return best;
}

function convexHull(pts) {
  const n = pts.length / 2;
  const arr = [];
  for (let i = 0; i < n; i++) arr.push([pts[i * 2], pts[i * 2 + 1]]);
  arr.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of arr) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function triArea(a, b, c) {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

function orderQuad(quad) {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const ordered = quad.slice().sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let startIdx = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = ordered[i][0] + ordered[i][1];
    if (s < bestSum) { bestSum = s; startIdx = i; }
  }
  return [ordered[startIdx], ordered[(startIdx + 1) % 4], ordered[(startIdx + 2) % 4], ordered[(startIdx + 3) % 4]];
}

function maxAreaQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  const maxN = Math.min(n, 110);
  let best = null;
  let bestArea = 0;
  for (let i = 0; i < maxN; i++) {
    for (let j = i + 2; j < maxN; j++) {
      if (i === 0 && j === maxN - 1) continue;
      let kBest = -1;
      let kArea = -1;
      for (let k = i + 1; k < j; k++) {
        const a = triArea(hull[i], hull[j], hull[k]);
        if (a > kArea) { kArea = a; kBest = k; }
      }
      let lBest = -1;
      let lArea = -1;
      for (let m = j + 1; m < maxN; m++) {
        const a = triArea(hull[i], hull[j], hull[m]);
        if (a > lArea) { lArea = a; lBest = m; }
      }
      for (let m = 0; m < i; m++) {
        const a = triArea(hull[i], hull[j], hull[m]);
        if (a > lArea) { lArea = a; lBest = m; }
      }
      if (kBest < 0 || lBest < 0) continue;
      const total = kArea + lArea;
      if (total > bestArea) {
        bestArea = total;
        best = [hull[i], hull[kBest], hull[j], hull[lBest]];
      }
    }
  }
  return best ? { quad: orderQuad(best), area: bestArea } : null;
}

function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function quadValid(quad, w, h) {
  if (!isConvex(quad)) return false;
  const ratio = quadArea(quad) / (w * h);
  if (ratio < 0.15 || ratio > 0.995) return false;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < Math.min(w, h) * 0.2) return false;
  }
  return true;
}

/** 用纸张区域点集拟合四条边，取相邻边交点做亚像素精修 */
function refineCorners(pts, quad, w, h) {
  const n = pts.length / 2;
  if (n < 200) return quad;
  const ptsArr = [];
  for (let i = 0; i < n; i++) ptsArr.push([pts[i * 2], pts[i * 2 + 1]]);

  const fitLine = (a, b) => {
    const ax = a[0];
    const ay = a[1];
    const bx = b[0];
    const by = b[1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const tol = Math.max(3, len * 0.05);
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let m = 0;
    for (const p of ptsArr) {
      const vx = p[0] - ax;
      const vy = p[1] - ay;
      const t = vx * ux + vy * uy;
      if (t < len * 0.1 || t > len * 0.9) continue;
      if (Math.abs(vx * uy - vy * ux) > tol) continue;
      sx += p[0]; sy += p[1];
      sxx += p[0] * p[0]; sxy += p[0] * p[1];
      m++;
    }
    if (m < 12) return { x0: ax, y0: ay, dx: ux, dy: uy };
    const denom = m * sxx - sx * sx;
    if (Math.abs(denom) < 1e-6) return { x0: ax, y0: ay, dx: ux, dy: uy };
    const slope = (m * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / m;
    const nx = slope;
    const ny = -1;
    const nl = Math.hypot(nx, ny);
    return { x0: 0, y0: intercept, dx: nx / nl, dy: ny / nl };
  };

  const lines = [];
  for (let i = 0; i < 4; i++) lines.push(fitLine(quad[i], quad[(i + 1) % 4]));

  const intersect = (l1, l2) => {
    const x1 = l1.x0;
    const y1 = l1.y0;
    const x2 = l1.x0 + l1.dx;
    const y2 = l1.y0 + l1.dy;
    const x3 = l2.x0;
    const y3 = l2.y0;
    const x4 = l2.x0 + l2.dx;
    const y4 = l2.y0 + l2.dy;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-9) return null;
    const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
    const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;
    return [px, py];
  };

  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = intersect(lines[(i + 3) % 4], lines[i]);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return quad;
    if (Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) > Math.min(w, h) * 0.05) return quad;
    out.push([p[0], p[1]]);
  }
  return quadValid(out, w, h) ? out : quad;
}

function detectQuad(gray, w, h) {
  const t = otsu(gray);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = gray[i] > Math.max(10, t * 0.92) ? 1 : 0;
  const closed = erodeBin(dilateBin(mask, w, h, 3), w, h, 3);
  const comp = largestComponent(closed, w, h);

  if (comp && comp.count > w * h * 0.05) {
    const q = maxAreaQuad(convexHull(comp.pts));
    if (q && quadValid(q.quad, w, h)) return refineCorners(comp.pts, q.quad, w, h);
  }

  // 兜底：梯度边缘连通域
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      if (Math.abs(gx) + Math.abs(gy) > 40) edge[i] = 1;
    }
  }
  const e2 = dilateBin(edge, w, h, 2);
  const comp2 = largestComponent(e2, w, h);
  if (comp2) {
    const q = maxAreaQuad(convexHull(comp2.pts));
    if (q && quadValid(q.quad, w, h)) return refineCorners(comp2.pts, q.quad, w, h);
  }
  return null;
}

/* ---------- 透视变换 ---------- */

export function __testHomography(src, dst) { return solveHomography(src, dst); }

function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dst[i];
    const [x, y] = src[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); b.push(y);
  }
  for (let i = 0; i < 8; i++) {
    let piv = i;
    for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-9) return null;
    if (piv !== i) {
      const t = A[piv]; A[piv] = A[i]; A[i] = t;
      const tb = b[piv]; b[piv] = b[i]; b[i] = tb;
    }
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
  return b;
}

function bilinear(data, w, h, x, y, out, o) {
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > w - 1) x = w - 1;
  if (y > h - 1) y = h - 1;
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

function warp(srcData, w, h, quad, outW, outH) {
  const dst = [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]];
  const M = solveHomography(quad, dst);
  if (!M) return null;
  const out = new ImageData(outW, outH);
  const od = out.data;

  const srcW = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const ss = srcW / outW > 1.4 ? 2 : 1;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 4;
      if (ss === 1) {
        const den = M[6] * x + M[7] * y + 1;
        bilinear(srcData, w, h, (M[0] * x + M[1] * y + M[2]) / den, (M[3] * x + M[4] * y + M[5]) / den, od, o);
      } else {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const fx = x + (sx ? 0.25 : -0.25);
            const fy = y + (sy ? 0.25 : -0.25);
            const den = M[6] * fx + M[7] * fy + 1;
            const sample = [0, 0, 0, 255];
            bilinear(srcData, w, h, (M[0] * fx + M[1] * fy + M[2]) / den, (M[3] * fx + M[4] * fy + M[5]) / den, sample, 0);
            r += sample[0] / 4;
            g += sample[1] / 4;
            b += sample[2] / 4;
          }
        }
        od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = 255;
      }
    }
  }
  return out;
}

/** 裁掉四周残留的背景条带（按列/行平均亮度与纸面中位数比较） */
function trimBorders(data, w, h) {
  const colMean = new Float32Array(w);
  const rowMean = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += data[(y * w + x) * 4];
    rowMean[y] = s / w;
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) s += data[(y * w + x) * 4];
    colMean[x] = s / h;
  }
  const sorted = Array.from(colMean).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 255;
  const limit = Math.max(24, median * 0.78);

  let left = 0;
  while (left < w * 0.08 && colMean[left] < limit) left++;
  let right = w - 1;
  while (right > w * 0.92 && colMean[right] < limit) right--;
  let top = 0;
  while (top < h * 0.08 && rowMean[top] < limit) top++;
  let bottom = h - 1;
  while (bottom > h * 0.92 && rowMean[bottom] < limit) bottom--;

  const outW = right - left + 1;
  const outH = bottom - top + 1;
  if (outW < w * 0.8 || outH < h * 0.8) return { data, w, h };
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const si = ((y + top) * w + (x + left)) * 4;
      const di = (y * outW + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = 255;
    }
  }
  return { data: out, w: outW, h: outH };
}
/* ---------- 处理阶段 ---------- */

function canvasFrom(data, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return cv;
}

function flattenLight(data, w, h, kernel) {
  const gray = toGray(data, w, h);
  const bg = grayClose(gray, w, h, kernel);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const b = Math.max(20, bg[i]);
    const k = 232 / b;
    out[p] = Math.min(255, data[p] * k);
    out[p + 1] = Math.min(255, data[p + 1] * k);
    out[p + 2] = Math.min(255, data[p + 2] * k);
    out[p + 3] = 255;
  }
  return out;
}

function enhanceLuma(data, w, h, clip, amount) {
  const base = toGray(data, w, h);
  // 局部对比（大半径反锐化），不改变整体灰度电平，避免 CLAHE 在多峰直方图上塌陷
  const r = Math.max(2, Math.round(Math.min(w, h) / 160));
  const boost = unsharp(base, w, h, r, amount * 1.6, 48);

  // 黑白点用分位数定标：纸 → 255，字 → 0
  // 文档里纸面通常 >90% 像素：黑点取 2 分位（笔画），白点取 70 分位（纸面）
  let [lo] = percentiles(boost, 0.02, 0.70);
  let [, hi] = percentiles(boost, 0.02, 0.70);
  if (hi - lo < 25) {
    const p = percentiles(boost, 0.02, 0.95);
    lo = p[0];
    hi = p[1];
  }
  if (hi - lo < 25) hi = lo + 30;
  const span = Math.max(20, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    lut[v] = Math.round(Math.pow(t, 0.9) * 255);
  }

  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    let target = lut[Math.min(255, Math.max(0, boost[i] | 0))];
    // 纸面硬切纯白、文字再压深一档，去掉"照片灰"
    if (target > 242) target = 255;
    else if (target < 110) target *= 0.82;
    const src = Math.max(1, base[i]);
    let k = target / src;
    if (k < 0.12) k = 0.12;
    if (k > 2.8) k = 2.8;
    // 彩色内容（印章、红章、彩色标注）不做压黑处理，保住色相
    const sat = Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
    if (sat > 45 && k < 0.7) k = 0.7;
    let r = Math.min(255, data[p] * k);
    let g = Math.min(255, data[p + 1] * k);
    let b = Math.min(255, data[p + 2] * k);
    // 只对亮部（纸面）去色偏，印章/红章等彩色内容原样保留
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum > 190) {
      const t = Math.min(1, (lum - 190) / 50);
      r = r + (lum - r) * t;
      g = g + (lum - g) * t;
      b = b + (lum - b) * t;
    }
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 255;
  }
  return out;
}
function toGrayImage(data) {
  const out = new Uint8ClampedArray(data.length);
  for (let p = 0; p < data.length; p += 4) {
    const g = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    out[p] = g; out[p + 1] = g; out[p + 2] = g; out[p + 3] = 255;
  }
  return out;
}

function bwImage(data, w, h) {
  const gray = toGray(data, w, h);
  const win = Math.max(15, Math.round(w / 45) | 1);
  let bin = sauvola(gray, w, h, win, 0.3, 128);
  bin = despeckle(bin, w, h, 2);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = bin[i] ? 255 : 0;
    out[p] = v; out[p + 1] = v; out[p + 2] = v; out[p + 3] = 255;
  }
  return out;
}

/* ---------- 主入口 ---------- */

export const SCAN_MODES = ['original', 'auto', 'shadow', 'gray', 'bw'];

export async function scanDocumentAsync(img, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
  onProgress(2, '准备');
  await yieldFrame();
  const result = scanDocument(img, opts, (pct, label) => onProgress(pct, label));
  onProgress(100, '完成');
  return result;
}

/** 只做检测：返回原图像素坐标的四角（用于角点编辑器重新识别） */
export function detectQuadOnImage(img, maxDetect = 560) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const detW = Math.min(maxDetect, iw);
  const detH = Math.round((ih / iw) * detW);
  const det = document.createElement('canvas');
  det.width = detW;
  det.height = detH;
  const dctx = det.getContext('2d');
  dctx.drawImage(img, 0, 0, detW, detH);
  const gray = toGray(dctx.getImageData(0, 0, detW, detH).data, detW, detH);
  const q = detectQuad(gray, detW, detH);
  if (!q) return null;
  return q.map(([x, y]) => [Math.round(x * (iw / detW)), Math.round(y * (ih / detH))]);
}

export function scanDocument(img, opts = {}, progress) {
  const mode = opts.mode || 'auto';
  const maxOut = opts.maxOut || 1800;
  const override = opts.quad || null;
  const wantStages = !!opts.wantStages;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const detW = Math.min(520, iw);
  const detH = Math.round((ih / iw) * detW);
  const det = document.createElement('canvas');
  det.width = detW;
  det.height = detH;
  const dctx = det.getContext('2d');
  dctx.drawImage(img, 0, 0, detW, detH);
  const detGray = toGray(dctx.getImageData(0, 0, detW, detH).data, detW, detH);

  const report = progress || (() => {});
  report(8, '检测纸张边缘');
  let quadSmall;
  if (override && override.length === 4) {
    quadSmall = override.map(([x, y]) => [x * (detW / iw), y * (detH / ih)]);
  } else {
    quadSmall = detectQuad(detGray, detW, detH);
  }

  report(22, '读取原图');
  const scale = Math.min(1, maxOut / Math.max(iw, ih));
  const fullW = Math.round(iw * scale);
  const fullH = Math.round(ih * scale);
  const full = document.createElement('canvas');
  full.width = fullW;
  full.height = fullH;
  const fctx = full.getContext('2d');
  fctx.drawImage(img, 0, 0, fullW, fullH);
  const fullData = fctx.getImageData(0, 0, fullW, fullH).data;

  let data = fullData;
  let W = fullW;
  let H = fullH;
  let found = false;
  let quad = null;

  if (quadSmall) {
    quad = quadSmall.map(([x, y]) => [x * (fullW / detW), y * (fullH / detH)]);
    if (!override) {
      const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
      const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
      quad = quad.map(([x, y]) => [x + (cx - x) * 0.022, y + (cy - y) * 0.022]);
    }
    const wTop = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
    const wBot = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
    const hLeft = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
    const hRight = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
    let outW = Math.round(Math.max(wTop, wBot));
    let outH = Math.round(Math.max(hLeft, hRight));
    if (outW > 60 && outH > 60) {
      const k = Math.min(1, maxOut / Math.max(outW, outH));
      outW = Math.round(outW * k);
      outH = Math.round(outH * k);
      report(38, '透视矫正');
      const warped = warp(fullData, fullW, fullH, quad, outW, outH);
      if (warped) {
        data = warped.data;
        W = outW;
        H = outH;
        found = true;
      }
    }
  }

  report(58, '裁掉边缘');
  const trimmed = trimBorders(data, W, H);
  data = trimmed.data;
  W = trimmed.w;
  H = trimmed.h;

  const cropX = Math.round(W * 0.018);
  const cropY = Math.round(H * 0.018);
  const cW = Math.max(32, W - cropX * 2);
  const cH = Math.max(32, H - cropY * 2);
  const cropped = new Uint8ClampedArray(cW * cH * 4);
  for (let y = 0; y < cH; y++) {
    const srcRow = (y + cropY) * W + cropX;
    const dstRow = y * cW;
    for (let x = 0; x < cW; x++) {
      const si = (srcRow + x) * 4;
      const di = (dstRow + x) * 4;
      cropped[di] = data[si];
      cropped[di + 1] = data[si + 1];
      cropped[di + 2] = data[si + 2];
      cropped[di + 3] = 255;
    }
  }

  const kernel = Math.max(9, Math.round(Math.min(cW, cH) / 32) | 1);
  const stages = {};
  if (wantStages) stages.rectified = canvasFrom(cropped, cW, cH);

  let outData;
  if (mode === 'original') {
    outData = cropped;
  } else if (mode === 'shadow') {
    report(72, '去除阴影');
    outData = flattenLight(cropped, cW, cH, kernel);
  } else if (mode === 'gray') {
    const flat = flattenLight(cropped, cW, cH, kernel);
    outData = toGrayImage(enhanceLuma(flat, cW, cH, 2.4, 0.45));
  } else if (mode === 'bw') {
    const flat = flattenLight(cropped, cW, cH, kernel);
    outData = bwImage(flat, cW, cH);
  } else {
    report(72, '去除阴影');
    const flat = flattenLight(cropped, cW, cH, kernel);
    if (wantStages) stages.flattened = canvasFrom(flat, cW, cH);
    report(84, '增强对比');
    outData = enhanceLuma(flat, cW, cH, 2.8, 0.55);
  }

  report(96, '生成图像');
  const outCanvas = canvasFrom(outData, cW, cH);
  if (wantStages) stages.final = outCanvas;
  return { canvas: outCanvas, found, quad, width: cW, height: cH, stages };
}
