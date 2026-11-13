/* PDF 文本提取与发票信息识别（离线，基于 pdf.js） */

import { ensurePdfWorker } from './assets.js';

let libPromise = null;

export function loadPdfLib() {
  if (window.pdfjsLib) {
    try {
      const worker = ensurePdfWorker() || window.__PDF_WORKER_URL || '';
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = worker || new URL('vendor/pdf.worker.min.js', location.href).href;
    } catch (e) { /* ignore */ }
    return Promise.resolve(window.pdfjsLib);
  }
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdf.min.js';
    const timer = setTimeout(() => reject(new Error('PDF 组件加载超时，请检查网络后重试')), 20000);
    s.onload = () => {
      clearTimeout(timer);
      if (!window.pdfjsLib) { reject(new Error('PDF 组件未初始化')); return; }
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
      } catch (e) { /* ignore */ }
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error('PDF 组件加载失败（vendor/pdf.min.js 可能没上传）')); };
    document.head.appendChild(s);
  }).catch((err) => { libPromise = null; throw err; });
  return libPromise;
}

/** 提取 PDF 文字，返回 { text, compact, lines }
/** 提取 PDF 文字，返回 { text, compact, lines }
 *  lines 按版面行还原（同一 y 坐标的文字拼成一行，行内按 x 排序），
 *  用于定位「价税合计」所在行，避免整段搜索时取到税额。
 *  若 pdf.js 因内嵌字体异常取不到文字，自动切到自研解析器兜底。 */
export async function extractText(arrayBuffer) {
  let js = null;
  try {
    js = await extractTextViaPdfjs(arrayBuffer);
  } catch (e) {
    js = null;
  }
  if (js && js.compact && js.compact.length >= 12) return js;
  const fb = await extractTextNative(arrayBuffer);
  if (fb && fb.compact && fb.compact.length >= 12) return fb;
  return js || fb || { text: '', compact: '', lines: [] };
}

async function extractTextViaPdfjs(arrayBuffer) {
  const lib = await loadPdfLib();
  // 传副本：pdf.js 会转移 buffer，之后原 buffer 不可再用
  const doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const parts = [];
  const lines = [];
  const maxPages = Math.min(doc.numPages, 5);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      const h = Math.abs(item.height) || Math.abs(tr[3]) || 10;
      items.push({ str: item.str, x: tr[4] || 0, y: tr[5] || 0, h });
      parts.push(item.str);
    }
    // 按 y 从大到小、同一行内按 x 从小到大
    items.sort((a, b) => {
      const tol = Math.max(2, Math.min(a.h, b.h) * 0.6);
      if (Math.abs(b.y - a.y) > tol) return b.y - a.y;
      return a.x - b.x;
    });
    let current = null;
    let lastY = null;
    let lastH = 10;
    for (const it of items) {
      const tol = Math.max(2, Math.min(it.h, lastH) * 0.6);
      if (lastY == null || Math.abs(it.y - lastY) > tol) {
        if (current && current.length) lines.push(current.join(' '));
        current = [];
        lastY = it.y;
      }
      current.push(it.str);
      lastH = it.h;
    }
    if (current && current.length) lines.push(current.join(' '));
  }
  try { doc.destroy(); } catch (e) { /* ignore */ }
  try { doc.destroy(); } catch (e) { /* ignore */ }
  const text = parts.join(' ');
  return { text, compact: text.replace(/\s+/g, ''), lines };
}

/* ---------------- 金额识别 ----------------
   关键：以「价税合计（大写）」的中文大写金额为准，
   先解析大写数字，再在正文里找相等的阿拉伯数字；
   同时排除紧跟在「税额 / 税率 / 单价 / 数量 / 折扣」后面的数字。 */

const CN_DIGIT = { 〇: 0, 零: 0, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 两: 2 };
const CN_UNIT = { 拾: 10, 佰: 100, 仟: 1000 };
const CN_CHARS = '〇零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正两';

