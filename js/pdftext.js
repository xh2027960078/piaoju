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
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
      } catch (e) { /* ignore */ }
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('PDF 组件加载失败'));
    document.head.appendChild(s);
  });
  return libPromise;
}

/** 提取 PDF 文字，返回 { text, compact, lines }
 *  lines 按版面行还原（同一 y 坐标的文字拼成一行，行内按 x 排序），
 *  用于定位「价税合计」所在行，避免整段搜索时取到税额。 */
export async function extractText(arrayBuffer) {
  const lib = await loadPdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
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
  try {
    const { text, compact, lines } = await extractText(arrayBuffer);
    if (!compact || compact.length < 12) return null;
    const info = detectInvoice(text, compact, lines);
    info.ok = info.amount != null || !!info.date;
    return info;
  } catch (e) {
    return null;
  }
}
