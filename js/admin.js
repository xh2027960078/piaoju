/* 管理后台：邮箱 + 密码登录 Supabase，读取 events 做聚合展示。
   只读事件（事件名、设备随机 ID、时间、平台、版本），不含任何票据内容。 */

const cfg = window.APP_CONFIG || {};
const TOKEN_KEY = 'pj-admin-token';
const EMAIL_KEY = 'pj-admin-email';
const MAX_ROWS = 5000;

const main = document.getElementById('aMain');
const actions = document.getElementById('aActions');
const subEl = document.getElementById('a-sub');

const state = { events: [], loading: false, error: '' };

function token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
function setToken(t) { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function shortId(id) { return String(id || '').slice(0, 8); }

async function login(email, password) {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || '登录失败');
  setToken(data.access_token);
  try { sessionStorage.setItem(EMAIL_KEY, email); } catch (e) { /* ignore */ }
  return data;
}

async function fetchEvents() {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/events?select=*&order=created_at.desc&limit=${MAX_ROWS}`, {
    headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token()}` },
  });
  if (res.status === 401 || res.status === 403) { setToken(''); throw new Error('登录已过期，请重新登录'); }
  if (!res.ok) throw new Error(`读取数据失败（${res.status}）`);
  return res.json();
}

/* ---------------- 聚合 ---------------- */
function aggregate(events) {
  const now = new Date();
  const today = dayKey(now);
  const weekAgo = Date.now() - 7 * 86400000;
  const devices = new Map();
  const byEvent = new Map();
  const byPlatform = new Map();
  const byVersion = new Map();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ key: dayKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, devices: new Set() });
  }
  const dayMap = new Map(days.map((d) => [d.key, d]));

  let todayDevices = new Set();
  let weekDevices = new Set();

  for (const e of events) {
    const dev = e.device_id || 'unknown';
    const rec = devices.get(dev) || { id: dev, count: 0, first: e.created_at, last: e.created_at, platform: e.platform || '-', version: e.app_version || '-', lastEvent: e.event, label: '', screen: '' };
    rec.count++;
    if (e.created_at < rec.first) rec.first = e.created_at;
    if (e.created_at > rec.last) { rec.last = e.created_at; rec.lastEvent = e.event; rec.platform = e.platform || rec.platform; rec.version = e.app_version || rec.version; }
    if (e.device_label) rec.label = e.device_label;
    if (e.screen) rec.screen = e.screen;
    devices.set(dev, rec);

    byEvent.set(e.event, (byEvent.get(e.event) || 0) + 1);
    byPlatform.set(e.platform || '-', (byPlatform.get(e.platform || '-') || 0) + 1);
    byVersion.set(e.app_version || '-', (byVersion.get(e.app_version || '-') || 0) + 1);

    const k = dayKey(e.created_at);
    if (k === today) todayDevices.add(dev);
    if (new Date(e.created_at).getTime() >= weekAgo) weekDevices.add(dev);
    if (dayMap.has(k)) dayMap.get(k).devices.add(dev);
  }

  const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    devices: [...devices.values()].sort((a, b) => (a.last < b.last ? 1 : -1)),
    byEvent: sortMap(byEvent),
    byPlatform: sortMap(byPlatform),
    byVersion: sortMap(byVersion),
    days,
    todayCount: todayDevices.size,
    weekCount: weekDevices.size,
    total: events.length,
  };
}

/* ---------------- 渲染 ---------------- */
function renderLogin(err = '') {
  subEl.textContent = '请使用管理员账号登录';
  actions.innerHTML = '';
  main.innerHTML = `
    <form class="a-login" id="loginForm">
      <h2>管理员登录</h2>
      <p>只有被授权的账号能查看统计，普通用户看不到这个页面。</p>
      <div class="a-field"><label>邮箱</label><input id="email" type="email" autocomplete="username" required /></div>
      <div class="a-field"><label>密码</label><input id="password" type="password" autocomplete="current-password" required /></div>
      <button class="primary" type="submit">登录</button>
      <div class="a-err" id="loginErr">${esc(err)}</div>
    </form>`;
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await login(document.getElementById('email').value.trim(), document.getElementById('password').value);
      await refresh();
    } catch (e) {
      document.getElementById('loginErr').textContent = e.message;
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });
}