/** 解析「伍佰伍拾贰元壹角陆分」这类中文大写金额 */
export function parseChineseAmount(str) {
  if (!str) return null;
  const s = String(str).replace(/整|正/g, '').trim();
  if (!s) return null;
  const [intPart = '', fracPart = ''] = s.split(/[元圆]/);
  let total = 0, section = 0, number = 0;
  for (const ch of intPart) {
    if (ch in CN_DIGIT) number = CN_DIGIT[ch];
    else if (ch in CN_UNIT) { section += (number || 1) * CN_UNIT[ch]; number = 0; }
    else if (ch === '万') { section = (section + number) * 10000; total += section; section = 0; number = 0; }
    else if (ch === '亿') { total = (total + section + number) * 1e8; section = 0; number = 0; }
  }
  total += section + number;
  let decimal = 0;
  const jiao = fracPart.match(/([零壹贰叁肆伍陆柒捌玖])角/);
  const fen = fracPart.match(/([零壹贰叁肆伍陆柒捌玖])分/);
  if (jiao) decimal += CN_DIGIT[jiao[1]] * 0.1;
  if (fen) decimal += CN_DIGIT[fen[1]] * 0.01;
  const val = Math.round((total + decimal) * 100) / 100;
  return val > 0 ? val : null;
}

const NUMBER_RE = /[¥￥]?\s*([0-9][0-9,]*\.[0-9]{2})/g;
const EXCLUDE_BEFORE = /税额|税率|单价|数量|折扣|余额|预付款/;

function toNumber(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

/** 收集正文里所有两位小数的金额候选，并记录位置 */
function collectAmounts(text) {
  const out = [];
  let m;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(text))) {
    const value = toNumber(m[1]);
    if (!value || value <= 0) continue;
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (EXCLUDE_BEFORE.test(before)) continue;
    out.push({ value, index: m.index });
  }
  return out;
}

function pickFromLabel(text, candidates) {
  // 取最后一个「价税合计 / 小写」标签之后的第一个金额
  const labels = [/[（(]\s*小写\s*[）)]/g, /价税合计/g, /价税总计/g, /合计金额|金额合计/g];
  let best = null;
  for (const re of labels) {
    let m;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length;
      const hit = candidates.find((x) => x.index >= start && x.index - start < 60);
      if (hit && (!best || hit.index > best.index)) best = hit;
    }
  }
  return best;
}

/** 在「价税合计 / 小写」所在行取金额；若该行没有数字，看紧邻的下一行 */
function amountFromLines(lines) {
  if (!lines || !lines.length) return null;
  const numsOf = (line) => {
    // 去掉同一行里的「税额 / 税率 / 单价 / 数量」列，避免取到税额
    const cleaned = line.replace(/(税额|税率|单价|数量|折扣)\s*[¥￥]?\s*[0-9][0-9,]*\.?[0-9]{0,2}/g, ' ');
    return [...cleaned.matchAll(/[¥￥]?\s*([0-9][0-9,]*\.[0-9]{2})/g)]
      .map((m) => toNumber(m[1])).filter((n) => n && n > 0);
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!/价税合计|价税总计|小写/.test(line)) continue;
    const nums = numsOf(line);
    if (nums.length) return nums[nums.length - 1];
    // 数字被排到下一行（右侧对齐常见）：取下一行唯一的金额
    for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
      const next = numsOf(lines[j]);
      if (next.length === 1) return next[0];
      if (next.length > 1) break;
    }
  }
  return null;
}

/** 结构校验：金额 + 税额 = 价税合计 */
function structuralTotal(candidates) {
  const vals = [...new Set(candidates.map((c) => c.value))];
  let best = null;
  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals.length; j++) {
      if (i === j) continue;
      const sum = Math.round((vals[i] + vals[j]) * 100) / 100;
      if (sum > vals[i] && sum > vals[j] && vals.some((v) => Math.abs(v - sum) < 0.011)) {
        if (best == null || sum > best) best = sum;
      }
    }
  }
  return best;
}

