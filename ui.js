/* 通用 UI 工具：转义、格式化、图标、弹层、提示 */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<path d="M7 3v2M17 3v2M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>',
  file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z"/><path d="M14 3v4h4"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  upload: '<path d="M12 20V8M8 11l4-4 4 4M4 6V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14 6 4 4"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  folder: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 8a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 8v9a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 11h-5a2 2 0 0 0 0 4h5Z"/>',
  doc: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(n, withSymbol = true) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `¥${s}` : s;
}

export function moneyPlain(n) {
  const v = Number(n) || 0;
  return v.toFixed(2);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function fmtDateShort(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${m}/${d}`;
}

export function daysBetween(a, b) {
  if (!a || !b) return 0;
  const t1 = Date.parse(a), t2 = Date.parse(b);
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.max(1, Math.round((t2 - t1) / 86400000) + 1);
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------------- toast ---------------- */
let toastTimer;
export function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}

/* ---------------- sheet（支持叠加：选择器可以盖在表单之上） ---------------- */
const layer = () => document.getElementById('layer');
const sheets = () => [...layer().querySelectorAll('.sheet')];

function removeSheet(el) {
  const l = layer();
  if (!el || !l.contains(el)) return;
  el.style.transform = 'translateY(100%)';
  const cb = el._onClose;
  el._onClose = null;
  setTimeout(() => {
    el.remove();
    if (!l.querySelector('.sheet')) {
      l.classList.remove('active');
      l.innerHTML = '';
    }
    if (typeof cb === 'function') cb();
    if (window.__syncBack) window.__syncBack();
  }, 240);
}

export function closeSheet() {
  removeSheet(sheets().pop());
}

export function sheet({ title, body, foot, onMount, onClose, tall = false }) {
  const l = layer();
  if (!l.querySelector('.scrim')) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.dataset.close = '1';
    scrim.addEventListener('click', closeSheet);
    l.appendChild(scrim);
  }
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.style.zIndex = String(45 + sheets().length);
  if (tall) el.style.maxHeight = '94vh';
  el.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head">
      <h2>${esc(title || '')}</h2>
      <button class="icon-btn" data-close="1" aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="sheet-body">${body || ''}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  if (onClose) el._onClose = onClose;
  l.appendChild(el);
  requestAnimationFrame(() => l.classList.add('active'));
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  const closeThis = () => removeSheet(el);
  if (onMount) onMount(el, closeThis);
  if (window.__syncBack) window.__syncBack();
  return closeThis;
}
export function confirmSheet({ title = '确认', message = '', okText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };
    sheet({
      title,
      body: `<p style="margin:4px 2px 18px;color:var(--text-2);line-height:1.65;font-size:14.5px">${esc(message)}</p>`,
      foot: `<button class="btn ghost" data-x="0">${esc(cancelText)}</button>
             <button class="btn ${danger ? 'danger' : 'primary'}" data-x="1">${esc(okText)}</button>`,
      onMount(root, close) {
        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
          finish(b.dataset.x === '1');
          close();
        }));
      },
      onClose() { finish(false); },
    });
  });
}

/* 底部动作菜单 */
export function actionSheet(title, items) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const body = `<div class="menu-list">${items.map((it) => `
      <button class="menu-item ${it.danger ? 'danger' : ''}" data-key="${esc(it.key)}">
        ${icon(it.icon || 'plus')}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}
      </button>`).join('')}</div>`;
    sheet({
      title,
      body,
      onMount(root, close) {
        root.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
          finish(b.dataset.key);
          close();
        }));
      },
      onClose() { finish(null); },
    });
  });
}

/* 数字/文本输入弹层 */
export function promptSheet({ title, label = '', value = '', placeholder = '', type = 'text', okText = '确定', hint = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    sheet({
      title,
      body: `<div class="field"><label class="field-label">${esc(label)}</label>
        <input class="input" id="promptInput" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" /></div>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}`,
      foot: `<button class="btn ghost" data-x="0">取消</button><button class="btn primary" data-x="1">${esc(okText)}</button>`,
      onMount(root, close) {
        const input = root.querySelector('#promptInput');
        setTimeout(() => { input.focus(); input.select(); }, 260);
        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
          finish(b.dataset.x === '1' ? input.value.trim() : null);
          close();
        }));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { finish(input.value.trim()); close(); }
        });
      },
      onClose() { finish(null); },
    });
  });
}
