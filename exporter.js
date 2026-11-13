/* 导出：ZIP 打包、报销单数据组装 */

import { repo } from './db.js';
import { fillTemplate } from './xlsx.js';
import { periodById, state } from './store.js';

const OPTIONS = window.OPTIONS || { costItems: [], travelTypes: [], departments: [], projects: [] };

export function safeName(name, fallback = '未命名') {
  let s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  s = s.replace(/\s+/g, ' ').slice(0, 80);
  return s || fallback;
}

function uniqueName(used, name) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base}(${i})${ext}`)) i++;
  const out = `${base}(${i})${ext}`;
  used.add(out);
  return out;
}

export function zipFileName(prefix = '') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (prefix ? prefix + '_' : '') + `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function codeOf(list, name) {
  if (!name) return '';
  const hit = (list || []).find((x) => x.name === name);
  return hit ? hit.code : '';
}

/**
 * 打包 ZIP
 * groupBy = 'project'：票据按项目中心分文件夹，附件统一放「附件」
 * groupBy = 'period' ：按周期分文件夹（旧结构）
 */
export async function buildZip({
  periodIds, zipName, includeInvoices = true, includeAttachments = true,
  groupBy = 'project', onProgress,
}) {
  const zip = new JSZip();
  const root = safeName(zipName || zipFileName(), '导出');
  let total = 0, done = 0;

  const plans = [];
  for (const pid of periodIds) {
    const p = periodById(pid);
    if (!p) continue;
    const files = state.files.filter((f) => f.periodId === pid &&
      ((f.kind === 'invoice' && includeInvoices) || (f.kind === 'attachment' && includeAttachments)));
    const list = files.sort((a, b) => (a.shotAt || a.createdAt) - (b.shotAt || b.createdAt));
    total += list.length;
    plans.push({ period: p, files: list });
  }
  if (onProgress) onProgress(0, total);

  const usedByFolder = new Map();
  const push = (folder, fname, data) => {
    const key = folder;
    if (!usedByFolder.has(key)) usedByFolder.set(key, new Set());
    const name = uniqueName(usedByFolder.get(key), fname);
    zip.file(`${folder}/${name}`, data, { binary: true });
  };

  for (const plan of plans) {
    const pname = safeName(plan.period.name, '周期');
    for (const kind of ['invoice', 'attachment']) {
      for (const f of plan.files.filter((x) => x.kind === kind)) {
        const buf = await repo.data(f.id);
        if (!buf) { done++; continue; }
        const fname = safeName(f.name, '文件');
        if (groupBy === 'period') {
          const label = kind === 'invoice' ? '票据' : '附件';
          push(`${root}/${pname}/${label}`, fname, buf);
        } else if (kind === 'attachment') {
          push(`${root}/附件`, fname, buf);
        } else {
          const proj = safeName((f.meta && f.meta.project) || '', '未指定项目中心');
          push(`${root}/发票夹/${proj}`, fname, buf);
        }
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
  }

  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } },
    (meta) => { if (onProgress) onProgress(total, total, meta.percent); },
  );
  return { blob, count: total, root };
}

export function singleFileName(file) {
  return safeName(file.name, '文件');
}

/** 根据周期内的票据生成报销单数据行（含编码与税率） */
export function rowsForTemplate(periodIds) {
  const rows = [];
  const skipped = [];
  const ordered = periodIds
    .map((id) => periodById(id))
    .filter(Boolean)
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  for (const p of ordered) {
    const files = state.files
      .filter((f) => f.periodId === p.id && f.kind === 'invoice')
      .sort((a, b) => (a.shotAt || a.createdAt) - (b.shotAt || b.createdAt));
    for (const f of files) {
      const m = f.meta || {};
      const amount = Number(m.amount) || 0;
      if (!amount) { skipped.push(f); continue; }
      const travelType = m.travelType || '其他费用';
      const costItem = m.costItem || '差旅费';
      const dept = m.dept || state.settings.dept || '';
      const project = m.project || '';
      rows.push({
        costItem, travelType, dept, project,
        startDate: p.start || m.date,
        endDate: p.end || m.date,
        invoiceDate: m.date || p.start,
        from: m.from || p.from || '',
        to: m.to || p.to || '',
        amount,
        invoiceType: m.invoiceType || '普通发票',
        remark: [p.name, m.remark].filter(Boolean).join(' '),
        codes: {
          costItem: codeOf(OPTIONS.costItems, costItem),
          travelType: codeOf(OPTIONS.travelTypes, travelType),
          dept: codeOf(OPTIONS.departments, dept),
          project: codeOf(OPTIONS.projects, project),
        },
      });
    }
  }
  return { rows, skipped };
}

export async function buildReimbursement(periodIds, opts = {}) {
  const { rows } = rowsForTemplate(periodIds);
  if (!rows.length) throw new Error('所选周期中没有已填写金额的票据');
  const tpl = state.template;
  if (!tpl || !tpl.data) throw new Error('尚未导入报销单模板');
  const s = state.settings;
  const blob = await fillTemplate(tpl.data, rows, {
    traveler: opts.traveler != null ? opts.traveler : s.traveler,
    empCode: s.empCode,
    dept: s.dept,
    org: s.org,
    causa: s.causa || '出差',
    headerCodes: {
      org: codeOf(OPTIONS.orgs || [], s.org),
      dept: codeOf(OPTIONS.departments, s.dept),
    },
  });
  return { blob, rows };
}
