/* 轻量 SVG 图表：环形图、柱状图、横向条形图 */

export const PALETTE = ['#2f6bff', '#ff9f1c', '#16a37b', '#8b5cf6', '#ef5da8', '#0ea5e9', '#f97316', '#64748b'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function shortMoney(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

/* 环形图 */
export function donut(data, { size = 200, thickness = 26, centerLabel = '合计' } = {}) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" role="img"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thickness}"/></svg>`;
  }
  let angle = -Math.PI / 2;
  const arcs = items.map((d, i) => {
    const frac = d.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = a2 - angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const path = frac >= 0.9999
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
      : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    angle = a2;
    return `<path d="${path}" fill="none" stroke="${d.color || PALETTE[i % PALETTE.length]}" stroke-width="${thickness}" stroke-linecap="butt"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" role="img">
    <g transform="rotate(0 ${cx} ${cy})">${arcs}</g>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" style="fill:var(--text-3);font-size:11px;font-weight:600">${esc(centerLabel)}</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" style="fill:var(--text);font-size:19px;font-weight:800">¥${shortMoney(total)}</text>
  </svg>`;
}

/* 月度柱状图 */
export function monthBars(series, { height = 170, showAvg = true } = {}) {
  const w = 320;
  const padL = 30;
  const padB = 22;
  const padT = 14;
  const innerW = w - padL - 6;
  const innerH = height - padB - padT;
  const max = Math.max(1, ...series.map((d) => d.value));
  const avg = series.reduce((s, d) => s + d.value, 0) / Math.max(1, series.filter((d) => d.value > 0).length);
  const bw = innerW / Math.max(1, series.length);
  const barW = Math.min(26, bw * 0.62);

  const grid = [0, 0.5, 1].map((f) => {
    const y = padT + innerH - innerH * f;
    return `<line x1="${padL}" y1="${y}" x2="${w - 4}" y2="${y}" stroke="var(--line)" stroke-width="1" stroke-dasharray="${f === 0 ? '0' : '3 4'}"/>`;
  }).join('');

  const bars = series.map((d, i) => {
    const h = d.value <= 0 ? 0 : Math.max(3, (d.value / max) * innerH);
    const x = padL + i * bw + (bw - barW) / 2;
    const y = padT + innerH - h;
    const active = d.highlight ? 1 : 0;
    return `<g>
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="${Math.min(6, barW / 2)}" fill="${active ? 'var(--accent)' : 'url(#barGrad)'}" opacity="${d.value > 0 ? 1 : 0.25}"/>
      <text x="${x + barW / 2}" y="${height - 7}" text-anchor="middle" style="fill:var(--text-3);font-size:9.5px">${esc(d.label)}</text>
    </g>`;
  }).join('');

  const avgLine = showAvg && avg > 0
    ? `<line x1="${padL}" y1="${padT + innerH - (avg / max) * innerH}" x2="${w - 4}" y2="${padT + innerH - (avg / max) * innerH}" stroke="var(--ok)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>`
    : '';

  return `<svg viewBox="0 0 ${w} ${height}" role="img">
    <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5b8cff"/><stop offset="100%" stop-color="#2f6bff"/>
    </linearGradient></defs>
    ${grid}
    <text x="0" y="${padT + 4}" style="fill:var(--text-3);font-size:9.5px">${shortMoney(max)}</text>
    <text x="0" y="${padT + innerH + 3}" style="fill:var(--text-3);font-size:9.5px">0</text>
    ${avgLine}
    ${bars}
  </svg>`;
}

/* 横向条形图 */
export function hbars(items, { maxItems = 6 } = {}) {
  const list = items.slice(0, maxItems);
  const max = Math.max(1, ...list.map((d) => d.value));
  return `<div class="hbars">${list.map((d, i) => `
    <div class="hbar">
      <div class="hbar-top">
        <span class="hbar-label">${esc(d.label)}</span>
        <span class="hbar-value">¥${(d.value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
      </div>
      <div class="hbar-track"><i style="width:${Math.max(2, (d.value / max) * 100)}%;background:${d.color || PALETTE[i % PALETTE.length]}"></i></div>
    </div>`).join('')}</div>`;
}

/* 百分比条（发票类型） */
export function typeBars(items) {
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  return `<div class="typebars">${items.map((d, i) => `
    <div class="typebar-row">
      <span class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span class="typebar-name">${esc(d.label)}</span>
      <span class="typebar-track"><i style="width:${(d.value / total) * 100}%;background:${PALETTE[i % PALETTE.length]}"></i></span>
      <span class="typebar-val">${Math.round((d.value / total) * 100)}%</span>
    </div>`).join('')}</div>`;
}

/* 日历热力图：按天汇总金额（表头和日期放在同一个 grid 里，保证对齐） */
export function calendarGrid(year, month, dayMap, todayStr = '') {
  const first = new Date(year, month - 1, 1);
  const startDow = (first.getDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(year, month, 0).getDate();
  const values = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    values.push({ d, key, value: dayMap.get(key) || 0 });
  }
  const max = Math.max(1, ...values.map((v) => v.value));
  const cells = [];
  const weekday = ['一', '二', '三', '四', '五', '六', '日'];
  for (const w of weekday) cells.push(`<span class="cal-w">${w}</span>`);
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-day empty"></div>');
  for (const v of values) {
    let lvl = 0;
    if (v.value > 0) lvl = Math.min(4, 1 + Math.floor((v.value / max) * 3.999));
    const today = v.key === todayStr ? ' today' : '';
    const val = v.value > 0 ? `<span class="v">${v.value >= 1000 ? (v.value / 1000).toFixed(1) + 'k' : Math.round(v.value)}</span>` : '';
    cells.push(`<div class="cal-day has${lvl ? ' l' + lvl : ''}${today}" title="${v.key}">
      <span class="d">${v.d}</span>${val}</div>`);
  }
  return `<div class="cal-grid">${cells.join('')}</div>`;
}