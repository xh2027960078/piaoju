/* 住宿费按天均摊：把一张住宿发票的金额平均分配到入住期间的每一天 */

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** 入住天数（含首尾）：10-01 ~ 10-03 = 3 天 */
export function stayDays(start, end) {
  const a = parseDay(start);
  const b = parseDay(end);
  if (!a || !b || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** 判断某张票据是否按住宿均摊 */
export function isLodging(f) {
  const m = (f && f.meta) || {};
  if (Number(m.amount) <= 0) return false;
  if (!m.stayStart || !m.stayEnd) return false;
  return stayDays(m.stayStart, m.stayEnd) > 0;
}

/**
 * 计算每日金额
 * 返回 { map: Map<'YYYY-MM-DD', number>, lodge: Map<'YYYY-MM-DD', number> }
 *  - map   ：当天总花费
 *  - lodge ：当天来自住宿费的部分（用于绿色标记）
 */
export function dailyAmounts(files) {
  const map = new Map();
  const lodge = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  for (const f of files || []) {
    if (f.kind !== 'invoice') continue;
    const meta = f.meta || {};
    const amt = Number(meta.amount) || 0;
    if (!amt) continue;

    if (isLodging(f)) {
      const days = stayDays(meta.stayStart, meta.stayEnd);
      const per = amt / days;
      const start = parseDay(meta.stayStart);
      for (let i = 0; i < days; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const k = ymd(d);
        add(map, k, per);
        add(lodge, k, per);
      }
      continue;
    }

    const d = String(meta.date || '').slice(0, 10);
    if (parseDay(d)) add(map, d, amt);
  }
  return { map, lodge };
}

export { ymd };
