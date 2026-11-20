/* 全局状态与派生统计 */

import { repo } from './db.js';
import { dailyAmounts } from './lodging.js';
import { DEFAULT_CHARTS } from './appearance.js';
import { inspectTemplate } from './xlsx.js';


export const DEFAULT_SETTINGS = {
  traveler: '',      // 报销人姓名
  empCode: '',       // 报销人工号（申请人编码）
  dept: '',          // 费用承担部门
  org: '广州艮业信息科技有限公司', // 申请组织
  causa: '出差',     // 事由
  theme: 'blue',     // 主题色
  wallpaper: '',     // 壁纸 dataURL
  charts: { ...DEFAULT_CHARTS },
};


export const state = {
  periods: [],
  files: [],
  settings: { ...DEFAULT_SETTINGS, charts: { ...DEFAULT_CHARTS } },
  template: null,      // { name, importedAt, data: ArrayBuffer }
  templateInfo: null,  // { sheetName, columns }
  loaded: false,
  tab: 'periods',
  screen: 'tabs',
  periodId: null,
  subTab: 'invoice',
  selectMode: false,
  selection: new Set(),
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit() { for (const fn of subs) fn(state); }

export async function loadSettings() {
  const s = await repo.get('settings', null);
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(s || {}),
    charts: { ...DEFAULT_CHARTS, ...((s && s.charts) || {}) },
  };
  const tpl = await repo.get('template', null);
  if (tpl && tpl.data) {
    state.template = tpl;
    try {
      state.templateInfo = await inspectTemplate(tpl.data);
      state.templateInfo.ok = true;
    } catch (e) {
      state.templateInfo = { ok: false, error: e.message };
    }
  }
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await repo.set('settings', state.settings);
}

export async function loadAll() {
  const [periods, files] = await Promise.all([repo.periods(), repo.allFiles()]);
  state.periods = periods;
  state.files = files;
  state.loaded = true;
}

export async function refresh() {
  await loadAll();
  emit();
}

export function periodById(id) {
  return state.periods.find((p) => p.id === id) || null;
}

