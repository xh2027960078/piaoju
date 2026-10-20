/* 工具：文档扫描 —— 自动找边、透视矫正、增强，多页合成 PDF */
import { toast, sheet } from '../../ui.js';
import { saveBlob, shareBlob } from '../../platform.js';
import { buildPdfFromJpegs } from '../../lib/pdflite.js';
import { scanDocument, scanDocumentAsync, detectQuadOnImage } from '../../lib/scanner.js';
import { editCorners } from './corners.js';
import { nativeAvailable, nativeVersion, scanNativeFile } from '../../lib/scannative.js';

const MODES = [
  { id: 'original', name: '原图' },
  { id: 'auto', name: '智能高清' },
  { id: 'shadow', name: '去阴影' },
  { id: 'gray', name: '灰度' },
  { id: 'bw', name: '黑白' },
];

let st = { pages: [], mode: 'auto', busy: false };

let progressSession = 0;
let progressTick = null;

function showProgress(label, pct, session) {
  if (session !== undefined && session !== progressSession) return;
  let el = document.getElementById('scanProgress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scanProgress';
    el.className = 'scan-progress';
    el.innerHTML = '<div class="sp-box"><div class="sp-label"></div><div class="sp-bar"><i></i></div></div>';
    document.getElementById('app').appendChild(el);
  }
  el.dataset.label = String(label);
  el.dataset.pct = String(Math.round(pct));
  el.dataset.since = String(Date.now());
  el.querySelector('.sp-label').textContent = label + ' ' + Math.round(pct) + '%';
  el.querySelector('.sp-bar i').style.width = Math.max(4, pct) + '%';

  if (!progressTick) {
    progressTick = setInterval(function () {
      const box = document.getElementById('scanProgress');
      if (!box) { clearInterval(progressTick); progressTick = null; return; }
      const since = Number(box.dataset.since || 0);
      const sec = Math.round((Date.now() - since) / 1000);
      if (sec >= 12) {
        hideProgress();
        try { toast('处理超时，已停止等待（' + (box.dataset.label || '') + '）', 'err'); } catch (e) { /* ignore */ }
        return;
      }
      if (sec >= 2) box.querySelector('.sp-label').textContent = box.dataset.label + ' ' + box.dataset.pct + '%（' + sec + 's）';
    }, 500);
  }
}

