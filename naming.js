/* 文件命名规则：项目中心 + 费用项目 + 备注 + 金额 */

import { state } from './store.js';

const MIME_EXT = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

export function extOf(name, mime) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,6})$/);
  if (m) return '.' + m[1].toLowerCase();
  return MIME_EXT[mime || ''] || '';
}

export function fmtAmount(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '';
  const s = v.toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

function clean(s, max = 24) {
  return String(s || '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** 按「项目中心-费用项目-备注-金额」生成文件名，保留原扩展名 */
export function buildFileName(meta, originalName, mime) {
  const m = meta || {};
  const parts = [
    clean(m.project, 26),
    clean(m.costItem, 16),
    clean(m.remark, 24),
    fmtAmount(m.amount),
  ].filter(Boolean);
  if (!parts.length) return originalName;
  let base = parts.join('-').slice(0, 90);
  return base + extOf(originalName, mime);
}

/** 同一周期内重名时追加 (2)(3)… */
export function uniqueNameInPeriod(periodId, name, exceptId) {
  const used = new Set(
    state.files.filter((f) => f.periodId === periodId && f.id !== exceptId).map((f) => f.name),
  );
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base}(${i})${ext}`)) i++;
  return `${base}(${i})${ext}`;
}

export function renamed(file, meta) {
  const name = buildFileName(meta, file.name, file.mime);
  return uniqueNameInPeriod(file.periodId, name, file.id);
}
