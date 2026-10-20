/* 工具：文档扫描 —— 自动找边、透视矫正、增强，多页合成 PDF */
import { toast, sheet } from '../../ui.js';
import { saveBlob, shareBlob } from '../../platform.js';
import { buildPdfFromJpegs } from '../../lib/pdflite.js';
import { scanDocument, scanDocumentAsync } from '../../lib/scanner.js';
import { cvScanInWorker, warmupWorkerEngine, workerAvailable } from '../../lib/cvscan-worker-client.js';
import { editCorners } from './corners.js';

const MODES = [
  { id: 'original', name: '原图' },
  { id: 'auto', name: '智能高清' },
  { id: 'shadow', name: '去阴影' },
  { id: 'gray', name: '灰度' },
  { id: 'bw', name: '黑白' },
];

let st = { pages: [], mode: 'auto', busy: false };

/** 处理进度浮层：避免看起来像卡死 */
let progressClosed = false;

function showProgress(label, pct) {
  if (progressClosed) return;
  let el = document.getElementById('scanProgress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scanProgress';
    el.className = 'scan-progress';
    el.innerHTML = '<div class="sp-box"><div class="sp-label"></div><div class="sp-bar"><i></i></div></div>';
    document.getElementById('app').appendChild(el);
  }
  el.querySelector('.sp-label').textContent = `${label} ${Math.round(pct)}%`;
  el.querySelector('.sp-bar i').style.width = Math.max(4, pct) + '%';
}
function hideProgress() {
  progressClosed = true;
  const el = document.getElementById('scanProgress');
  if (el) el.remove();
  // 下一轮扫描再允许显示
  setTimeout(() => { progressClosed = false; }, 300);
}

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

let engine = '内置';
let warming = false;

/** 由用户主动触发：在 Web Worker 里加载引擎，主线程不阻塞 */
function startWarmup(root) {
  if (warming || engine === 'OpenCV') return;
  if (!workerAvailable()) {
    const note = root.querySelector('[data-engine]');
    if (note) note.textContent = '图像引擎：内置算法（当前环境不支持 Worker）';
    return;
  }
  warming = true;
  const note = root.querySelector('[data-engine]');
  const t0 = Date.now();

  const tick = setInterval(() => {
    if (!warming || !note) return;
    const sec = Math.round((Date.now() - t0) / 1000);
    if (sec > 1 && !/解析|准备|就绪/.test(note.textContent)) {
      note.textContent = `图像引擎：后台加载中 ${sec}s（不影响使用）`;
    }
  }, 1000);

  warmupWorkerEngine((pct, label) => {
    if (note) note.textContent = `图像引擎：${label} ${Math.round(pct)}%`;
  }).then((hasMat) => {
    warming = false;
    clearInterval(tick);
    if (!hasMat) throw new Error('引擎缺少 cv.Mat');
    engine = 'OpenCV';
    if (note) note.textContent = '图像引擎：OpenCV 已就绪';
  }).catch((e) => {
    warming = false;
    clearInterval(tick);
    engine = '内置';
    if (note) {
      note.innerHTML = `图像引擎：内置算法（${(e && e.message) || '引擎不可用'}） <button class="link-btn" data-cvretry="1">重试</button>`;
      const btn = note.querySelector('[data-cvretry]');
      if (btn) btn.addEventListener('click', () => startWarmup(root));
    }
  });
}

