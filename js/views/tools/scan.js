/* 工具：文档扫描 —— 拍照/选图 → 增强 → 合成 PDF */
import { toast, sheet } from '../../ui.js';
import { saveBlob, shareBlob } from '../../platform.js';
import { buildPdfFromJpegs } from '../../lib/pdflite.js';

let st = { pages: [], mode: 'gray', busy: false };

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
    img.src = url;
  });
}

function dataUrlToBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 扫描增强：灰度 + 对比度提升 + 压到合适宽度 */
async function enhance(file, mode) {
  const img = await loadImage(file);
  const maxW = 1600;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (mode === 'gray') ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.06)';
  else if (mode === 'bw') ctx.filter = 'grayscale(1) contrast(1.9) brightness(1.12)';
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  return {
    name: file.name || 'scan.jpg',
    thumb: canvas.toDataURL('image/jpeg', 0.4),
    dataUrl,
    bytes: dataUrlToBytes(dataUrl),
    width: w,
    height: h,
  };
}

export function renderScan(root, back) {
  const pages = st.pages;
  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-bar">
        <button class="btn small ghost" data-back>← 工具</button>
        <b>文档扫描</b>
      </div>

      <div class="tool-card">
        <div class="tool-row">
          <span class="tool-label">增强模式</span>
          <div class="tool-seg">
            <button class="seg-btn ${st.mode === 'gray' ? 'on' : ''}" data-mode="gray">灰度高对比</button>
            <button class="seg-btn ${st.mode === 'bw' ? 'on' : ''}" data-mode="bw">黑白文档</button>
            <button class="seg-btn ${st.mode === 'none' ? 'on' : ''}" data-mode="none">不处理</button>
          </div>
        </div>
        <div class="tool-actions">
          <button class="btn primary" data-camera>拍照扫描</button>
          <button class="btn ghost" data-pick>从相册选</button>
        </div>
        <input type="file" accept="image/*" capture="environment" hidden data-cam />
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">连续拍多页会自动合成一个 PDF；单页最长边压到 1600px，清晰度和体积兼顾。</p>
      </div>

      <div class="scan-grid" data-grid></div>
      ${pages.length ? `
        <div class="tool-foot">
          <span>共 ${pages.length} 页</span>
          <div class="tool-foot-actions">
            <button class="btn ghost small" data-clear>清空</button>
            <button class="btn primary small" data-share>转发 PDF</button>
            <button class="btn primary small" data-save>保存 PDF</button>
          </div>
        </div>` : ''}
    </div>`;

  const grid = root.querySelector('[data-grid]');
  const paint = () => {
    grid.innerHTML = pages.map((p, i) => `
      <div class="scan-item">
        <img src="${p.thumb}" alt="第${i + 1}页" />
        <span class="scan-idx">${i + 1}</span>
        <button class="scan-del" data-del="${i}" aria-label="删除">×</button>
      </div>`).join('');
    grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      pages.splice(Number(b.dataset.del), 1);
      renderScan(root, back);
    }));
  };

  root.querySelector('[data-back]').addEventListener('click', back);
  root.querySelector('[data-camera]').addEventListener('click', () => root.querySelector('[data-cam]').click());
  root.querySelector('[data-pick]').addEventListener('click', () => root.querySelector('[data-file]').click());
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    st.mode = b.dataset.mode;
    renderScan(root, back);
  }));

  const addFiles = async (files) => {
    if (!files.length) return;
    toast('正在处理 ' + files.length + ' 页…');
    for (const f of files) {
      try {
        pages.push(await enhance(f, st.mode));
      } catch (e) {
        toast('处理失败：' + e.message, 'err');
      }
    }
    renderScan(root, back);
  };

  root.querySelector('[data-cam]').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await addFiles(files);
  });
  root.querySelector('[data-file]').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await addFiles(files);
  });

  const makePdf = () => buildPdfFromJpegs(pages.map((p) => ({ data: p.bytes, width: p.width, height: p.height })));

  const clearBtn = root.querySelector('[data-clear]');
  if (clearBtn) clearBtn.addEventListener('click', () => { st.pages = []; renderScan(root, back); });

  const saveBtn = root.querySelector('[data-save]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const blob = makePdf();
    const r = await saveBlob(blob, '扫描文档-' + Date.now() + '.pdf');
    if (r && r.ok) toast('已保存 PDF', 'ok');
    else if (!(r && r.canceled)) toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
  });

  const shareBtn = root.querySelector('[data-share]');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const blob = makePdf();
    const r = await shareBlob(blob, '扫描文档-' + Date.now() + '.pdf');
    if (r && r.canceled) return;
    if (r && r.ok) toast('已发送', 'ok');
    else toast('转发失败', 'err');
  });

  paint();
}