/** 从发票文字里识别金额 / 日期 / 类型 */
export function detectInvoice(text, compact, lines) {
  const t = text || '';
  const c = compact || t.replace(/\s+/g, '');
  const out = { amount: null, date: '', invoiceType: '', travelType: '', invoiceNo: '', textLen: c.length };

  const candidates = collectAmounts(t);
  const values = [...new Set(candidates.map((x) => x.value))].sort((a, b) => a - b);
  out.candidates = values;

  let upper = null;
  const upperMatch = c.match(/[（(]\s*大写\s*[）)][：:\s]*([〇零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正两]{2,})/)
    || c.match(/价税合计\s*[（(]?\s*大写[）)]?\s*([〇零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正两]{2,})/)
    || c.match(/大写[：:\s]*([〇零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正两]{4,})/);
  if (upperMatch) upper = parseChineseAmount(upperMatch[1]);
  out.upper = upper;

  const lineTotal = amountFromLines(lines);
  const structural = structuralTotal(candidates);
  out.lineTotal = lineTotal;
  out.structural = structural;

  // 1) 大写金额能对上候选值：最可靠
  if (upper && values.some((v) => Math.abs(v - upper) < 0.011)) {
    out.amount = upper;
  }
  // 2) 「价税合计 / 小写」所在行的金额
  if (out.amount == null && lineTotal) out.amount = lineTotal;
  // 3) 金额 + 税额 = 合计
  if (out.amount == null && structural) out.amount = structural;
  // 4) 标签就近匹配
  if (out.amount == null && candidates.length) {
    const byLabel = pickFromLabel(t, candidates);
    if (byLabel) out.amount = byLabel.value;
  }
  // 5) 大写存在但没对上：取最接近大写的候选
  if (out.amount == null && upper && values.length) {
    const nearest = values.reduce((a, b) => (Math.abs(a - upper) <= Math.abs(b - upper) ? a : b));
    if (Math.abs(nearest - upper) / upper < 0.01) out.amount = nearest;
  }
  // 6) 兜底：正文最后一处金额
  if (out.amount == null && candidates.length) out.amount = candidates[candidates.length - 1].value;
  if (out.amount == null) {
    const all = [...t.matchAll(NUMBER_RE)].map((m) => toNumber(m[1])).filter((n) => n && n > 0);
    if (all.length) out.amount = all[all.length - 1];
  }

  const dateMatch = c.match(/(20\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})/);
  if (dateMatch) {
    out.date = `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
  }

  const inv = c.match(/(\d{8,20})/g) || [];
  const invoiceNo = inv.find((x) => x.length >= 8 && x.length <= 20);
  if (invoiceNo) out.invoiceNo = invoiceNo;

  if (/增值税专用发票|专用发票/.test(c)) out.invoiceType = '增值税发票';
  else if (/航空运输电子客票行程单|行程单|机票/.test(c)) out.invoiceType = '机票';
  else if (/铁路电子客票|火车票|铁路/.test(c)) out.invoiceType = '火车票';
  else if (/出租|客运|道路运输|网约车|滴滴|运输服务/.test(c)) out.invoiceType = '其他运输票';
  else if (/普通发票|电子发票/.test(c)) out.invoiceType = '普通发票';
  else if (/收据|收条/.test(c)) out.invoiceType = '其他';

  if (/住宿|酒店|房费/.test(c)) out.travelType = '住宿费';
  else if (/航空|行程单|机票|航班/.test(c)) out.travelType = '航空运输（中国）';
  else if (/铁路|火车|高铁|动车/.test(c)) out.travelType = '铁路车票（中国）';
  else if (/出租|客运|网约车|滴滴|公路|水路|大巴|地铁|公交/.test(c)) out.travelType = '公路、水路等其他客票（中国）';
  else if (out.invoiceType === '普通发票' || out.invoiceType === '增值税发票' || out.invoiceType === '其他') out.travelType = '其他费用';

  return out;
}

/** 对 PDF 文件做识别，返回 detectInvoice 结果；失败返回 null */
export async function detectFromPdf(arrayBuffer) {
  const tries = [];
  // ① pdf.js 解析（正常发票）
  try {
    const a = await extractTextViaPdfjs(arrayBuffer);
    if (a && a.compact && a.compact.length >= 12) tries.push(a);
  } catch (e) { /* 忽略 */ }
  // ② 自研解析（内嵌字体异常时 pdf.js 只拿到标签，金额和税号全丢）
  try {
    const b = await extractTextNative(arrayBuffer);
    if (b && b.compact && b.compact.length >= 12) tries.push(b);
  } catch (e) { /* 忽略 */ }
  if (!tries.length) {
    return { ok: false, amount: null, date: '', textLen: 0, reason: 'no-text' };
  }
  // 两份文字都试；优先返回真正识别到金额的那份，其次取文字更长的
  let best = null;
  for (const src of tries) {
    const info = detectInvoice(src.text, src.compact, src.lines);
    // CreationDate 是模板生成时间，不是开票日期，不采用（日期由文件名兜底）
    info.ok = info.amount != null || !!info.date;
    info.textLen = src.compact.length;
    info.via = src.native ? 'native' : 'pdfjs';
    if (!best) best = info;
    else if (!best.amount && info.amount) best = info;
    else if (!best.amount && !info.amount && (info.textLen || 0) > (best.textLen || 0)) best = info;
    if (best.amount) break;
  }
  return best;
}

/* ---------------- 稳健页面渲染 ----------------
 * 有些电子发票 PDF 用透明组/可选内容/JPX 图片，pdf.js 直接渲染会只剩框线。
 * 这里：正常渲染 → 检测是否几乎空白 → 换打印意图重试 → 仍空白则直接画内嵌图片。 */
function inkRatio(ctx, canvas) {
  try {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return 0;
    const data = ctx.getImageData(0, 0, w, h).data;
    let ink = 0, total = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      total++;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink++;
    }
    return total ? ink / total : 0;
  } catch (e) {
    return 1; // 取不到像素就当有内容，避免误判
  }
}

async function paintEmbeddedImages(page, ctx, viewport) {
  const lib = await loadPdfLib();
  const OPS = lib.OPS || (window.pdfjsLib && window.pdfjsLib.OPS) || {};
  const ops = await page.getOperatorList();
  const want = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageMaskXObject].filter((v) => v !== undefined));
  let painted = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (!want.has(ops.fnArray[i])) continue;
    const args = ops.argsArray[i] || [];
    let img = null;
    if (ops.fnArray[i] === OPS.paintInlineImageXObject) {
      img = args[0];
    } else {
      const id = args[0];
      try { img = page.objs.get(id); } catch (e) { img = null; }
      if (!img) img = await new Promise((res) => { try { page.objs.get(id, res); setTimeout(() => res(null), 1500); } catch (e) { res(null); } });
    }
    if (!img || !img.width || !img.height || !img.data) continue;
    try {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const c2 = cv.getContext('2d');
      const idata = c2.createImageData(img.width, img.height);
      idata.data.set(new Uint8ClampedArray(img.data));
      c2.putImageData(idata, 0, 0);
      ctx.drawImage(cv, 0, 0, viewport.width, viewport.height);
      painted++;
    } catch (e) { /* 跳过这一张 */ }
  }
  return painted;
}

/** 原件只渲染出框线/标签时，把解析出的文字追加在下方 */
function appendTextSection(canvas, text) {
  const W = canvas.width, H = canvas.height;
  const fs = Math.max(12, Math.round(W / 42));
  const lh = Math.round(fs * 1.62);
  const pad = Math.round(W * 0.05);
  const per = Math.max(6, Math.floor((W - pad * 2) / fs));
  const outLines = [];
  for (const para of String(text || '').split(/\s{2,}|\n/)) {
    const s = para.trim();
    if (!s) continue;
    for (let i = 0; i < s.length; i += per) outLines.push(s.slice(i, i + per));
  }
  if (!outLines.length) return 0;
  const extra = pad * 2 + lh * 2 + outLines.length * lh;
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  canvas.width = W;
  canvas.height = H + extra;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0);
  ctx.textBaseline = 'top';
  let y = H + pad;
  ctx.fillStyle = '#8a8a8a';
  ctx.font = '500 ' + Math.round(fs * 0.9) + 'px system-ui,sans-serif';
  ctx.fillText('— 以下为解析出的文字（原件渲染不完整）—', pad, y);
  y += lh;
  ctx.fillStyle = '#111';
  ctx.font = '600 ' + fs + 'px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  for (const line of outLines) {
    ctx.fillText(line, pad, y);
    y += lh;
  }
  return outLines.length;
}

/** 判断是否需要追加文字：pdf.js 拿到了文字，但金额/税号之类只在自研解析里 */
export async function needTextAppendix(page, rawBuffer) {
  const diag = { pjLen: 0, fbLen: 0, err: '' };
  try {
    let pj = '';
    try {
      const c = await page.getTextContent();
      pj = c.items.map((i) => i.str || '').join('');
    } catch (e) {
      pj = '';
      diag.err = 'getTextContent 失败:' + ((e && e.message) || '');
    }
    const fb = await extractTextNative(rawBuffer);
    diag.native = getNativeDiag();
    diag.pjLen = pj.replace(/\s/g, '').length;
    if (!fb || !fb.text) {
      diag.err = (diag.err ? diag.err + ' / ' : '') + '自研解析无文字';
      return { text: null, diag };
    }
    const pjFlat = pj.replace(/\s/g, '');
    const fbFlat = fb.text.replace(/\s/g, '');
    diag.fbLen = fbFlat.length;
    const money = /[¥￥]\s*\d/;
    // pdf.js 的文字里没有金额，但自研解析里有 → 说明关键内容没渲染出来
    if (!money.test(pjFlat) && money.test(fbFlat)) return { text: fb.text, diag };
    // 自研解析比 pdf.js 多出一大截（字体异常导致整块丢失）
    if (fbFlat.length > Math.max(40, pjFlat.length * 1.35)) return { text: fb.text, diag };
    return { text: null, diag };
  } catch (e) {
    diag.err = (diag.err ? diag.err + ' / ' : '') + '异常:' + ((e && e.message) || '');
    return { text: null, diag };
  }
}

/** 渲染空白时，把提取到的文字画成可读页面（至少能看到金额等信息） */
function drawTextFallback(canvas, text) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const fs = Math.max(12, Math.round(W / 34));
  const lh = Math.round(fs * 1.65);
  ctx.fillStyle = '#111';
  ctx.font = `600 ${fs}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;
  ctx.textBaseline = 'top';
  const pad = Math.round(W * 0.05);
  const per = Math.max(6, Math.floor((W - pad * 2) / fs));
  const out = [];
  for (const para of String(text || '').split(/\s{2,}|\n/)) {
    const s = para.trim();
    if (!s) continue;
    for (let i = 0; i < s.length; i += per) out.push(s.slice(i, i + per));
  }
  let y = pad;
  for (const line of out) {
    if (y + lh > H - pad) break;
    ctx.fillText(line, pad, y);
    y += lh;
  }
  return out.length;
}

