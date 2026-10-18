/* 文件查看：图片预览、PDF 逐页渲染、导出与转发 */

import { repo } from './db.js';
import { periodById } from './store.js';
import { sheet, toast, icon, esc, money, fmtBytes, confirmSheet } from './ui.js';
import { saveBlob, openBlob, shareBlob } from './platform.js';

const KIND_LABEL = { image: '图片', pdf: 'PDF', other: '文件' };

import { loadPdfLib } from './pdftext.js';


/**
 * @param {string} id file id
 * @param {object} opts { onEdit(file, close), onChanged() }
 */
export async function openFileViewer(id, opts = {}) {
  const f = await repo.file(id);
  if (!f) return;
  const buf = await repo.data(id);
  const m = f.meta || {};
  const isImage = f.fileKind === 'image';
  const isPdf = f.fileKind === 'pdf';
  let imgUrl = '';
  if (isImage && buf) imgUrl = URL.createObjectURL(new Blob([buf], { type: f.mime || 'image/jpeg' }));

  const info = f.kind === 'invoice' ? `
    <div class="kv"><span class="k">金额</span><span class="v" style="color:var(--accent)">${m.amount ? money(m.amount) : '未填写'}</span></div>
    <div class="kv"><span class="k">票据日期</span><span class="v">${esc(m.date || '-')}</span></div>
    <div class="kv"><span class="k">项目中心</span><span class="v">${esc(m.project || '-')}</span></div>
    <div class="kv"><span class="k">费用项目</span><span class="v">${esc(m.costItem || '-')}</span></div>
    <div class="kv"><span class="k">差旅费类型</span><span class="v">${esc(m.travelType || '-')}</span></div>
    <div class="kv"><span class="k">发票类型</span><span class="v">${esc(m.invoiceType || '-')}</span></div>
    <div class="kv"><span class="k">费用承担部门</span><span class="v">${esc(m.dept || '-')}</span></div>
    <div class="kv"><span class="k">备注</span><span class="v">${esc(m.remark || '-')}</span></div>` : `
    <div class="kv"><span class="k">类型</span><span class="v">${KIND_LABEL[f.fileKind] || '文件'}</span></div>
    <div class="kv"><span class="k">大小</span><span class="v">${fmtBytes(f.size)}</span></div>
    <div class="kv"><span class="k">项目中心</span><span class="v">${esc(m.project || '-')}</span></div>
    <div class="kv"><span class="k">费用项目</span><span class="v">${esc(m.costItem || '-')}</span></div>
    <div class="kv"><span class="k">备注</span><span class="v">${esc(m.remark || '-')}</span></div>`;

  const preview = isImage && imgUrl
    ? `<img src="${imgUrl}" style="width:100%;border-radius:14px;max-height:54vh;object-fit:contain;background:#00000010" alt="">`
    : isPdf
      ? `<div class="pdf-box" id="pdfBox" style="background:var(--card-soft);border-radius:14px;min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--text-3)">
           <div style="padding:24px;text-align:center">${icon('doc')}<p style="font-size:13px;margin-top:8px">正在渲染 PDF…</p></div>
         </div>
         <div class="row" id="pdfNav" style="display:none;justify-content:center;gap:12px;margin-top:10px">
           <button class="btn small ghost" data-pdf="prev">上一页</button>
           <span id="pdfPage" style="font-size:13px;color:var(--text-2);align-self:center">1 / 1</span>
           <button class="btn small ghost" data-pdf="next">下一页</button>
         </div>`
      : `<div class="empty" style="padding:26px 0">${icon('file')}<p>${esc(f.name)}</p><p style="font-size:12px">该格式暂不支持内置预览</p></div>`;

  sheet({
    title: f.name.length > 18 ? f.name.slice(0, 18) + '…' : f.name,
    tall: true,
    body: `${preview}<div class="card" style="margin-top:14px;padding:4px 14px">${info}</div>`,
    foot: `<button class="btn ghost" data-x="open">打开</button>
           <button class="btn soft" data-x="edit">编辑</button>
           <button class="btn ghost" data-x="share">转发</button>
           <button class="btn primary" data-x="save">导出</button>`,
    onMount(root, close) {
      if (isPdf && buf) renderPdf(root, buf).catch((e) => {
        const box = root.querySelector('#pdfBox');
        if (box) box.innerHTML = `<div class="empty" style="padding:26px 0">${icon('doc')}<p>PDF 预览失败</p><p style="font-size:12px">${esc(e.message || '')}</p></div>`;
      });

      root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
        const k = b.dataset.x;
        if (k === 'save') {
          if (!buf) return;
          const ok = await confirmSheet({ title: '导出文件', message: `确定导出「${f.name}」到下载目录吗？`, okText: '导出' });
          if (!ok) return;
          const res = await saveBlob(new Blob([buf], { type: f.mime || 'application/octet-stream' }), f.name);
          if (res.ok) toast('已保存到「下载/票据管家」', 'ok');
          else if (!res.wechat) toast('保存失败：' + (res.error || ''), 'err');
          if (res.ok && opts.onChanged) opts.onChanged();
        } else if (k === 'share') {
          if (!buf) return;
          const res = await shareBlob(new Blob([buf], { type: f.mime || 'application/octet-stream' }), f.name);
          if (!res.ok) toast(res.error || '分享失败', 'err');
        } else if (k === 'open') {
          if (buf) await openBlob(new Blob([buf], { type: f.mime || 'application/octet-stream' }), f.name);
        } else if (k === 'edit') {
          if (opts.onEdit) opts.onEdit(f, close);
        }
      }));
    },
    onClose() { if (imgUrl) URL.revokeObjectURL(imgUrl); },
  });
}

async function renderPdf(root, buf) {
  const lib = await loadPdfLib();
  const box = root.querySelector('#pdfBox');
  if (!box) return;
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  let pageNo = 1;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.borderRadius = '14px';
  canvas.style.display = 'block';
  box.innerHTML = '';
  box.appendChild(canvas);
  box.style.background = 'transparent';
  box.style.minHeight = '0';

  const nav = root.querySelector('#pdfNav');
  const pageLabel = root.querySelector('#pdfPage');
  if (doc.numPages > 1 && nav) nav.style.display = 'flex';
  if (pageLabel) pageLabel.textContent = `${pageNo} / ${doc.numPages}`;

  const draw = async (n) => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const width = Math.min(box.clientWidth || 320, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: (width / base.width) * dpr });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (pageLabel) pageLabel.textContent = `${n} / ${doc.numPages}`;
  };

  await draw(1);

  root.querySelectorAll('[data-pdf]').forEach((btn) => btn.addEventListener('click', async () => {
    const next = btn.dataset.pdf === 'next' ? pageNo + 1 : pageNo - 1;
    if (next < 1 || next > doc.numPages) return;
    pageNo = next;
    await draw(pageNo);
  }));
}