function renderDashboard() {
  const a = aggregate(state.events);
  subEl.textContent = `共 ${a.devices.length} 台设备 · ${a.total} 条事件`;

  actions.innerHTML = `
    <button id="btnRefresh">刷新</button>
    <button id="btnLogout">退出</button>`;
  document.getElementById('btnRefresh').addEventListener('click', refresh);
  document.getElementById('btnLogout').addEventListener('click', () => { setToken(''); renderLogin(); });

  if (!state.events.length) {
    main.innerHTML = '<div class="a-empty">还没有数据。让同事打开应用并操作几次，几秒后这里就会出现。</div>';
    return;
  }

  const maxDay = Math.max(1, ...a.days.map((d) => d.devices.size));
  const bars = a.days.map((d) => `
    <div class="a-bar" title="${d.key}：${d.devices.size} 台">
      <i style="height:${Math.round((d.devices.size / maxDay) * 100)}%"></i>
      <b>${d.devices.size || ''}</b>
      <em>${d.label}</em>
    </div>`).join('');

  const rank = (list, total) => list.slice(0, 8).map(([name, n]) => `
    <div class="a-rank-row">
      <span class="a-rank-name">${esc(name)}</span>
      <span class="a-rank-track"><i style="width:${Math.max(2, Math.round((n / Math.max(1, total)) * 100))}%"></i></span>
      <span class="a-rank-val">${n}</span>
    </div>`).join('');

  const propsText = (p) => {
    if (!p || typeof p !== 'object') return '';
    return Object.keys(p).map((k) => `${k}=${p[k]}`).join('　');
  };

  const devRows = a.devices.map((d) => {
    const mine = state.events.filter((e) => e.device_id === d.id).slice(0, 40);
    const timeline = mine.map((e) => `
      <div class="a-tl-item">
        <span class="a-tl-time">${fmtTime(e.created_at)}</span>
        <span class="a-tag">${esc(e.event)}</span>
        <span class="a-tl-props">${esc(propsText(e.props))}</span>
      </div>`).join('');
    return `
    <tr class="a-dev-row" data-dev="${esc(d.id)}" title="点击查看这台设备都做了什么">
      <td>
        <div class="a-dev-label">${esc(d.label || '未知机型')}</div>
        <div class="a-dev-sub mono">${esc(shortId(d.id))}${d.screen ? ' · ' + esc(d.screen) : ''}</div>
      </td>
      <td>${esc(d.platform)}</td>
      <td>${esc(d.version)}</td>
      <td>${d.count}</td>
      <td class="a-muted">${fmtTime(d.first)}</td>
      <td>${fmtTime(d.last)}</td>
      <td><span class="a-tag">${esc(d.lastEvent)}</span></td>
    </tr>
    <tr class="a-dev-detail" hidden><td colspan="7">
      <div class="a-tl-title">最近 ${mine.length} 条操作</div>
      <div class="a-tl">${timeline || '<span class="a-muted">暂无记录</span>'}</div>
    </td></tr>`;
  }).join('');

  main.innerHTML = `
    <div class="a-stats">
      <div class="a-stat blue"><div class="k">今日活跃设备</div><div class="v">${a.todayCount}<small>台</small></div></div>
      <div class="a-stat green"><div class="k">近 7 天活跃</div><div class="v">${a.weekCount}<small>台</small></div></div>
      <div class="a-stat"><div class="k">设备总数</div><div class="v">${a.devices.length}<small>台</small></div></div>
      <div class="a-stat"><div class="k">事件总数</div><div class="v">${a.total}<small>条</small></div></div>
    </div>

    <div class="a-grid">
      <div class="a-card">
        <h3>最近 14 天活跃设备<span>同一台设备每天只算一次</span></h3>
        <div class="a-bars">${bars}</div>
      </div>
      <div class="a-card">
        <h3>功能使用分布<span>事件次数</span></h3>
        <div class="a-rank">${rank(a.byEvent, a.total)}</div>
      </div>
    </div>

    <div class="a-grid">
      <div class="a-card">
        <h3>版本分布</h3>
        <div class="a-rank">${rank(a.byVersion, a.total)}</div>
      </div>
      <div class="a-card">
        <h3>平台分布</h3>
        <div class="a-rank">${rank(a.byPlatform, a.total)}</div>
      </div>
    </div>

    <div class="a-card">
      <h3>设备明细<span>点一行展开该设备的操作记录 · 最新 ${a.devices.length} 台</span></h3>
      <div class="a-scroll">
        <table class="a-table">
          <thead><tr><th>设备</th><th>平台</th><th>版本</th><th>事件数</th><th>首次</th><th>最近</th><th>最近事件</th></tr></thead>
          <tbody>${devRows}</tbody>
        </table>
      </div>
    </div>`;

  main.querySelectorAll('.a-dev-row').forEach((row) => {
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('a-dev-detail')) next.hidden = !next.hidden;
    });
  });
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  try {
    state.events = await fetchEvents();
    state.error = '';
    renderDashboard();
  } catch (e) {
    if (!token()) { renderLogin(e.message); }
    else { main.innerHTML = `<div class="a-empty">${esc(e.message)}</div>`; }
  } finally {
    state.loading = false;
  }
}

function boot() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    main.innerHTML = `<div class="a-empty">
      还没有配置 Supabase。<br/><br/>
      打开 <code>js/config.js</code>，填入项目的 URL 和 anon key，重新上传后刷新本页。
    </div>`;
    return;
  }
  if (!token()) { renderLogin(); return; }
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
}

boot();