/** 渲染一页到 canvas；返回 { ok, blank, retried, images, textFallback } */
export async function renderPageRobust(page, viewport, canvas, rawBuffer) {
  const ctx = canvas.getContext('2d');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let retried = false;
  let images = 0;
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (e) { /* 继续兜底 */ }
  let ratio = inkRatio(ctx, canvas);
  if (ratio > 0.002) {
    // 渲染出来了，但金额/税号可能因字体异常缺失：检查后追加文字区
    if (rawBuffer) {
      try {
        const ap = await needTextAppendix(page, rawBuffer);
        if (ap && ap.text) {
          appendTextSection(canvas, ap.text);
          return { ok: true, ink: ratio, appendix: true, text: ap.text, diag: ap.diag };
        }
        if (ap && ap.diag) return { ok: true, ink: ratio, diag: ap.diag };
      } catch (e) { /* 忽略 */ }
    }
    return { ok: true, ink: ratio };
  }
  // 兜底 1：打印意图（有些透明组只在打印模式绘制）
  try {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    retried = true;
    ratio = inkRatio(ctx, canvas);
    if (ratio > 0.002) return { ok: true, ink: ratio, retried };
  } catch (e) { /* 继续 */ }
  // 兜底 2：渲染不出内容但文字层是好的 → 把文字画出来（这类发票最常见）
  if (rawBuffer) {
    try {
      const fb = await extractTextNative(rawBuffer);
      if (fb && fb.text && fb.text.length >= 20) {
        drawTextFallback(canvas, fb.text);
        ratio = inkRatio(ctx, canvas);
        return { ok: ratio > 0.002, ink: ratio, retried, images, textFallback: true, text: fb.text };
      }
    } catch (e) { /* 忽略 */ }
  }
  // 兜底 3：直接画内嵌图片（扫描件发票）
  try { images = await paintEmbeddedImages(page, ctx, viewport); } catch (e) { images = 0; }
  ratio = inkRatio(ctx, canvas);
  return { ok: ratio > 0.002, ink: ratio, retried, images, blank: !(ratio > 0.002) };
}
/* ---------------- 原生 PDF 文字兜底 ----------------
 * 某些发票 PDF 的内嵌字体让 pdf.js 解析失败：页面渲染只剩框线、getTextContent 也拿不到字。
 * 这里自己解析 PDF：解压内容流 → 读 ToUnicode CMap → 还原 (…)Tj / <…>Tj 的真实文字。
 * 不依赖字体渲染，只要能解出 CMap 就能拿到文字。 */

