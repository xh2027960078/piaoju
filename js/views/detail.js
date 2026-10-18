/* 周期详情：票据 / 附件管理、多选导出、查看 */

import { state, filesOf, amountOf, periodById, refresh } from '../store.js';
import {
  toast, icon, esc, money, fmtBytes, daysBetween, actionSheet, confirmSheet,
} from '../ui.js';
import { repo } from '../db.js';
import { rerender } from '../render.js';
import { importFiles, openInvoiceForm, openAttachmentForm, openBatchMeta, detectImported, openDetectProgress } from '../forms.js';
import { takePhoto, pickFiles, saveBlob, shareBlob } from '../platform.js';
import { singleFileName, safeName } from '../exporter.js';
import { openFileViewer } from '../viewer.js';
import { track } from '../telemetry.js';

const KIND_LABEL = { image: '图片', pdf: 'PDF', other: '文件' };
const KIND_ICON = { image: 'image', pdf: 'doc', other: 'file' };

export function renderDetail(root) {
  const p = periodById(state.periodId);
  if (!p) { state.screen = 'tabs'; rerender(); return; }

  const kind = state.subTab;
  const all = filesOf(p.id);
  const invoices = all.filter((f) => f.kind === 'invoice');
  const attachments = all.filter((f) => f.kind === 'attachment');
  const amount = amountOf(p.id);
  const list = kind === 'invoice' ? invoices : attachments;
  const selected = state.selection;

  const summary = `
    <div class="detail-summary">
      <div class="ds-main">
        <div class="ds-label">票据合计金额</div>
        <div class="ds-amount">¥${money(amount, false)}</div>
      </div>
      <div class="ds-side">
        <div>${daysBetween(p.start, p.end)} 天行程</div>
        <div>${invoices.length} 张票据 · ${attachments.length} 个附件</div>
      </div>
    </div>
    <div class="segmented">
      <button data-sub="invoice" class="${kind === 'invoice' ? 'is-active' : ''}">票据 ${invoices.length}</button>
      <button data-sub="attachment" class="${kind === 'attachment' ? 'is-active' : ''}">附件 ${attachments.length}</button>
    </div>`;

  let body;
  if (!list.length) {
    body = `<div class="empty">${icon(kind === 'invoice' ? 'doc' : 'file')}
      <p style="font-weight:600;color:var(--text-2)">还没有${kind === 'invoice' ? '票据' : '附件'}</p>
      <p>${kind === 'invoice' ? '可以上传 PDF 发票、拍照或从相册选择收据' : '合同、行程单、审批截图等都可以放在这里'}</p>
      <button class="btn primary" data-a="add">${icon('plus')}添加${kind === 'invoice' ? '票据' : '附件'}</button></div>`;
  } else {
    body = `<div class="card tight" style="padding:6px 12px">${list.map((f, i) => fileRow(f, selected.has(f.id), f.seq || i + 1)).join('')}</div>
      <button class="btn ghost block mt12" data-a="add">${icon('plus')}继续添加${kind === 'invoice' ? '票据' : '附件'}</button>`;
  }

  root.innerHTML = `
    ${summary}
    ${state.selectMode ? `<div class="row" style="margin:2px 2px 8px">
        <span class="badge blue">已选 ${selected.size} 项</span>
        <span class="grow"></span>
        <button class="btn small ghost" data-a="select-all">全选</button>
        <button class="btn small ghost" data-a="select-none">取消选择</button>
      </div>` : ''}
    ${body}
    ${state.selectMode ? '' : `<button class="fab detail" data-a="add" aria-label="添加文件">${icon('plus')}</button>`}
    <div class="selectbar ${state.selectMode ? 'show' : ''}">
      <button class="btn soft" data-a="sel-export">${icon('download')}导出</button>
      <button class="btn ghost" data-a="sel-share">转发</button>
      <button class="btn ghost" data-a="sel-move">移动</button>
      <button class="btn danger" data-a="sel-delete">${icon('trash')}</button>
    </div>`;

  root.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
    state.subTab = b.dataset.sub;
    state.selection.clear();
    rerender();
  }));

  root.querySelectorAll('.file-row').forEach((row) => {
    const id = row.dataset.id;
    let timer = null;
    row.addEventListener('click', () => {
      if (state.selectMode) { toggleSelect(id); return; }
      openViewer(id);
    });
    row.addEventListener('touchstart', () => {
      timer = setTimeout(() => { timer = null; vibrate(); enterSelect(id); }, 480);
    }, { passive: true });
    row.addEventListener('touchend', () => { if (timer) clearTimeout(timer); });
    row.addEventListener('touchmove', () => { if (timer) clearTimeout(timer); });
  });

  root.querySelectorAll('[data-a="add"]').forEach((b) => b.addEventListener('click', () => addFiles(p.id, kind)));

  const wire = (sel, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener('click', fn); };
  wire('[data-a="select-all"]', () => { list.forEach((f) => state.selection.add(f.id)); rerender(); });
  wire('[data-a="select-none"]', () => { state.selectMode = false; state.selection.clear(); rerender(); });
  wire('[data-a="sel-export"]', () => exportSelected(list, false));
  wire('[data-a="sel-share"]', () => exportSelected(list, true));
  wire('[data-a="sel-move"]', () => moveSelected(p.id));
  wire('[data-a="sel-delete"]', () => deleteSelected());
}