function hideProgress() {
  progressSession += 1;
  const el = document.getElementById('scanProgress');
  if (el) el.remove();
  if (progressTick) { clearInterval(progressTick); progressTick = null; }
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

/** 优先原生 OpenCV（快、准），不可用时退回内置管线 */
async function scanPage(img, opts) {
  const onProgress = (pct, label) => showProgress(label, pct);
  showProgress('准备', 5);
  if (nativeAvailable() && !opts.forceBuiltin) {
    try {
      onProgress(35, '原生处理');
      const r = await scanNativeFile(img, opts);
      onProgress(96, '生成图像');
      return r;
    } catch (e) {
      console.warn('原生扫描失败，改用内置：', e && e.message);
      toast('原生引擎失败：' + (e && e.message ? e.message : '未知'), 'err');
    }
  }
  return scanDocumentAsync(img, Object.assign({}, opts, { onProgress }));
}
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

async function toPage(img, mode, quad) {
  let r;
  try {
    r = await scanPage(img, { mode, quad: quad || null, maxOut: 1600 });
  } finally {
    /* 收进度条放在调用方，这里先不关，方便看到后续阶段 */
  }

  showProgress('编码图片', 97);
  await yieldFrame();
  const dataUrl = r.canvas.toDataURL('image/jpeg', 0.88);

  showProgress('生成缩略图', 98);
  await yieldFrame();
  const thumbCanvas = document.createElement('canvas');
  const k = 260 / Math.max(r.canvas.width, r.canvas.height);
  thumbCanvas.width = Math.round(r.canvas.width * k);
  thumbCanvas.height = Math.round(r.canvas.height * k);
  thumbCanvas.getContext('2d').drawImage(r.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  showProgress('刷新列表', 99);
  await yieldFrame();
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
        <div class="tool-actions">
          <button class="btn primary" data-camera ${st.busy ? 'disabled' : ''}>拍照扫描</button>
          <button class="btn ghost" data-pick ${st.busy ? 'disabled' : ''}>从相册选</button>
        </div>
        <input type="file" accept="image/*" capture="environment" hidden data-cam />
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">自动识别纸张边缘并矫正倾斜；识别不到时整张保留。</p>
        <p class="hint" data-engine style="margin-top:4px"></p>
        <div class="model-dl" data-model-dl hidden style="margin-top:8px;padding:10px 12px;border:1px solid var(--line,#e5e7eb);border-radius:10px;background:var(--bg,#fafafa)">
          <div style="font-size:13px;color:#374151">去弯曲模型未下载（28 MB，仅需一次）</div>
          <div class="hint" data-dl-hint style="margin:4px 0 8px">下载后可自动抹平纸面弯曲，线条更平直；不下载也可正常扫描。</div>
          <div data-dl-bar hidden style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:8px">
            <div data-dl-fill style="height:100%;width:0;background:#2563eb;transition:width .2s"></div>
          </div>
          <button class="btn" data-dl-start style="font-size:13px;padding:6px 14px">立即下载</button>
        </div>
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
        hideProgress();
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

  const engNote = root.querySelector('[data-engine]');
  if (engNote) {
    const v = nativeAvailable() ? nativeVersion() : '';
    const ortPart = (v.split('| ORT:')[1] || '').trim();
    const aiPart = (v.split('| AI:')[1] || '').trim();
    const chk = (s, key) => (s && s.includes(key) ? '✓' : '✗');
    const ortOk = chk(ortPart, 'corner');
    const devOk = chk(ortPart, 'dewarp') || chk(ortPart, 'ready');
    engNote.textContent = nativeAvailable()
      ? '引擎：OpenCV 4.9 + ORT｜AI找边 ' + ortOk + '　去弯曲 ' + devOk
      : '引擎：内置算法（原生不可用）';

    // 去弯曲模型缺失时提供一次性下载（不阻塞其他功能）
    const dlBox = root.querySelector('[data-model-dl]');
    if (dlBox && nativeAvailable()) {
      const bridge = window.Android;
      let missing = false;
      try { missing = bridge && bridge.modelExists && !bridge.modelExists('docscanner.onnx'); } catch (e) { missing = false; }
      dlBox.hidden = !missing;
      if (missing) {
        const btn = dlBox.querySelector('[data-dl-start]');
        const hint = dlBox.querySelector('[data-dl-hint]');
        const bar = dlBox.querySelector('[data-dl-bar]');
        const fill = dlBox.querySelector('[data-dl-fill]');
        const url = (window.APP_CONFIG && window.APP_CONFIG.modelUrl) || '';
        btn.addEventListener('click', () => {
          if (!url) { hint.textContent = '未配置模型下载地址'; return; }
          btn.disabled = true;
          bar.hidden = false;
          hint.textContent = '正在下载 0%';
          const rid = 'model-' + Date.now();
          window.__onModelProgress = (id, pct) => { if (id !== rid) return; fill.style.width = pct + '%'; hint.textContent = '正在下载 ' + pct + '%'; };
          window.__onModelDone = (id, ok, size, err) => {
            if (id !== rid) return;
            btn.disabled = false;
            if (ok) {
              bar.hidden = true;
              hint.textContent = '已下载 ' + Math.round(size / 1048576) + ' MB，下次扫描生效';
              setTimeout(() => { dlBox.hidden = true; renderScan(root, back); }, 1200);
            } else {
              bar.hidden = true;
              hint.textContent = '下载失败：' + (err || '网络错误') + '，可重试';
            }
          };
          bridge.downloadModel(rid, url, 'docscanner.onnx');
        });
      }
    }
  }

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
        let detected = first.found ? first.quad : null;
        // 按用户要求：不再自动裁剪，初始框就是整张图，需要时手动拖动
        hideProgress();
        st.busy = false;
        await new Promise((resolve) => {
          editCorners(img, detected, async (q) => {
            try {
              const page = await toPage(img, st.mode, q || detected);
              pages.push(page);
              hideProgress();
            } catch (err) { toast('生成失败：' + err.message, 'err'); }
          
            resolve();
          });
        });
        st.busy = true;
      } catch (e) {
        hideProgress();
        toast('处理失败：' + e.message, 'err');
      }
    }
    hideProgress();
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
    const st = await scanPage(p.img, { mode: st.mode, quad: p.quad, maxOut: 1600, wantStages: true, forceBuiltin: true });
  
    add('1-原图.jpg', p.img.src || '');
    if (st.stages.rectified) add('2-裁剪矫正.jpg', st.stages.rectified.toDataURL('image/jpeg', 0.92));
    if (st.stages.flattened) add('3-去阴影.jpg', st.stages.flattened.toDataURL('image/jpeg', 0.92));
    add('4-最终效果.jpg', st.canvas.toDataURL('image/jpeg', 0.92));
    const bw = await scanPage(p.img, { mode: 'bw', quad: p.quad, maxOut: 1600, forceBuiltin: true });
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
