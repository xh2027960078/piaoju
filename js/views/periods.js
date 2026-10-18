/* 周期列表 */

import { state, statsByPeriod, refresh } from '../store.js';
import { esc, icon, daysBetween, actionSheet, confirmSheet, toast, money } from '../ui.js';
import { openPeriodForm } from '../forms.js';
import { repo } from '../db.js';
import { rerender } from '../render.js';
import { buildZip } from '../exporter.js';
import { saveBlob } from '../platform.js';

export async function createPeriod() {
  const p = await openPeriodForm(null);
  if (!p) return;
  await repo.savePeriod(p);
  await refresh();
  toast('周期已创建', 'ok');
}

export function renderPeriods(root) {
  const stats = statsByPeriod();
  const list = state.periods;

  if (!list.length) {
    root.innerHTML = `
      <div class="empty">
        ${icon('calendar')}
        <p style="font-size:16px;color:var(--text-2);font-weight:600">还没有出差周期</p>
        <p>先建立一个周期，比如「9月东莞出差」<br/>之后把车票、住宿发票、收据都放进对应周期</p>
        <button class="btn primary" data-a="new-period">${icon('plus')}新建周期</button>
      </div>`;
    root.querySelector('[data-a="new-period"]').addEventListener('click', createPeriod);
    return;
  }

  const cards = list.map((p) => {
    const st = stats.get(p.id) || { invoices: 0, attachments: 0, amount: 0, missing: 0 };
    const days = daysBetween(p.start, p.end);
    return `
      <div class="period-card" data-id="${p.id}">
        <div class="period-top">
          <div class="grow">
            <div class="period-name">${esc(p.name)}</div>
            <div class="period-range">${icon('calendar')}<span>${esc(p.start)} ~ ${esc(p.end)}</span>
              <span class="badge gray">${days} 天</span></div>
          </div>
          <div style="text-align:right">
            <div class="period-amount"><small>¥</small>${money(st.amount, false)}</div>
          </div>
        </div>
        <div class="period-stats">
          <span class="badge blue">${icon('doc')}票据 ${st.invoices}</span>
          <span class="badge">${icon('file')}附件 ${st.attachments}</span>
          ${st.missing ? `<span class="badge amber">${st.missing} 张待填金额</span>` : ''}
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `<div style="margin-top:6px">${cards}</div>`;

  root.querySelectorAll('.period-card').forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener('click', () => openPeriod(id));
    let pressTimer = null;
    card.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => { pressTimer = null; periodMenu(id); }, 550);
    }, { passive: true });
    card.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
    card.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); });
  });
}

export function openPeriod(id) {
  state.screen = 'detail';
  state.periodId = id;
  state.subTab = 'invoice';
  state.selectMode = false;
  state.selection.clear();
  history.pushState({ detail: id }, '');
  rerender();
}

export async function periodMenu(id) {
  const p = state.periods.find((x) => x.id === id);
  if (!p) return;
  const act = await actionSheet(p.name, [
    { key: 'edit', label: '编辑周期', icon: 'edit' },
    { key: 'zip', label: '导出该周期 ZIP', icon: 'download' },
    { key: 'delete', label: '删除周期', icon: 'trash', danger: true },
  ]);
  if (act === 'edit') {
    const next = await openPeriodForm(p);
    if (next) { await repo.savePeriod(next); await refresh(); }
  } else if (act === 'zip') {
    const { blob, root } = await buildZip({ periodIds: [id], zipName: p.name, includeInvoices: true, includeAttachments: true });
    const res = await saveBlob(blob, `${root}.zip`);
    if (res.ok) toast('ZIP 已导出', 'ok');
  } else if (act === 'delete') {
    const files = state.files.filter((f) => f.periodId === id).length;
    const ok = await confirmSheet({
      title: '删除周期',
      message: `将删除「${p.name}」及其中的 ${files} 个文件，删除后不可恢复。`,
      okText: '删除', danger: true,
    });
    if (!ok) return;
    await repo.deletePeriod(id);
    await refresh();
    toast('周期已删除');
  }
}
