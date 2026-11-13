/* 导出中心：ZIP 打包（按项目中心/周期）+ 报销单生成 + 转发 */

import { state, statsByPeriod } from '../store.js';
import { esc, icon, money, toast, sheet, confirmSheet } from '../ui.js';
import { buildZip, buildReimbursement, rowsForTemplate, zipFileName, safeName } from '../exporter.js';
import { saveBlob, shareBlob } from '../platform.js';
import { rerender } from '../render.js';
import { track } from '../telemetry.js';

let sel = null;
let zipName = '';
let includeInvoices = true;
let includeAttachments = true;
let groupBy = 'project';

function ensureSel() {
  if (!sel) {
    sel = new Set(state.periods.map((p) => p.id));
    zipName = zipFileName();
  }
}

export function renderExport(root) {
  ensureSel();
  for (const id of [...sel]) if (!state.periods.some((p) => p.id === id)) sel.delete(id);

  const stats = statsByPeriod();
  const selected = state.periods.filter((p) => sel.has(p.id));
  const invoiceCount = selected.reduce((s, p) => s + (stats.get(p.id) || {}).invoices, 0);
  const attachCount = selected.reduce((s, p) => s + (stats.get(p.id) || {}).attachments, 0);
  const amount = selected.reduce((s, p) => s + (stats.get(p.id) || {}).amount, 0);
  const tpl = state.template;
  const tplOk = tpl && state.templateInfo && state.templateInfo.ok;
  const preview = rowsForTemplate([...sel]);

  const periodRows = state.periods.map((p) => {
    const st = stats.get(p.id) || { invoices: 0, attachments: 0, amount: 0 };
    return `
      <div class="pick-row" data-pid="${p.id}">
        <div class="check ${sel.has(p.id) ? 'on' : ''}">${icon('check')}</div>
        <div class="grow">
          <div class="file-name" style="font-size:14.5px">${esc(p.name)}</div>
          <div class="file-meta">${esc(p.start)} ~ ${esc(p.end)} · 票据 ${st.invoices} · 附件 ${st.attachments}</div>
        </div>
        <div style="font-weight:700;font-size:14px;font-variant-numeric:tabular-nums">¥${money(st.amount, false)}</div>
      </div>`;
  }).join('');

  const ruleText = groupBy === 'project'
    ? `<b>${esc(zipName || '导入时间')}</b> / 发票夹 / 项目中心 / 票据文件；<b>${esc(zipName || '导入时间')}</b> / 附件 / 全部附件`
    : `<b>${esc(zipName || '导入时间')}</b> / 周期名称 / 票据 · 附件`;

  root.innerHTML = `
    <div class="section-title"><span>选择周期</span>
      <span>
        <button class="text-btn" style="height:30px;padding:0 10px;font-size:12.5px" data-a="all">全选</button>
        <button class="text-btn" style="height:30px;padding:0 10px;font-size:12.5px" data-a="none">清空</button>
      </span>
    </div>
    <div class="card tight" style="padding:4px 12px">
      ${state.periods.length ? periodRows : '<p class="hint" style="padding:18px;text-align:center">还没有周期</p>'}
    </div>

    <div class="section-title"><span>打包 ZIP</span><span class="card-sub">${selected.length} 个周期 · ${invoiceCount} 票据 · ${attachCount} 附件</span></div>
    <div class="card">
      <div class="field">
        <label class="field-label">压缩包名称</label>
        <input class="input" id="zipName" value="${esc(zipName)}" maxlength="40" placeholder="默认按导入时间命名" />
      </div>
      <div class="segmented" style="margin:4px 0 12px">
        <button data-group="project" class="${groupBy === 'project' ? 'is-active' : ''}">按项目中心</button>
        <button data-group="period" class="${groupBy === 'period' ? 'is-active' : ''}">按周期</button>
      </div>
      <div class="row" style="justify-content:space-between;padding:6px 2px">
        <span style="font-size:14px">包含票据</span>
        <div class="switch ${includeInvoices ? 'on' : ''}" data-toggle="invoice"></div>
      </div>
      <div class="row" style="justify-content:space-between;padding:6px 2px">
        <span style="font-size:14px">包含附件</span>
        <div class="switch ${includeAttachments ? 'on' : ''}" data-toggle="attachment"></div>
      </div>
      <p class="hint">目录：${ruleText}</p>
      <div class="btn-row">
        <button class="btn primary" data-a="zip" ${selected.length ? '' : 'disabled'}>${icon('download')}导出 ZIP</button>
        <button class="btn soft" data-a="zip-share" ${selected.length ? '' : 'disabled'}>${icon('upload')}导出并转发</button>
      </div>
    </div>

    <div class="section-title"><span>员工报销单</span><span class="card-sub">填入模板 AB5:AS5 数据行</span></div>
    <div class="card">
      ${tplOk
        ? `<div class="row" style="gap:10px;margin-bottom:10px">
             <div class="thumb" style="width:38px;height:38px;background:var(--ok-soft);color:var(--ok)">${icon('doc')}</div>
             <div class="grow"><div style="font-weight:600;font-size:14px">${esc(tpl.name)}</div>
             <div class="file-meta">工作表：${esc(state.templateInfo.sheetName)} · 起始行 ${state.templateInfo.dataStartRow}</div></div>
           </div>`
        : `<p class="hint" style="color:var(--danger)">尚未导入可用的报销单模板，请到「设置 → 报销单模板」导入。</p>`}
      <div class="kv"><span class="k">可生成数据行</span><span class="v">${preview.rows.length} 行${preview.skipped.length ? `（${preview.skipped.length} 张未填金额）` : ''}</span></div>
      <div class="kv"><span class="k">票据合计</span><span class="v" style="color:var(--accent)">¥${money(amount, false)}</span></div>
      <div class="kv"><span class="k">报销人 / 部门</span><span class="v">${esc(state.settings.traveler || '未设置')}${state.settings.dept ? ' · ' + esc(state.settings.dept) : ''}</span></div>
      <div class="btn-row">
        <button class="btn ${tplOk ? 'primary' : 'ghost'}" data-a="xlsx" ${tplOk && selected.length ? '' : 'disabled'}>${icon('sparkle')}生成报销单</button>
        <button class="btn soft" data-a="xlsx-share" ${tplOk && selected.length ? '' : 'disabled'}>${icon('upload')}生成并转发</button>
      </div>
    </div>

    <p class="hint" style="text-align:center;margin:18px 10px 4px">文件保存在「下载/票据管家」；「转发」可直接发到微信</p>`;

  root.querySelectorAll('[data-pid]').forEach((row) => row.addEventListener('click', () => {
    const id = row.dataset.pid;
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    rerender();
  }));
  root.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
    groupBy = b.dataset.group;
    rerender();
  }));
  root.querySelectorAll('[data-toggle]').forEach((sw) => sw.addEventListener('click', () => {
    if (sw.dataset.toggle === 'invoice') includeInvoices = !includeInvoices;
    else includeAttachments = !includeAttachments;
    rerender();
  }));
  const nameEl = root.querySelector('#zipName');
  if (nameEl) nameEl.addEventListener('input', () => { zipName = nameEl.value; });
  const wire = (a, fn) => { const el = root.querySelector(`[data-a="${a}"]`); if (el) el.addEventListener('click', fn); };
  wire('all', () => { sel = new Set(state.periods.map((p) => p.id)); rerender(); });
  wire('none', () => { sel = new Set(); rerender(); });
  wire('zip', () => doZip(false));
  wire('zip-share', () => doZip(true));
  wire('xlsx', () => doXlsx(false));
  wire('xlsx-share', () => doXlsx(true));
}

