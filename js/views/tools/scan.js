/* 工具：文档扫描 —— 自动找边、透视矫正、增强，多页合成 PDF */
import { toast, sheet } from '../../ui.js';
import { saveBlob, shareBlob } from '../../platform.js';
import { buildPdfFromJpegs } from '../../lib/pdflite.js';
import { scanDocument } from '../../lib/scanner.js';

const MODES = [
  { id: 'auto', name: '智能增强' },
  { id: 'gray', name: '灰度' },
  { id: 'bw', name: '黑白文档' },
  { id: 'color', name: '彩色原样' },
];

let st = { pages: [], mode: 'auto', busy: false };

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

function toPage(img, mode) {
  const r = scanDocument(img, mode, 1600);
  const dataUrl = r.canvas.toDataURL('image/jpeg', 0.88);
  const thumbCanvas = document.createElement('canvas');
  const k = 260 / Math.max(r.canvas.width, r.canvas.height);
  thumbCanvas.width = Math.round(r.canvas.width * k);
  thumbCanvas.height = Math.round(r.canvas.height * k);
  thumbCanvas.getContext('2d').drawImage(r.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return {
    dataUrl,
    bytes: dataUrlToBytes(dataUrl),
    width: r.canvas.width,
    height: r.canvas.height,
    thumb: thumbCanvas.toDataURL('image/jpeg', 0.6),
    found: r.found,
    img,
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
          <span class="tool-label">处理方式</span>
          <div class="tool-seg">
            ${MODES.map((m) => `<button class="seg-btn ${st.mode === m.id ? 'on' : ''}" data-mode="${m.id}">${m.name}</button>`).join('')}
          </div>
        </div>
        <div class="tool-actions">
          <button class="btn primary" data-camera ${st.busy ? 'disabled' : ''}>拍照扫描</button>
          <button class="btn ghost" data-pick ${st.busy ? 'disabled' : ''}>从相册选</button>
        </div>
        <input type="file" accept="image/*" capture="environment" hidden data-cam />
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">自动识别纸张边缘并矫正倾斜；识别不到时整张保留。长边压到 1600px。</p>
      </div>

      <div class="scan-grid" data-grid></div>
      ${pages.length ? `
        <div class="tool-foot">
          <span>共 ${pages.length} 页${pages.some((p) => p.found === false) ? ' · 有页面未识别到边缘' : ''}</span>
          <div class="tool-foot-actions">
            <button class="btn ghost small" data-clear>清空</button>
            <button class="btn primary small" data-share>转发 PDF</button>
            <button class="btn primary small" data-save>保存 PDF</button>
          </div>
        </div>` : ''}
    </div>`;

  const grid = root.querySelector('[data-grid]');
  grid.innerHTML = pages.map((p, i) => `
    <div class="scan-item" data-open="${i}">
      <img src="${p.thumb}" alt="第${i + 1}页" />
      <span class="scan-idx">${i + 1}${p.found ? '' : ' · 原图'}</span>
      <button class="scan-del" data-del="${i}" aria-label="删除">×</button>
    </div>`).join('');

  grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    pages.splice(Number(b.dataset.del), 1);
    renderScan(root, back);
  }));

  grid.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => {
    const p = pages[Number(el.dataset.open)];
    if (!p) return;
    sheet({
      title: '第 ' + (Number(el.dataset.open) + 1) + ' 页',
      body: `<img src="${p.dataUrl}" style="width:100%;border-radius:12px;display:block" alt="扫描页" />
        <p class="hint" style="margin-top:8px">${p.found ? '已自动识别纸张边缘并矫正' : '未识别到明显边缘，已保留整张图片'}</p>`,
      foot: '<button class="btn primary" data-x="1">关闭</button>',
    });
  }));

  root.querySelector('[data-back]').addEventListener('click', back);
  root.querySelector('[data-camera]').addEventListener('click', () => root.querySelector('[data-cam]').click());
  root.querySelector('[data-pick]').addEventListener('click', () => root.querySelector('[data-file]').click());

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
    st.mode = b.dataset.mode;
    if (!pages.length) { renderScan(root, back); return; }
    st.busy = true;
    toast('正在重新处理 ' + pages.length + ' 页…');
    for (const p of pages) {
      try {
        const np = toPage(p.img, st.mode);
        p.dataUrl = np.dataUrl; p.bytes = np.bytes; p.thumb = np.thumb; p.found = np.found;
        p.width = np.width; p.height = np.height;
      } catch (e) { /* 跳过失败页 */ }
    }
    st.busy = false;
    renderScan(root, back);
  }));

  const addFiles = async (files) => {
    if (!files.length) return;
    st.busy = true;
    toast('正在扫描 ' + files.length + ' 页…');
    for (const f of files) {
      try {
        const img = await loadImage(f);
        pages.push(toPage(img, st.mode));
      } catch (e) {
        toast('处理失败：' + e.message, 'err');
      }
    }
    st.busy = false;
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
}