/** 优先 OpenCV（Worker 里跑），不可用时用内置算法 */
async function scanPage(img, opts) {
  const onProgress = (pct, label) => showProgress(label, pct);
  showProgress('准备', 5);
  if (engine === 'OpenCV' && workerAvailable()) {
    try {
      return await cvScanInWorker(img, opts, onProgress);
    } catch (e) {
      engine = '内置';
      console.warn('OpenCV 出错，改用内置算法：', e && e.message);
    }
  }
  return scanDocumentAsync(img, Object.assign({}, opts, { onProgress }));
}
async function toPage(img, mode, quad) {
  let r;
  try {
    r = await scanPage(img, { mode, quad: quad || null, maxOut: 1600 });
  } finally {
    hideProgress();
  }

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
    quad: quad || r.quad,
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
        <button class="btn ghost block" data-cvstart style="margin-bottom:10px">启用 OpenCV 引擎（后台加载，不影响使用）</button>
        <div class="tool-actions">
          <button class="btn primary" data-camera ${st.busy ? 'disabled' : ''}>拍照扫描</button>
          <button class="btn ghost" data-pick ${st.busy ? 'disabled' : ''}>从相册选</button>
        </div>
        <input type="file" accept="image/*" capture="environment" hidden data-cam />
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">自动识别纸张边缘并矫正倾斜；识别不到时整张保留。长边压到 1600px。</p>
        <p class="hint" data-engine style="margin-top:4px">图像引擎：内置算法（可直接使用）</p>
      </div>

      <div class="scan-grid" data-grid></div>
      ${pages.length ? `
        <div class="tool-foot">
          <span>共 ${pages.length} 页${pages.some((p) => p.found === false) ? ' · 有页面未识别到边缘' : ''}</span>
          <div class="tool-foot-actions">
            <button class="btn ghost small" data-stages>对比图</button>
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

  grid.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = Number(b.dataset.adjust);
    const p = pages[i];
    if (!p) return;
    editCorners(p.img, p.quad, async (q) => {
      try {
        const np = await toPage(p.img, st.mode, q === null ? null : q);
        Object.assign(p, np);
      } catch (err) { toast('重算失败：' + err.message, 'err'); }
    
      renderScan(root, back);
    });
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

  const cvBtn = root.querySelector('[data-cvstart]');
  if (cvBtn) cvBtn.addEventListener('click', () => startWarmup(root));

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
        const np = await toPage(p.img, st.mode);
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
        showProgress('检测纸张边缘', 5);
        const probe = await scanPage(img, { mode: 'original', maxOut: 1200 });
      
        const first = probe;
        const detected = first.found ? first.quad : null;
        st.busy = false;
        await new Promise((resolve) => {
          editCorners(img, detected, async (q) => {
            try {
              const page = await toPage(img, st.mode, q || detected);
              pages.push(page);
            } catch (err) { toast('生成失败：' + err.message, 'err'); }
          
            resolve();
          });
        });
        st.busy = true;
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

  const stagesBtn = root.querySelector('[data-stages]');
  if (stagesBtn) stagesBtn.addEventListener('click', async () => {
    const p = pages[0];
    if (!p) { toast('先扫描一页', 'err'); return; }
    if (!window.JSZip) { toast('当前环境不支持打包', 'err'); return; }
    toast('正在生成对比图…');
    const zip = new window.JSZip();
    const add = (name, dataUrl) => {
      const b64 = String(dataUrl).split(',')[1] || '';
      zip.file(name, b64, { base64: true });
    };
    const st = await scanPage(p.img, { mode: st.mode, quad: p.quad, maxOut: 1600, wantStages: true });
  
    add('1-原图.jpg', p.img.src || '');
    if (st.stages.rectified) add('2-裁剪矫正.jpg', st.stages.rectified.toDataURL('image/jpeg', 0.92));
    if (st.stages.flattened) add('3-去阴影.jpg', st.stages.flattened.toDataURL('image/jpeg', 0.92));
    add('4-最终效果.jpg', st.canvas.toDataURL('image/jpeg', 0.92));
    const bw = await scanPage(p.img, { mode: 'bw', quad: p.quad, maxOut: 1600 });
    add('5-黑白.jpg', bw.canvas.toDataURL('image/jpeg', 0.92));
    const blob = await zip.generateAsync({ type: 'blob' });
    const r = await saveBlob(blob, '扫描对比-' + Date.now() + '.zip');
    if (r && r.ok) toast('已保存对比图', 'ok');
    else toast('保存失败', 'err');
  });

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