function vibrate() {
  if (navigator.vibrate) { try { navigator.vibrate(16); } catch (e) { /* ignore */ } }
}

function fileRow(f, selected, seqNo) {
  const m = f.meta || {};
  const missing = !Number(m.amount);
  const sub = [];
  if (f.kind === 'invoice') {
    sub.push(`<b>${m.amount ? money(m.amount) : '待填金额'}</b>`);
    if (m.project) sub.push(esc(m.project));
    if (m.costItem) sub.push(esc(m.costItem));
  } else {
    sub.push(`${KIND_LABEL[f.fileKind] || '文件'} · ${fmtBytes(f.size)}`);
    if (m.project) sub.push(esc(m.project));
  }
  if (missing) sub.push('<span class="warn">待填写</span>');
  const seq = seqNo || f.seq || 0;
  return `
    <div class="file-row" data-id="${f.id}">
      ${state.selectMode ? `<div class="check ${selected ? 'on' : ''}">${icon('check')}</div>` : ''}
      <div class="thumb">${f.thumb ? `<img src="${f.thumb}" alt="" loading="lazy">` : icon(KIND_ICON[f.fileKind] || 'file')}</div>
      <div class="file-main">
        <div class="file-name"><span class="seq-tag">#${seq}</span>${esc(f.name)}</div>
        <div class="file-meta">${sub.join('<span>·</span>')}</div>
      </div>
      ${state.selectMode ? '' : `<div class="file-side">${icon('right')}</div>`}
    </div>`;
}

function enterSelect(id) {
  state.selectMode = true;
  state.selection.clear();
  if (id) state.selection.add(id);
  rerender();
}

function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  rerender();
}

function openViewer(id) {
  openFileViewer(id, {
    onEdit: (f, close) => {
      close();
      const fn = f.kind === 'invoice' ? openInvoiceForm : openAttachmentForm;
      fn(f, { onSaved: async () => { await refresh(); rerender(); } });
    },
    onChanged: async () => { await refresh(); },
  });
}

/* ---------------- 添加文件 ---------------- */
let importStartedAt = 0;
const IMPORT_LOCK_MS = 90000;

export async function addFiles(periodId, kind) {
  // 带超时的锁：即使某次选择流程卡住，也不会永久失效（最多 90 秒后自动恢复）
  if (Date.now() - importStartedAt < IMPORT_LOCK_MS) {
    toast('上一次添加还没结束，请稍候…');
    return;
  }
  importStartedAt = Date.now();
  try {
    await addFilesInner(periodId, kind);
  } finally {
    importStartedAt = 0;
  }
}

