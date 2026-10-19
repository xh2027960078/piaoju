/* 工具：图片格式转换（JPG / PNG / WEBP，可调质量） */
import { toast } from '../../ui.js';
import { saveBlob } from '../../platform.js';

const TARGETS = [
  { mime: 'image/jpeg', ext: 'jpg', name: 'JPG' },
  { mime: 'image/png', ext: 'png', name: 'PNG' },
  { mime: 'image/webp', ext: 'webp', name: 'WEBP' },
];

let st = { target: 'image/jpeg', quality: 0.9, items: [], busy: false };

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
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

async function convert(file, mime, quality) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error('转换失败');
  return { blob, w: canvas.width, h: canvas.height };
}

function baseName(name) {
  return String(name || 'image').replace(/\.[^.]+$/, '');
}

export function renderFmt(root, back) {
  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-bar">
        <button class="btn small ghost" data-back>← 工具</button>
        <b>格式转换</b>
      </div>

      <div class="tool-card">
        <div class="tool-row">
          <span class="tool-label">目标格式</span>
          <div class="tool-seg">
            ${TARGETS.map((t) => `<button class="seg-btn ${st.target === t.mime ? 'on' : ''}" data-mime="${t.mime}">${t.name}</button>`).join('')}
          </div>
        </div>
        <div class="tool-row ${st.target === 'image/png' ? 'is-off' : ''}">
          <span class="tool-label">质量 <b data-q>${Math.round(st.quality * 100)}%</b></span>
          <input type="range" min="40" max="100" step="5" value="${Math.round(st.quality * 100)}" data-quality />
        </div>
        <button class="btn primary block" data-pick>选择图片（可多选）</button>
        <input type="file" accept="image/*" multiple hidden data-file />
        <p class="hint">支持 JPG / PNG / WEBP / HEIC 导入，转成你选的格式；不改变图片尺寸。</p>
      </div>

      <div class="tool-list" data-list></div>
    </div>`;

  const fileEl = root.querySelector('[data-file]');
  const listEl = root.querySelector('[data-list]');

  const paint = () => {
    if (!st.items.length) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = st.items.map((it, i) => `
      <div class="file-row">
        <div class="file-main">
          <b>${it.outName}</b>
          <em>${it.w}×${it.h} · ${fmtSize(it.from)} → ${fmtSize(it.size)}</em>
        </div>
        <button class="btn small ghost" data-save="${i}">保存</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const it = st.items[Number(b.dataset.save)];
      const r = await saveBlob(it.blob, it.outName);
      if (r && r.ok) toast('已保存：' + (r.path || it.outName), 'ok');
      else if (r && r.canceled) { /* 用户取消 */ }
      else toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
    }));
  };

  root.querySelector('[data-back]').addEventListener('click', back);

  root.querySelectorAll('[data-mime]').forEach((b) => b.addEventListener('click', () => {
    st.target = b.dataset.mime;
    renderFmt(root, back);
  }));

  const q = root.querySelector('[data-quality]');
  if (q) q.addEventListener('input', () => {
    st.quality = Number(q.value) / 100;
    root.querySelector('[data-q]').textContent = q.value + '%';
  });

  root.querySelector('[data-pick]').addEventListener('click', () => fileEl.click());

  fileEl.addEventListener('change', async () => {
    const files = [...fileEl.files];
    fileEl.value = '';
    if (!files.length) return;
    const target = TARGETS.find((t) => t.mime === st.target);
    toast('正在转换 ' + files.length + ' 张…');
    const items = [];
    for (const f of files) {
      try {
        const r = await convert(f, target.mime, st.quality);
        items.push({
          blob: r.blob,
          size: r.blob.size,
          from: f.size,
          w: r.w,
          h: r.h,
          outName: baseName(f.name) + '.' + target.ext,
        });
      } catch (e) {
        toast(f.name + ' 转换失败：' + e.message, 'err');
      }
    }
    st.items = items.concat(st.items);
    paint();
    if (items.length) toast('转换完成 ' + items.length + ' 张', 'ok');
  });

  paint();
}
