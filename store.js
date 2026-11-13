/* 全局状态与派生统计 */

import { repo } from './db.js';
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

export function chartData() {
  const months = lastMonths(6);
  const byMonth = months.map((m) => ({ label: m.label, value: 0, key: m.key }));
  const monthIdx = new Map(byMonth.map((m, i) => [m.key, i]));

  const byItem = new Map();
  const byType = new Map();
  const byPeriod = new Map();

  for (const f of state.files) {
    if (f.kind !== 'invoice') continue;
    const amt = Number(f.meta && f.meta.amount) || 0;
    const d = dateOfFile(f);
    if (d) {
      const mi = monthIdx.get(d.slice(0, 7));
      if (mi != null) byMonth[mi].value += amt;
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
