/* 图表统计 */

import { chartData, totals, state, dateOfFile } from '../store.js';
import { esc, icon, money, todayISO } from '../ui.js';
import { donut, monthBars, hbars, typeBars, calendarGrid, PALETTE } from '../charts.js';
import { DEFAULT_CHARTS } from '../appearance.js';

let cal = null;

function chartFlags() {
  return { ...DEFAULT_CHARTS, ...(state.settings.charts || {}) };
}

function byDayMap() {
  const map = new Map();
  for (const f of state.files) {
    if (f.kind !== 'invoice') continue;
    const amt = Number(f.meta && f.meta.amount) || 0;
    if (!amt) continue;
    const d = dateOfFile(f);
    if (!d) continue;
    map.set(d, (map.get(d) || 0) + amt);
  }
  return map;
}

function calendarSection() {
  const year = cal.getFullYear();
  const month = cal.getMonth() + 1;
  const map = byDayMap();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  let sum = 0, days = 0;
  for (const [k, v] of map) {
    if (k.startsWith(prefix)) { sum += v; days++; }
  }
  return `
    <div class="cal-head">
      <button class="cal-nav" data-cal="prev" aria-label="上个月">${icon('left')}</button>
      <div class="cal-title">${year} 年 ${month} 月</div>
      <button class="cal-nav" data-cal="next" aria-label="下个月">${icon('right')}</button>
    </div>
    ${calendarGrid(year, month, map, todayISO())}
    <div class="cal-foot"><span>本月合计 <b style="color:var(--accent)">¥${money(sum, false)}</b></span><span>${days} 天有支出</span></div>`;
}

export function renderCharts(root) {
  if (!cal) {
    const dates = state.files.filter((f) => f.kind === 'invoice' && f.meta && f.meta.date).map((f) => String(f.meta.date).slice(0, 10)).sort();
    const latest = dates[dates.length - 1];
    cal = latest ? new Date(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)) - 1, 1) : new Date();
  }
  const flags = chartFlags();
  const show = (k) => flags[k] !== false;

  const t = totals();
  const d = chartData();
  const hasData = t.invoices > 0 && t.amount > 0;

  const stats = `
    <div class="stat-grid">
      <div class="stat accent"><div class="k">累计报销金额</div><div class="v">¥${money(t.amount, false)}</div></div>
      <div class="stat blue"><div class="k">票据总数</div><div class="v">${t.invoices}<small>张</small></div></div>
      <div class="stat"><div class="k">出差周期</div><div class="v">${t.periods}<small>个</small></div></div>
      <div class="stat ${t.missing ? 'accent' : 'green'}"><div class="k">${t.missing ? '待填金额' : '附件数量'}</div>
        <div class="v">${t.missing || t.attachments}<small>${t.missing ? '张' : '个'}</small></div></div>
    </div>`;

  const calCard = show('calendar') ? `
    <div class="card" style="margin-top:12px">
      <div class="card-head"><span class="card-title">每日花费</span><span class="card-sub">按日历查看</span></div>
      <div id="calBody">${calendarSection()}</div>
    </div>` : '';

  if (!hasData) {
    root.innerHTML = `${stats}${calCard}
      <div class="empty" style="padding-top:24px">${icon('chart')}
        <p style="font-weight:600;color:var(--text-2)">还没有可统计的数据</p>
        <p>给票据填上金额后，这里会自动生成日历、月度趋势和分类占比</p>
      </div>`;
    wireCalendar(root);
    return;
  }

  const totalItem = d.byItem.reduce((s, x) => s + x.value, 0) || 1;
  const legend = d.byItem.slice(0, 6).map((x, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
      <span>${esc(x.label)}</span>
      <span class="legend-val">${Math.round((x.value / totalItem) * 100)}%</span>
    </div>`).join('');

  const monthlyCard = show('monthly') ? `
    <div class="card">
      <div class="card-head"><span class="card-title">近 6 个月花费</span><span class="card-sub">按月汇总</span></div>
      <div class="chart-wrap">${monthBars(d.byMonth)}</div>
    </div>` : '';

  const itemsCard = show('items') ? `
    <div class="card">
      <div class="card-head"><span class="card-title">费用项目占比</span><span class="card-sub">按金额</span></div>
      <div class="chart-wrap" style="max-width:230px;margin:0 auto">${donut(d.byItem.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] })))}</div>
      <div class="legend">${legend}</div>
    </div>` : '';

  const typesCard = show('types') ? `
    <div class="card">
      <div class="card-head"><span class="card-title">发票类型</span><span class="card-sub">按金额占比</span></div>
      ${typeBars(d.byType)}
    </div>` : '';

  const periodsCard = show('periods') ? `
    <div class="card">
      <div class="card-head"><span class="card-title">周期支出排行</span><span class="card-sub">Top 6</span></div>
      ${hbars(d.byPeriod)}
    </div>` : '';

  const anyChart = show('calendar') || show('monthly') || show('items') || show('types') || show('periods');

  root.innerHTML = `
    ${stats}
    ${calCard}
    ${monthlyCard}
    ${itemsCard}
    ${typesCard}
    ${periodsCard}
    ${anyChart ? '' : '<div class="empty" style="padding-top:20px">' + icon('chart') + '<p>已在设置里隐藏所有图表</p><p style="font-size:12.5px">可在「设置 → 个性化 → 图表显示」重新打开</p></div>'}`;

  wireCalendar(root);
}

function wireCalendar(root) {
  const body = root.querySelector('#calBody');
  if (!body) return;
  root.querySelectorAll('[data-cal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.cal === 'prev' ? -1 : 1;
      cal = new Date(cal.getFullYear(), cal.getMonth() + delta, 1);
      body.innerHTML = calendarSection();
      wireCalendar(root);
    });
  });
}