function latin1(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return s;
}

/* 纯 JS DEFLATE 解压（不依赖 DecompressionStream，老 WebView 也能用） */
function inflateRaw(src) {
  let pos = 0;
  let bitbuf = 0;
  let bitcnt = 0;
  const out = [];
  const MAX = 1 << 26;

  const getBit = () => {
    if (bitcnt === 0) {
      if (pos >= src.length) throw new Error('unexpected EOF');
      bitbuf = src[pos++];
      bitcnt = 8;
    }
    const b = bitbuf & 1;
    bitbuf >>= 1;
    bitcnt--;
    return b;
  };
  const getBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= getBit() << i;
    return v;
  };
  const getByte = () => {
    if (bitcnt === 0) {
      if (pos >= src.length) throw new Error('unexpected EOF');
      return src[pos++];
    }
    return getBits(8);
  };

  function buildHuff(lengths) {
    const maxLen = Math.max.apply(null, lengths);
    const counts = new Array(maxLen + 1).fill(0);
    for (const l of lengths) if (l) counts[l]++;
    const offs = new Array(maxLen + 2).fill(0);
    for (let i = 1; i <= maxLen; i++) offs[i + 1] = offs[i] + counts[i];
    const symbol = new Array(lengths.length).fill(0);
    for (let s = 0; s < lengths.length; s++) {
      const l = lengths[s];
      if (l) symbol[offs[l]++] = s;
    }
    return { counts, symbol, maxLen };
  }

  function decodeSym(h) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= h.maxLen; len++) {
      code |= getBit();
      const count = h.counts[len] || 0;
      if (code - first < count) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('bad huffman code');
  }

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  let fixedLen = null;
  let fixedDist = null;

  let final = 0;
  while (!final) {
    final = getBit();
    const type = getBits(2);
    if (type === 0) {
      // stored
      bitcnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) out.push(src[pos++]);
    } else if (type === 1 || type === 2) {
      let lenH;
      let distH;
      if (type === 1) {
        if (!fixedLen) {
          const l = new Array(288);
          for (let i = 0; i < 144; i++) l[i] = 8;
          for (let i = 144; i < 256; i++) l[i] = 9;
          for (let i = 256; i < 280; i++) l[i] = 7;
          for (let i = 280; i < 288; i++) l[i] = 8;
          fixedLen = buildHuff(l);
          fixedDist = buildHuff(new Array(30).fill(5));
        }
        lenH = fixedLen;
        distH = fixedDist;
      } else {
        const hlit = getBits(5) + 257;
        const hdist = getBits(5) + 1;
        const hclen = getBits(4) + 4;
        const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        const clens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clens[order[i]] = getBits(3);
        const clH = buildHuff(clens);
        const lens = [];
        while (lens.length < hlit + hdist) {
          const sym = decodeSym(clH);
          if (sym < 16) lens.push(sym);
          else if (sym === 16) {
            const prev = lens[lens.length - 1];
            const rep = 3 + getBits(2);
            for (let i = 0; i < rep; i++) lens.push(prev);
          } else if (sym === 17) {
            const rep = 3 + getBits(3);
            for (let i = 0; i < rep; i++) lens.push(0);
          } else {
            const rep = 11 + getBits(7);
            for (let i = 0; i < rep; i++) lens.push(0);
          }
        }
        lenH = buildHuff(lens.slice(0, hlit));
        distH = buildHuff(lens.slice(hlit, hlit + hdist));
      }
      for (;;) {
        const sym = decodeSym(lenH);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          const length = LEN_BASE[li] + getBits(LEN_EXTRA[li]);
          const ds = decodeSym(distH);
          const dist = DIST_BASE[ds] + getBits(DIST_EXTRA[ds]);
          const start = out.length - dist;
          for (let i = 0; i < length; i++) out.push(out[start + i]);
        }
        if (out.length > MAX) throw new Error('too large');
      }
    } else {
      throw new Error('bad block type');
    }
  }
  return new Uint8Array(out);
}