export function filesOf(periodId, kind) {
  return state.files
    .filter((f) => f.periodId === periodId && (!kind || f.kind === kind))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** 周期内下一张票据/附件的编号（票据、附件各自独立） */
export function nextSeq(periodId, kind) {
  let max = 0;
  filesOf(periodId, kind).forEach((f, i) => { max = Math.max(max, f.seq || (i + 1)); });
  return max + 1;
}

/** 金额未填的票据 / 附件（含编号） */
export function missingRows(periodId) {
  const pick = (list, kind) => list
    .map((f, i) => ({ file: f, kind, seq: f.seq || i + 1 }))
    .filter((x) => !(Number(x.file.meta && x.file.meta.amount) > 0));
  return {
    invoices: pick(filesOf(periodId, 'invoice'), 'invoice'),
    attachments: pick(filesOf(periodId, 'attachment'), 'attachment'),
  };
}

export function amountOf(periodId) {
  return state.files
    .filter((f) => f.periodId === periodId && f.kind === 'invoice')
    .reduce((s, f) => s + (Number(f.meta && f.meta.amount) || 0), 0);
}

export function statsByPeriod() {
  const map = new Map();
  for (const p of state.periods) {
    map.set(p.id, { invoices: 0, attachments: 0, amount: 0, missing: 0 });
  }
  for (const f of state.files) {
    const st = map.get(f.periodId);
    if (!st) continue;
    if (f.kind === 'invoice') {
      st.invoices++;
      st.amount += Number(f.meta && f.meta.amount) || 0;
    } else {
      st.attachments++;
    }
    if (!(Number(f.meta && f.meta.amount) > 0)) st.missing++;
  }
  return map;
}

export function totals() {
  const stats = statsByPeriod();
  let amount = 0, invoices = 0, attachments = 0, missing = 0;
  for (const s of stats.values()) {
    amount += s.amount; invoices += s.invoices; attachments += s.attachments; missing += s.missing;
  }
  return { amount, invoices, attachments, missing, periods: state.periods.length };
}

/** 按「报销状态」拆分的合计：已报销 / 未报销 */
export function totalsByPaid() {
  const stats = statsByPeriod();
  let paid = 0, unpaid = 0, paidCount = 0, unpaidCount = 0;
  let paidInvoices = 0, unpaidInvoices = 0;
  for (const p of state.periods) {
    const s = stats.get(p.id) || { amount: 0, invoices: 0 };
    if (p.reimbursed) {
      paid += s.amount;
      paidInvoices += s.invoices;
      paidCount++;
    } else {
      unpaid += s.amount;
      unpaidInvoices += s.invoices;
      unpaidCount++;
    }
  }
  return {
    paid, unpaid, total: paid + unpaid,
    paidCount, unpaidCount,
    paidInvoices, unpaidInvoices,
    periods: state.periods.length,
  };
}

/** 票据发生日期：优先票据日期，其次周期开始日期 */
export function dateOfFile(f) {
  const m = f.meta || {};
  if (m.date) return String(m.date).slice(0, 10);
  const p = periodById(f.periodId);
  return p ? p.start : '';
}

export function lastMonths(n = 6) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${d.getMonth() + 1}月` });
  }
  return out;
}

/** 汇总比较的时间范围 */
export const CHART_SPANS = [
  { key: 'w1', label: '近一周' },
  { key: 'm1', label: '近1月' },
  { key: 'm6', label: '近半年' },
  { key: 'y1', label: '近一年' },
  { key: 'y5', label: '近5年' },
];

/** 按范围生成柱状图的桶：近1月按 5 天一段、半年/一年按月、5 年按年 */
export function bucketsFor(span = 'm6') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (span === 'w1') {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const k = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
      out.push({ key: k, label: `${s.getMonth() + 1}/${s.getDate()}`, from: k, to: k });
    }
    return out;
  }
  if (span === 'm1') {
    const out = [];
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    for (let i = 0; i < 6; i++) {
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 5);
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 4);
      out.push({
        key: `d${i}`,
        label: `${s.getMonth() + 1}/${s.getDate()}`,
        from: `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`,
        to: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`,
      });
    }
    return out;
  }
  if (span === 'y5') {
    const out = [];
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      out.push({ key: `y${y}`, label: `${y}`, year: String(y) });
    }
    return out;
  }
  if (span === 'y1') {
    // 12 个月：标签只用「M月」，12 根柱宽度放不下年份前缀
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mm = d.getMonth() + 1;
      out.push({ key: `${d.getFullYear()}-${pad(mm)}`, label: `${mm}月` });
    }
    return out;
  }
  return lastMonths(6);
}

/** 把票据日期放进对应的桶 */
function bucketIndex(buckets, span, d) {
  if (!d) return -1;
  if (span === 'm1') {
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (d >= b.from && d <= b.to) return i;
    }
    return -1;
  }
  if (span === 'y5') {
    const y = d.slice(0, 4);
    return buckets.findIndex((b) => b.year === y);
  }
  return buckets.findIndex((b) => b.key === d.slice(0, 7));
}

export function chartData(span = 'm6') {
  const buckets = bucketsFor(span);
  const byMonth = buckets.map((b) => ({ label: b.label, value: 0, key: b.key }));

  const byItem = new Map();
  const byType = new Map();
  const byPeriod = new Map();

  for (const f of state.files) {
    if (f.kind !== 'invoice') continue;
    const amt = Number(f.meta && f.meta.amount) || 0;
    const d = dateOfFile(f);
    if (d) {
      const mi = bucketIndex(buckets, span, d.slice(0, 10));
      if (mi >= 0) byMonth[mi].value += amt;
    }
    const item = (f.meta && f.meta.costItem) || '未分类';
    byItem.set(item, (byItem.get(item) || 0) + amt);
    const type = (f.meta && f.meta.invoiceType) || '未填写';
    byType.set(type, (byType.get(type) || 0) + amt);
    const p = periodById(f.periodId);
    const pname = p ? p.name : '未知周期';
    byPeriod.set(pname, (byPeriod.get(pname) || 0) + amt);
  }

  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));

  return {
    byMonth,
    byItem: sortDesc(byItem),
    byType: sortDesc(byType),
    byPeriod: sortDesc(byPeriod).slice(0, 6),
  };
}
