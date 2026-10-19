/* 工具：拼图 —— 多张图片上下/左右拼接成长图 */
import { toast } from '../../ui.js';
import { saveBlob } from '../../platform.js';

let st = { dir: 'v', gap: 8, bg: '#ffffff', items: [] };

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')); };
    img.src = url;
  });
}

export function renderCollage(root, back) {
  const items = st.items;
  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-bar">
        <button class="btn small ghost" data-back>← 工具</button>
        <b>拼图</b>
      </div>

      <div class="tool-card">
        <div class="tool-row">
          <span class="tool-label">拼接方向</span>
          <div class="tool-seg">
            <button class="seg-btn ${st.dir === 'v' ? 'on' : ''}" data-dir="v">上下拼（长图）</button>
            <button class="seg-btn ${st.dir === 'h' ? 'on' : ''}" data-dir="h">左右拼</button>
          </div>
        </div>
        <div class="tool-row">
          <span class="tool-label">间距</span>
          <div class="tool-seg">
            ${[0, 8, 16, 32].map((g) => `<button class="seg-btn ${st.gap === g ? 'on' : ''}" data-gap="${g}">${g === 0 ? '无缝' : g + 'px'}</button>`).join('')}
          </div>
        </div>
        <button class="btn primary block" data-pick>添加图片</button>
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">按添加顺序拼接；图片会自动缩放到同一宽度（或高度），总长超过 8000px 会自动等比缩小。</p>
      </div>

      ${items.length ? `
        <div class="collage-list">
          ${items.map((it, i) => `
            <div class="collage-item">
              <img src="${it.thumb}" alt="" />
              <span>${i + 1}</span>
              <button class="scan-del" data-del="${i}">×</button>
            </div>`).join('')}
        </div>
        <div class="tool-foot">
          <span>${items.length} 张</span>
          <div class="tool-foot-actions">
            <button class="btn ghost small" data-clear>清空</button>
            <button class="btn primary small" data-save>生成并保存</button>
          </div>
        </div>` : '<p class="hint" style="text-align:center;margin-top:20px">还没有图片</p>'}
    </div>`;

  root.querySelector('[data-back]').addEventListener('click', back);
  root.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { st.dir = b.dataset.dir; renderCollage(root, back); }));
  root.querySelectorAll('[data-gap]').forEach((b) => b.addEventListener('click', () => { st.gap = Number(b.dataset.gap); renderCollage(root, back); }));

  const fileEl = root.querySelector('[data-file]');
  root.querySelector('[data-pick]').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const files = [...fileEl.files];
    fileEl.value = '';
    for (const f of files) {
      try {
        const img = await loadImage(f);
        const thumbCanvas = document.createElement('canvas');
        const s = 160 / Math.max(img.naturalWidth, img.naturalHeight);
        thumbCanvas.width = Math.round(img.naturalWidth * s);
        thumbCanvas.height = Math.round(img.naturalHeight * s);
        thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
        items.push({ img, thumb: thumbCanvas.toDataURL('image/jpeg', 0.6), w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) {
        toast('图片读取失败', 'err');
      }
    }
    renderCollage(root, back);
  });

  const clearBtn = root.querySelector('[data-clear]');
  if (clearBtn) clearBtn.addEventListener('click', () => { st.items = []; renderCollage(root, back); });

  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    items.splice(Number(b.dataset.del), 1);
    renderCollage(root, back);
  }));

  const saveBtn = root.querySelector('[data-save]');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (!items.length) { toast('先添加图片', 'err'); return; }
    try {
      const blob = await compose();
      const r = await saveBlob(blob, '拼图-' + Date.now() + '.jpg');
      if (r && r.ok) toast('已保存拼图', 'ok');
      else if (!(r && r.canceled)) toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
    } catch (e) {
      toast('生成失败：' + e.message, 'err');
    }
  });
}

async function compose() {
  const items = st.items;
  const gap = st.gap;
  const dir = st.dir;

  let baseW = 1080;
  if (dir === 'v') {
    baseW = Math.min(1080, Math.max(...items.map((i) => 320)));
  }

  const scaled = items.map((it) => {
    if (dir === 'v') {
      const w = baseW;
      const h = Math.round((it.h / it.w) * baseW);
      return { ...it, dw: w, dh: h };
    }
    const h = baseW;
    const w = Math.round((it.w / it.h) * baseW);
    return { ...it, dw: w, dh: h };
  });

  let totalW;
  let totalH;
  if (dir === 'v') {
    totalW = baseW;
    totalH = scaled.reduce((a, b) => a + b.dh, 0) + gap * (scaled.length - 1);
  } else {
    totalH = baseW;
    totalW = scaled.reduce((a, b) => a + b.dw, 0) + gap * (scaled.length - 1);
  }

  const MAX = 8000;
  const scale = Math.min(1, MAX / Math.max(totalW, totalH));
  totalW = Math.round(totalW * scale);
  totalH = Math.round(totalH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = st.bg || '#fff';
  ctx.fillRect(0, 0, totalW, totalH);

  let at = 0;
  for (const it of scaled) {
    const dw = Math.round(it.dw * scale);
    const dh = Math.round(it.dh * scale);
    if (dir === 'v') ctx.drawImage(it.img, 0, at, dw, dh);
    else ctx.drawImage(it.img, at, 0, dw, dh);
    at += (dir === 'v' ? dh : dw) + Math.round(gap * scale);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), 'image/jpeg', 0.92);
  });
}
