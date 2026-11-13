/* 工具：拼图 —— 多张图片上下/左右拼接成长图 */
import { toast, sheet } from '../../ui.js';
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
              <button class="collage-move" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="collage-move down" data-down="${i}" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
            </div>`).join('')}
        </div>
        <div class="tool-foot">
          <span>${items.length} 张</span>
          <div class="tool-foot-actions">
            <button class="btn ghost small" data-clear>清空</button>
            <button class="btn primary small" data-preview>预览</button>
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

  // 拖拽排序（长按拖动缩略图）
  let dragFrom = -1;
  let dragEl = null;
  const itemsEls = [...root.querySelectorAll('.collage-item')];
  itemsEls.forEach((el, idx) => {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      dragFrom = idx;
      dragEl = el;
      el.classList.add('dragging');
      el.setPointerCapture(ev.pointerId);
    });
    el.addEventListener('pointermove', (ev) => {
      if (dragFrom < 0 || !dragEl) return;
      const rect = el.getBoundingClientRect();
      const dx = ev.clientX - (rect.left + rect.width / 2);
      const dy = ev.clientY - (rect.top + rect.height / 2);
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    el.addEventListener('pointerup', (ev) => {
      if (dragFrom < 0) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const box = target && target.closest('.collage-item');
      const to = box ? itemsEls.indexOf(box) : dragFrom;
      dragEl.classList.remove('dragging');
      dragEl.style.transform = '';
      dragFrom = -1;
      dragEl = null;
      if (to >= 0 && to !== idx) {
        const moved = items.splice(idx, 1)[0];
        items.splice(to, 0, moved);
        renderCollage(root, back);
      }
    });
    el.addEventListener('pointercancel', () => {
      if (dragEl) { dragEl.classList.remove('dragging'); dragEl.style.transform = ''; }
      dragFrom = -1;
      dragEl = null;
    });
  });
  root.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.up);
    if (i > 0) { const t = items[i - 1]; items[i - 1] = items[i]; items[i] = t; renderCollage(root, back); }
  }));
  root.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.down);
    if (i < items.length - 1) { const t = items[i + 1]; items[i + 1] = items[i]; items[i] = t; renderCollage(root, back); }
  }));

  const previewBtn = root.querySelector('[data-preview]');
  if (previewBtn) previewBtn.addEventListener('click', async () => {
    if (!items.length) { toast('先添加图片', 'err'); return; }
    previewBtn.disabled = true;
    previewBtn.textContent = '生成中…';
    try {
      const blob = await compose(1200);
      const url = URL.createObjectURL(blob);
      sheet({
        title: '预览拼图',
        body: `<img src="${url}" style="width:100%;border-radius:12px;display:block" alt="拼图预览" />
          <p class="hint" style="margin-top:8px">${items.length} 张 · 可关闭后调整顺序</p>`,
        foot: '<button class="btn ghost" data-x="1">返回调整</button><button class="btn primary" data-save-now="1">保存</button>',
        onMount(el, close) {
          const saveNow = el.querySelector('[data-save-now]');
          saveNow.addEventListener('click', async () => {
            const full = await compose();
            const r = await saveBlob(full, '拼图-' + Date.now() + '.jpg');
            if (r && r.ok) { toast('已保存拼图', 'ok'); close(); }
            else if (!(r && r.canceled)) toast('保存失败：' + ((r && r.error) || '未知错误'), 'err');
          });
          const backBtn = el.querySelector('[data-x="1"]');
          if (backBtn) backBtn.addEventListener('click', (ev) => { ev.preventDefault(); close(); });
        },
        onClose() { URL.revokeObjectURL(url); },
      });
    } catch (e) {
      toast('生成失败：' + e.message, 'err');
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = '预览';
    }
  });
}

async function compose(previewMax) {
  const items = st.items;
  const gap = st.gap;
  const dir = st.dir;

  // 关键：保持原始分辨率，不缩放、不放大
  const naturals = items.map((it) => ({ im: it.img, w: it.w, h: it.h }));

  let totalW;
  let totalH;
  if (dir === 'v') {
    totalW = Math.max(...naturals.map((n) => n.w));
    totalH = naturals.reduce((a, b) => a + b.h, 0) + gap * (naturals.length - 1);
  } else {
    totalH = Math.max(...naturals.map((n) => n.h));
    totalW = naturals.reduce((a, b) => a + b.w, 0) + gap * (naturals.length - 1);
  }

  // 预览时缩到小尺寸（快），保存时才用原始分辨率
  const MAX = previewMax || 12000;
  const k = Math.min(1, MAX / Math.max(totalW, totalH));
  if (k < 1) {
    totalW = Math.round(totalW * k);
    totalH = Math.round(totalH * k);
  }

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = st.bg || '#fff';
  ctx.fillRect(0, 0, totalW, totalH);

  let cursor = 0;
  for (const n of naturals) {
    const w = Math.round(n.w * k);
    const h = Math.round(n.h * k);
    if (dir === 'v') {
      const x = Math.round((totalW - w) / 2);   // 宽度不一居中，不放大
      ctx.drawImage(n.im, x, cursor, w, h);
      cursor += h + Math.round(gap * k);
    } else {
      const y = Math.round((totalH - h) / 2);
      ctx.drawImage(n.im, cursor, y, w, h);
      cursor += w + Math.round(gap * k);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), 'image/jpeg', 0.95);
  });
}