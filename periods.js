/* 周期列表 */

import { state, statsByPeriod, refresh } from '../store.js';
import { esc, icon, daysBetween, actionSheet, confirmSheet, toast, money } from '../ui.js';
import { openPeriodForm } from '../forms.js';
import { repo } from '../db.js';
import { rerender } from '../render.js';
import { buildZip } from '../exporter.js';
import { saveBlob } from '../platform.js';
import { track } from '../telemetry.js';

/* 报销状态视角：'unpaid'（默认）/ 'paid' / 'select'（多选改动报销状态） */
let pvTab = 'unpaid';
const picked = new Set();

export async function createPeriod() {
  const p = await openPeriodForm(null);
  if (!p) return;
  await repo.savePeriod(p);
  await refresh();
  track('period_create');
  toast('周期已创建', 'ok');
}

function isPaid(p) {
  return !!(p && p.reimbursed);
}

/** 批量改报销状态 */
async function applyPaid(ids, paid) {
  if (!ids.length) return;
  for (const id of ids) {
    const p = state.periods.find((x) => x.id === id);
    if (!p) continue;
    await repo.savePeriod({
      ...p,
      reimbursed: paid,
      reimbursedAt: paid ? Date.now() : null,
    });
  }
  picked.clear();
  await refresh();
  rerender();
  toast(paid ? `已标记 ${ids.length} 个周期为已报销` : `已标记 ${ids.length} 个周期为未报销`, 'ok');
}

export function renderPeriods(root) {
  const stats = statsByPeriod();
  const all = state.periods;
  const paidList = all.filter(isPaid);
  const unpaidList = all.filter((p) => !isPaid(p));

  if (!all.length) {
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

  const selecting = pvTab === 'select';
  const list = selecting ? all : (pvTab === 'paid' ? paidList : unpaidList);

  const seg = `
    <div class="home-seg" style="margin-bottom:10px">
      <button class="seg-btn ${pvTab === 'paid' ? 'on' : ''}" data-pv="paid">已报销 ${paidList.length}</button>
      <button class="seg-btn ${pvTab === 'unpaid' ? 'on' : ''}" data-pv="unpaid">未报销 ${unpaidList.length}</button>
      <button class="seg-btn ${selecting ? 'on' : ''}" data-pv="select">${selecting ? '完成' : '选择'}</button>
    </div>`;

  const cards = list.map((p) => {
    const st = stats.get(p.id) || { invoices: 0, attachments: 0, amount: 0, missing: 0 };
    const days = daysBetween(p.start, p.end);
    const paid = isPaid(p);
    const on = picked.has(p.id);
    return `
      <div class="period-card${selecting ? ' pv-pick' : ''}${on ? ' pv-on' : ''}" data-id="${p.id}">
        <div class="period-top">
          ${selecting ? `<div class="pv-check">${on ? '✓' : ''}</div>` : ''}
          <div class="grow">
            <div class="period-name">${esc(p.name)}</div>
            <div class="period-range">${icon('calendar')}<span>${esc(p.start)} ~ ${esc(p.end)}</span>
              <span class="badge gray">${days} 天</span>
              ${p.project ? `<span class="badge blue">${esc(p.project)}</span>` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="period-amount"><small>¥</small>${money(st.amount, false)}</div>
            <div style="margin-top:5px"><span class="badge ${paid ? 'green' : 'gray'}">${paid ? '已报销' : '未报销'}</span></div>
          </div>
        </div>
        <div class="period-stats">
          <span class="badge blue">${icon('doc')}票据 ${st.invoices}</span>
          <span class="badge">${icon('file')}附件 ${st.attachments}</span>
          ${st.missing ? `<span class="badge amber">${st.missing} 张待填金额</span>` : ''}
        </div>
      </div>`;
  }).join('');

  const emptyHint = !list.length
    ? `<div class="empty" style="padding:26px 0">${icon('calendar')}
         <p>${pvTab === 'paid' ? '还没有已报销的周期' : '没有未报销的周期'}</p>
         <p style="font-size:12px">${pvTab === 'paid' ? '在「未报销」里选中周期，标记为已报销' : '新建周期后会出现在这里'}</p>
       </div>`
    : '';

  const bar = selecting ? `
    <div class="pv-bar">
      <div class="pv-bar-info">已选 ${picked.size} 个</div>
      <button class="btn small ghost" data-pv-all="1">全选</button>
      <button class="btn small soft" data-pv-mark="0">标记未报销</button>
      <button class="btn small primary" data-pv-mark="1">标记已报销</button>
    </div>` : '';

  root.innerHTML = `${seg}<div style="margin-top:2px">${cards}</div>${emptyHint}${bar}`;

  root.querySelectorAll('[data-pv]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.pv;
    if (v === 'select') {
      pvTab = selecting ? 'unpaid' : 'select';
      picked.clear();
    } else {
      pvTab = v;
      picked.clear();
    }
    rerender();
  }));

  if (selecting) {
    root.querySelectorAll('.period-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        rerender();
      });
    });
    const allBtn = root.querySelector('[data-pv-all]');
    if (allBtn) allBtn.addEventListener('click', () => {
      if (picked.size === all.length) picked.clear();
      else all.forEach((p) => picked.add(p.id));
      rerender();
    });
    root.querySelectorAll('[data-pv-mark]').forEach((b) => b.addEventListener('click', async () => {
      if (!picked.size) { toast('先选中周期', 'err'); return; }
      await applyPaid([...picked], b.dataset.pvMark === '1');
    }));
    return;
  }

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
    { key: 'paid', label: isPaid(p) ? '标记为未报销' : '标记为已报销', icon: 'check' },
    { key: 'edit', label: '编辑周期', icon: 'edit' },
    { key: 'zip', label: '导出该周期 ZIP', icon: 'download' },
    { key: 'delete', label: '删除周期', icon: 'trash', danger: true },
  ]);
  if (act === 'paid') {
    await applyPaid([id], !isPaid(p));
    return;
  }
  if (act === 'edit') {
    const next = await openPeriodForm(p);
    if (next) { await repo.savePeriod(next); await refresh(); rerender(); }
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
    rerender();
    toast('周期已删除');
  }
}