async function doZip(share) {
  const ids = [...sel];
  if (!ids.length) return;
  const name = safeName(zipName || zipFileName());
  if (!share) {
    const inv = state.files.filter((f) => ids.includes(f.periodId) && f.kind === 'invoice' && includeInvoices).length;
    const att = state.files.filter((f) => ids.includes(f.periodId) && f.kind === 'attachment' && includeAttachments).length;
    const ok = await confirmSheet({
      title: '导出 ZIP',
      message: `确定导出吗？将打包 ${inv} 张票据、${att} 个附件，保存到「下载/票据管家」。`,
      okText: '导出',
    });
    if (!ok) return;
  }
  toast('正在打包，请稍候…');
  try {
    const { blob, count, root } = await buildZip({
      periodIds: ids, zipName: name, includeInvoices, includeAttachments, groupBy,
      onProgress: (done, total) => { if (done < total) toast(`正在打包 ${done}/${total}`); },
    });
    if (!count) { toast('所选周期没有可导出的文件', 'err'); return; }
    track('export_zip', { count });
    const filename = `${root}.zip`;
    const res = share ? await shareBlob(blob, filename) : await saveBlob(blob, filename);
    handleResult(res, share, `已打包 ${count} 个文件`, filename, blob);
  } catch (e) {
    toast('打包失败：' + e.message, 'err');
  }
}

async function doXlsx(share) {
  const ids = [...sel];
  if (!ids.length) return;
  const { rows, skipped } = rowsForTemplate(ids);
  if (!rows.length) { toast('所选周期中没有填写金额的票据', 'err'); return; }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const ok = await confirmSheet({
    title: '生成员工报销单',
    message: `将写入 ${rows.length} 条费用明细，合计 ¥${money(total, false)}。${skipped.length ? `另有 ${skipped.length} 张未填金额已跳过。` : ''}报销人：${state.settings.traveler || '未设置'}。`,
    okText: share ? '生成并转发' : '生成并保存',
  });
  if (!ok) return;

  toast('正在生成报销单…');
  try {
    track('export_xlsx', { rows: rows.length });
    const { blob } = await buildReimbursement(ids);
    const filename = `${zipFileName()}_员工报销单.xlsx`;
    const res = share ? await shareBlob(blob, filename) : await saveBlob(blob, filename);
    handleResult(res, share, `已生成 ${rows.length} 行费用明细`, filename, blob);
  } catch (e) {
    toast('生成失败：' + e.message, 'err');
  }
}

function handleResult(res, shared, okText, filename, blob) {
  if (!res.ok) {
    if (!res.canceled) toast(res.error || '操作失败', 'err');
    return;
  }
  if (shared) { toast('已打开转发面板', 'ok'); return; }
  toast(okText, 'ok');
  sheet({
    title: '导出完成',
    body: `<p class="hint" style="margin:2px 2px 14px">文件已保存到「下载/票据管家」。要发到微信或群里，点下面的「转发」。</p>
      <div class="kv"><span class="k">文件名</span><span class="v" style="word-break:break-all">${esc(filename)}</span></div>`,
    foot: `<button class="btn ghost" data-x="0">完成</button><button class="btn primary" data-x="1">转发</button>`,
    onMount(root, close) {
      root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.x === '1') await shareBlob(blob, filename);
        close();
      }));
    },
  });
}

export function invalidateSelection() {
  sel = null;
  zipName = '';
}