async function addFilesInner(periodId, kind) {
  const label = kind === 'invoice' ? '票据' : '附件';
  const act = await actionSheet(`添加${label}`, [
    { key: 'camera', label: '拍照', icon: 'camera' },
    { key: 'gallery', label: '从相册选择', icon: 'image' },
    { key: 'file', label: '选择文件（PDF / 图片）', icon: 'file' },
  ]);
  if (!act) return;
  let files = [];
  if (act === 'camera') {
    const f = await takePhoto();
    if (f) files = [f];
  } else if (act === 'gallery') {
    files = await pickFiles('image/*', true);
  } else if (act === 'file') {
    files = await pickFiles('*/*', true);
  }
  if (!files.length) return;

  toast(`正在导入 ${files.length} 个文件…`);
  let added = await importFiles(periodId, kind, files);
  await refresh();
  if (!added.length) return;
  track('file_import', { kind, count: added.length });
  rerender();

  // PDF 票据：后台识别金额（限时，失败不影响导入）
  if (kind === 'invoice') {
    const pdfs = added.filter((f) => f.fileKind === 'pdf');
    if (pdfs.length) {
      const prog = openDetectProgress(pdfs.length);
      try {
        const res = await detectImported(added, { onProgress: (d) => prog.update(d) });
        prog.close();
        if (res.detected) toast(`已识别 ${res.detected} 张票据的金额`, 'ok');
      } catch (e) {
        prog.close();
      }
      await refresh();
      added = await Promise.all(added.map((a) => repo.file(a.id)));
      rerender();
    }
  }

  await openBatchMeta(added, kind, { onDone: async () => { await refresh(); rerender(); } });
}

/* ---------------- 多选操作 ---------------- */
async function exportSelected(list, share) {
  const ids = [...state.selection];
  if (!ids.length) { toast('请先选择文件', 'err'); return; }
  const files = list.filter((f) => ids.includes(f.id));
  const p = periodById(state.periodId);

  if (!share) {
    const ok = await confirmSheet({
      title: '导出文件',
      message: files.length > 1
        ? `确定导出选中的 ${files.length} 个文件吗？会打包成一个 ZIP，保存到「下载/票据管家」。`
        : '确定导出选中的文件吗？会保存到「下载/票据管家」。',
      okText: '导出',
    });
    if (!ok) return;
  }

  if (files.length === 1) {
    const f = files[0];
    const buf = await repo.data(f.id);
    if (!buf) return;
    const blob = new Blob([buf], { type: f.mime || 'application/octet-stream' });
    const res = share ? await shareBlob(blob, singleFileName(f)) : await saveBlob(blob, singleFileName(f));
    if (res.ok && !share) toast('已保存到「下载/票据管家」', 'ok');
    else if (!res.ok) toast(res.error || '操作失败', 'err');
    finishSelection();
    return;
  }

  toast('正在打包…');
  const zip = new JSZip();
  const rootName = safeName(p ? p.name : '导出');
  const used = new Set();
  for (const f of files) {
    const buf = await repo.data(f.id);
    if (!buf) continue;
    const folder = f.kind === 'invoice' ? '票据' : '附件';
    let name = safeName(f.name, '文件');
    let n = 2;
    while (used.has(folder + name)) { name = name.replace(/(\.[^.]+)?$/, (e) => `(${n})${e || ''}`); n++; }
    used.add(folder + name);
    zip.file(`${rootName}/${folder}/${name}`, buf, { binary: true });
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  const filename = `${rootName}_${files.length}个文件.zip`;
  const res = share ? await shareBlob(blob, filename) : await saveBlob(blob, filename);
  if (res.ok && !share) toast('已导出 ZIP', 'ok');
  else if (!res.ok && !res.wechat) toast(res.error || '操作失败', 'err');
  finishSelection();
}

function finishSelection() {
  state.selectMode = false;
  state.selection.clear();
  rerender();
}

async function moveSelected(currentId) {
  const ids = [...state.selection];
  if (!ids.length) { toast('请先选择文件', 'err'); return; }
  const others = state.periods.filter((p) => p.id !== currentId);
  if (!others.length) { toast('没有其他周期可移动', 'err'); return; }
  const items = others.map((p) => ({ key: p.id, label: p.name, icon: 'calendar', hint: p.start }));
  const target = await actionSheet(`移动到（${ids.length} 个文件）`, items);
  if (!target) return;
  await repo.moveFiles(ids, target);
  await refresh();
  finishSelection();
  toast('已移动', 'ok');
}

async function deleteSelected() {
  const ids = [...state.selection];
  if (!ids.length) { toast('请先选择文件', 'err'); return; }
  const ok = await confirmSheet({
    title: '删除文件', message: `确定删除选中的 ${ids.length} 个文件？删除后不可恢复。`,
    okText: '删除', danger: true,
  });
  if (!ok) return;
  await repo.deleteFiles(ids);
  await refresh();
  finishSelection();
  toast('已删除');
}