/** zlib 包装的 deflate（PDF FlateDecode 用的就是这种） */
export function inflateZlib(src) {
  if (src.length > 2 && (src[0] & 0x0f) === 8) {
    let off = 2;
    if (src[1] & 0x20) off += 4; // FDICT
    return inflateRaw(src.subarray(off));
  }
  return inflateRaw(src);
}

async function inflateBytes(bytes) {
  // 优先用浏览器原生（快）；不可用或失败时用纯 JS 实现（老 WebView 兜底）
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const out = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(out).arrayBuffer());
    } catch (e) { /* 落到纯 JS */ }
  }
  try {
    return inflateZlib(bytes);
  } catch (e) {
    return null;
  }
}

function parseToUnicode(txt) {
  const map = new Map();
  const hex2str = (h) => {
    let s = '';
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const cp = parseInt(h.slice(i, i + 4), 16);
      if (!Number.isNaN(cp)) s += String.fromCharCode(cp);
    }
    return s;
  };
  for (const blk of txt.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(blk))) {
      const cid = parseInt(m[1], 16);
      map.set(cid, hex2str(m[2]));
    }
  }
  for (const blk of txt.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(blk))) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const dst = parseInt(m[3], 16);
      for (let i = 0; i <= Math.min(hi - lo, 512); i++) {
        map.set(lo + i, String.fromCharCode(dst + i));
      }
    }
  }
  return map;
}

