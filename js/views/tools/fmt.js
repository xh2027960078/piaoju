/* 工具：格式转换
 * 图片：JPG/PNG/WEBP 互转（保持原分辨率）
 * PDF：转图片 / 转文本 / 转 Word（纯文本版）
 * 图片 → PDF
 */
import { toast } from '../../ui.js';
import { saveBlob } from '../../platform.js';
import { loadPdfLib } from '../../pdftext.js';
import { buildPdfFromJpegs } from '../../lib/pdflite.js';

const IMG_TARGETS = [
  { mime: 'image/jpeg', ext: 'jpg', name: 'JPG' },
  { mime: 'image/png', ext: 'png', name: 'PNG' },
  { mime: 'image/webp', ext: 'webp', name: 'WEBP' },
];

let st = { tab: 'img', target: 'image/jpeg', quality: 0.92, pdfOut: 'img', items: [] };

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
    img.src = url;
  });
}

function baseName(name) {
  return String(name || 'file').replace(/\.[^.]+$/, '');
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('导出失败'))), mime, quality));
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildDocx(pages) {
  if (!window.JSZip) throw new Error('缺少打包组件');
  const zip = new window.JSZip();
  const paras = [];
  pages.forEach((text, pi) => {
    if (pi > 0) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    for (const line of String(text).split('\n')) {
      paras.push(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`);
    }
  });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function convertImages(files) {
  const target = IMG_TARGETS.find((t) => t.mime === st.target);
  const out = [];
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (target.mime === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0);
      const blob = await canvasToBlob(canvas, target.mime, st.quality);
      out.push({
        name: baseName(f.name) + '.' + target.ext,
        blob,
        info: `${canvas.width}×${canvas.height} · ${fmtSize(f.size)} → ${fmtSize(blob.size)}`,
      });
    } catch (e) {
      toast(f.name + ' 转换失败：' + e.message, 'err');
    }
  }
  return out;
}

async function imagesToPdf(files) {
  const pages = [];
  for (const f of files) {
    const img = await loadImage(f);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const bin = atob(dataUrl.split(',')[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    pages.push({ data: bytes, width: canvas.width, height: canvas.height });
  }
  return buildPdfFromJpegs(pages);
}

async function pdfToImages(file) {
  const lib = await loadPdfLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const out = [];
  const maxPages = Math.min(doc.numPages, 30);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await canvasToBlob(canvas, 'image/png', 0.95);
    out.push({ name: `${baseName(file.name)}-第${p}页.png`, blob, info: `${canvas.width}×${canvas.height} · ${fmtSize(blob.size)}` });
  }
  return out;
}

async function pdfToText(file) {
  const lib = await loadPdfLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let lastY = null;
    let text = '';
    for (const it of content.items) {
      if (!it || typeof it.str !== 'string') continue;
      const y = it.transform ? Math.round(it.transform[5]) : 0;
      if (lastY !== null && Math.abs(y - lastY) > 3) text += '\n';
      text += it.str;
      lastY = y;
    }
    pages.push(text.replace(/\n{3,}/g, '\n\n'));
  }
  return pages;
}

export function renderFmt(root, back) {
  const tab = st.tab;
  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-bar">
        <button class="btn small ghost" data-back>← 工具</button>
        <b>格式转换</b>
      </div>

      <div class="home-seg">
        <button class="seg-btn ${tab === 'img' ? 'on' : ''}" data-tab2="img">图片</button>
        <button class="seg-btn ${tab === 'pdf' ? 'on' : ''}" data-tab2="pdf">PDF 转换</button>
        <button class="seg-btn ${tab === 'to-pdf' ? 'on' : ''}" data-tab2="to-pdf">图片转 PDF</button>
      </div>

      ${tab === 'img' ? `
      <div class="tool-card">
        <div class="tool-row">
          <span class="tool-label">目标格式</span>
          <div class="tool-seg">
            ${IMG_TARGETS.map((t) => `<button class="seg-btn ${st.target === t.mime ? 'on' : ''}" data-mime="${t.mime}">${t.name}</button>`).join('')}
          </div>
        </div>
        <div class="tool-row ${st.target === 'image/png' ? 'is-off' : ''}">
          <span class="tool-label">质量 <b data-q>${Math.round(st.quality * 100)}%</b></span>
          <input type="range" min="50" max="100" step="5" value="${Math.round(st.quality * 100)}" data-quality />
        </div>
        <button class="btn primary block" data-pick>选择图片（可多选）</button>
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">保持原始分辨率，不做缩放。</p>
      </div>` : ''}

      ${tab === 'pdf' ? `
      <div class="tool-card">
        <div class="tool-row">
          <span class="tool-label">输出为</span>
          <div class="tool-seg">
            <button class="seg-btn ${st.pdfOut === 'img' ? 'on' : ''}" data-pdfout="img">图片</button>
            <button class="seg-btn ${st.pdfOut === 'txt' ? 'on' : ''}" data-pdfout="txt">文本</button>
            <button class="seg-btn ${st.pdfOut === 'docx' ? 'on' : ''}" data-pdfout="docx">Word</button>
          </div>
        </div>
        <button class="btn primary block" data-pick-pdf>选择 PDF</button>
        <input type="file" accept="application/pdf" hidden data-pdf />
        <p class="hint">Word 为纯文本版，不保留表格与图片排版；扫描件 PDF 是图片，需要 OCR，暂不支持。</p>
      </div>` : ''}

      ${tab === 'to-pdf' ? `
      <div class="tool-card">
        <button class="btn primary block" data-pick-img-pdf>选择图片并合成 PDF</button>
        <input type="file" accept="image/*" multiple hidden data-file-pdf />
        <p class="hint">每张图一页，A4 等比居中，保持原始清晰度。</p>
      </div>` : ''}

      <div class="tool-list" data-list></div>
    </div>`;

  const listEl = root.querySelector('[data-list]');
  const paint = () => {
    if (!st.items.length) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = st.items.map((it, i) => `
      <div class="file-row">
        <div class="file-main">
          <b>${it.name}</b>
          <em>${it.info || ''}</em>
        </div>
        <button class="btn small ghost" data-save="${i}">保存</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const it = st.items[Number(b.dataset.save)];
      const r = await saveBlob(it.blob, it.name);
      if (r && r.ok) toast('已保存：' + (r.path || it.name), 'ok');
      else if (!(r && r.canceled)) toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
    }));
  };

  root.querySelector('[data-back]').addEventListener('click', back);
  root.querySelectorAll('[data-tab2]').forEach((b) => b.addEventListener('click', () => {
    st.tab = b.dataset.tab2;
    st.items = [];
    renderFmt(root, back);
  }));
  root.querySelectorAll('[data-mime]').forEach((b) => b.addEventListener('click', () => {
    st.target = b.dataset.mime;
    renderFmt(root, back);
  }));
  root.querySelectorAll('[data-pdfout]').forEach((b) => b.addEventListener('click', () => {
    st.pdfOut = b.dataset.pdfout;
    renderFmt(root, back);
  }));
  const q = root.querySelector('[data-quality]');
  if (q) q.addEventListener('input', () => {
    st.quality = Number(q.value) / 100;
    root.querySelector('[data-q]').textContent = q.value + '%';
  });

  const fileEl = root.querySelector('[data-file]');
  const pick = root.querySelector('[data-pick]');
  if (pick && fileEl) {
    pick.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      const files = [...fileEl.files];
      fileEl.value = '';
      if (!files.length) return;
      toast('正在转换 ' + files.length + ' 张…');
      st.items = (await convertImages(files)).concat(st.items);
      paint();
      toast('完成', 'ok');
    });
  }

  const imgPdfEl = root.querySelector('[data-file-pdf]');
  const pickImgPdf = root.querySelector('[data-pick-img-pdf]');
  if (pickImgPdf && imgPdfEl) {
    pickImgPdf.addEventListener('click', () => imgPdfEl.click());
    imgPdfEl.addEventListener('change', async () => {
      const files = [...imgPdfEl.files];
      imgPdfEl.value = '';
      if (!files.length) return;
      toast('正在合成 PDF…');
      try {
        const blob = await imagesToPdf(files);
        st.items = [{ name: '合成-' + Date.now() + '.pdf', blob, info: fmtSize(blob.size) }].concat(st.items);
        paint();
        toast('已生成 PDF', 'ok');
      } catch (e) { toast('合成失败：' + e.message, 'err'); }
    });
  }

  const pdfEl = root.querySelector('[data-pdf]');
  const pickPdf = root.querySelector('[data-pick-pdf]');
  if (pickPdf && pdfEl) {
    pickPdf.addEventListener('click', () => pdfEl.click());
    pdfEl.addEventListener('change', async () => {
      const f = pdfEl.files && pdfEl.files[0];
      pdfEl.value = '';
      if (!f) return;
      const mode = st.pdfOut || 'img';
      toast(mode === 'img' ? '正在渲染页面…' : '正在提取文字…');
      try {
        if (mode === 'img') {
          st.items = (await pdfToImages(f)).concat(st.items);
        } else if (mode === 'txt') {
          const pages = await pdfToText(f);
          const blob = new Blob([pages.join('\n\n--- 分页 ---\n\n')], { type: 'text/plain;charset=utf-8' });
          st.items = [{ name: baseName(f.name) + '.txt', blob, info: pages.length + ' 页 · ' + fmtSize(blob.size) }].concat(st.items);
        } else {
          const pages = await pdfToText(f);
          const blob = await buildDocx(pages);
          st.items = [{ name: baseName(f.name) + '.docx', blob, info: pages.length + ' 页 · ' + fmtSize(blob.size) }].concat(st.items);
        }
        paint();
        toast('完成', 'ok');
      } catch (e) {
        toast('处理失败：' + e.message, 'err');
      }
    });
  }

  paint();
}