/** 纯 JS 解析 PDF 文字（兜底用）；返回 { text, compact, lines } 或 null */
/* 解析过程诊断（用于界面显示，定位失败步骤） */
let nativeDiag = {};
export function getNativeDiag() {
  return nativeDiag;
}

export async function extractTextNative(arrayBuffer) {
  nativeDiag = { step: 'start' };
  try {
    const bytes = new Uint8Array(arrayBuffer);
    nativeDiag.bytes = bytes.length;
    const src = latin1(bytes);
    // 收集对象
    const objs = new Map();
    const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
    let m;
    while ((m = objRe.exec(src))) objs.set(Number(m[1]), m[2]);
    nativeDiag.objects = objs.size;
    if (!objs.size) { nativeDiag.step = 'no-objects'; return null; }

    let streams = 0;
    let inflated = 0;
    let inflatedFailed = 0;
    const streamOf = async (body) => {
      const sm = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
      if (!sm) return null;
      streams++;
      const rawStr = sm[1];
      const start = src.indexOf(sm[0]) + sm[0].indexOf(sm[1]);
      const rawBytes = bytes.subarray(start, start + rawStr.length);
      if (/FlateDecode/.test(body)) {
        const out = await inflateBytes(rawBytes);
        if (out) inflated++;
        else inflatedFailed++;
        return out;
      }
      inflated++;
      return rawBytes;
    };

    // 所有 ToUnicode CMap
    const cmaps = [];
    for (const [, body] of objs) {
      const tu = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
      if (!tu) continue;
      const target = objs.get(Number(tu[1]));
      if (!target) continue;
      const st = await streamOf(target);
      if (!st) continue;
      const cm = parseToUnicode(latin1(st));
      if (cm.size) cmaps.push(cm);
    }
    nativeDiag.streams = streams;
    nativeDiag.inflated = inflated;
    nativeDiag.inflateFailed = inflatedFailed;
    nativeDiag.cmaps = cmaps.length;
    nativeDiag.step = 'cmaps';

    // 文本串还原
    const decodeCids = (raw) => {
      const cids = [];
      for (let i = 0; i + 1 < raw.length; i += 2) cids.push((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
      for (const cm of cmaps) {
        if (cids.every((c) => cm.has(c))) return cids.map((c) => cm.get(c)).join('');
      }
      // 没有匹配的 CMap：CID 常常直接就是 Unicode；只保留 ASCII/中文/常用标点，丢掉乱码
      return cids.map((c) => {
        if (c >= 0x20 && c <= 0x7e) return String.fromCharCode(c);
        if (c >= 0x4e00 && c <= 0x9fff) return String.fromCharCode(c);
        if (c >= 0x3000 && c <= 0x303f) return String.fromCharCode(c);
        if (c === 0xa5 || c === 0xffe5) return '¥';
        return '';
      }).join('');
    };

    const pieces = [];
    for (const [, body] of objs) {
      const st = await streamOf(body);
      if (!st) continue;
      const txt = latin1(st);
      if (txt.indexOf('BT') < 0) continue;
      const re = /\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[((?:[^\[\]]|\\.)*)\]\s*TJ/g;
      let t;
      while ((t = re.exec(txt))) {
        if (t[1] !== undefined) {
          const raw = t[1].replace(/\\([()\\])/g, '$1');
          pieces.push(decodeCids(raw));
        } else if (t[2] !== undefined) {
          const hex = t[2].replace(/\s+/g, '');
          let raw = '';
          for (let i = 0; i + 1 < hex.length; i += 2) raw += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          pieces.push(decodeCids(raw));
        } else if (t[3] !== undefined) {
          const inner = t[3];
          const hre = /\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g;
          let h;
          while ((h = hre.exec(inner))) {
            if (h[1] !== undefined) pieces.push(decodeCids(h[1].replace(/\\([()\\])/g, '$1')));
            else {
              const hex = h[2].replace(/\s+/g, '');
              let raw = '';
              for (let i = 0; i + 1 < hex.length; i += 2) raw += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
              pieces.push(decodeCids(raw));
            }
          }
        }
      }
    }
    nativeDiag.pieces = pieces.length;
    const text = pieces.filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
    if (!text) return null;
    // 日期兜底：取 PDF 创建时间
    let pdfDate = '';
    const cdm = /\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/.exec(src);
    if (cdm) pdfDate = cdm[1] + '-' + cdm[2] + '-' + cdm[3];
    return { text, compact: text.replace(/\s+/g, ''), lines: [text], pdfDate, native: true };
  } catch (e) {
    nativeDiag.step = 'error';
    nativeDiag.err = (e && e.message) || String(e);
    if (/detached/i.test(String(nativeDiag.err))) nativeDiag.err = 'buffer 已被 pdf.js 转移（需传副本）';
    return null;
  }
}
