/* 管理后台：邮箱 + 密码登录 Supabase，读取 events 做聚合展示。
   只读事件（事件名、设备随机 ID、时间、平台、版本），不含任何票据内容。 */

const cfg = window.APP_CONFIG || {};
const TOKEN_KEY = 'pj-admin-token';
const EMAIL_KEY = 'pj-admin-email';
const MAX_ROWS = 5000;

const main = document.getElementById('aMain');
const actions = document.getElementById('aActions');
const subEl = document.getElementById('a-sub');

const state = { events: [], releases: [], loading: false, error: '', uploading: false };

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

/* 事件名 / 平台名汉化 */
const EVENT_LABEL = {
  app_open: '打开应用',
  page_view: '浏览页面',
  period_create: '新建周期',
  period_delete: '删除周期',
  file_import: '导入票据/附件',
  file_delete: '删除文件',
  move_file: '移动文件',
  export_zip: '导出 ZIP',
  export_xlsx: '生成报销单',
  backup: '备份数据',
  restore: '恢复备份',
  share_file: '转发文件',
  detect: '识别发票',
};
const PLATFORM_LABEL = {
  app: '安卓 App',
  android: '安卓浏览器',
  wechat: '微信',
  ios: 'iOS',
  desktop: '电脑',
};
function eventName(e) { return EVENT_LABEL[e] || e || '-'; }
function platformName(p) { return PLATFORM_LABEL[p] || p || '-'; }


function bumpVersionName(name) {
  const parts = String(name || '0.0.0').split('.');
  const last = Number(parts[parts.length - 1]) || 0;
  parts[parts.length - 1] = String(last + 1);
  return parts.join('.');
}


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

async function fetchReleases() {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/releases?select=*&order=version_code.desc,created_at.desc&limit=10`, {
    headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return [];
  return res.json();
}

/* 上传 APK 到 Storage 并写入版本记录 */
function uploadApk(file, name, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cfg.supabaseUrl}/storage/v1/object/app/${encodeURIComponent(name)}`);
    xhr.setRequestHeader('apikey', cfg.supabaseAnonKey);
    xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.setRequestHeader('Content-Type', file.type || 'application/vnd.android.package-archive');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`上传失败（${xhr.status}）${String(xhr.responseText || '').slice(0, 120)}`));
    };
    xhr.onerror = () => reject(new Error('上传失败：网络错误'));
    xhr.send(file);
  });
}

/* 读取 APK 内部版本（APK 是 zip，里面的 assets/www/js/config.js 有 version） */
async function apkInternalVersion(file) {
  try {
    if (!window.JSZip) return null;
    const zip = await window.JSZip.loadAsync(file);
    const entry = zip.file('assets/www/js/config.js') || (zip.file(/assets\/www\/js\/config\.js$/) || [])[0];
    if (!entry) return null;
    const txt = await entry.async('string');
    const m = txt.match(/version:\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function deleteRelease(id) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/releases?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token()}`, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`删除失败（${res.status}）`);
}
async function createRelease({ code, name, url, size, notes }) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/releases`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([{ version_code: code, version_name: name, url, size, notes }]),
  });
  if (!res.ok) throw new Error(`写入版本记录失败（${res.status}）${String(await res.text()).slice(0, 120)}`);
}

/* ---------------- 聚合 ---------------- */
/* 游戏时长排行（按累计秒数） */
function gameRank(map) {
  const GAME_NAME = { mine: '扫雷', g2048: '2048', snake: '贪吃蛇', tetris: '俄罗斯方块' };
  const rows = [...(map || new Map()).entries()]
    .sort((x, y) => y[1].seconds - x[1].seconds)
    .map(([k, v]) => [GAME_NAME[k] || k, v]);
  if (!rows.length) return '<div class="a-muted">还没有游戏记录（只有 App 端会统计）</div>';
  const max = Math.max(1, ...rows.map(([, v]) => v.seconds));
  return rows.map(([name, v]) => {
    const label = v.seconds < 60 ? v.seconds + ' 秒' : Math.round(v.seconds / 60) + ' 分钟';
    return `
      <div class="a-rank-row">
        <span class="a-rank-name">${esc(name)}</span>
        <span class="a-rank-track"><i style="width:${Math.max(3, Math.round((v.seconds / max) * 100))}%"></i></span>
        <span class="a-rank-val">${esc(label)}</span>
      </div>
      <div class="a-muted" style="font-size:11px;margin:-4px 0 4px 106px">${v.plays} 次游玩</div>`;
  }).join('');
}
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

  const byGame = new Map();
  let todayDevices = new Set();
  let weekDevices = new Set();

  for (const e of events) {
    const dev = e.device_id || 'unknown';
    const rec = devices.get(dev) || { id: dev, count: 0, first: e.created_at, last: e.created_at, platform: e.platform || '-', version: e.app_version || '-', lastEvent: e.event, label: '', screen: '', city: '' };
    rec.count++;
    if (e.created_at < rec.first) rec.first = e.created_at;
    if (e.created_at > rec.last) { rec.last = e.created_at; rec.lastEvent = e.event; rec.platform = e.platform || rec.platform; rec.version = e.app_version || rec.version; }
    if (e.event === 'device_location' && e.props && e.props.city) rec.city = e.props.city;
    if (e.device_label) rec.label = e.device_label;
    if (e.screen) rec.screen = e.screen;
    devices.set(dev, rec);

    byEvent.set(e.event, (byEvent.get(e.event) || 0) + 1);
    if (e.event === 'game_play') {
      const g = (e.props && e.props.game) || 'other';
      const cur = byGame.get(g) || { seconds: 0, plays: 0 };
      cur.seconds += Number((e.props && e.props.seconds) || 0);
      cur.plays += 1;
      byGame.set(g, cur);
    }
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
    byGame,
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
    main.innerHTML = `<div class="a-empty">还没有使用数据。让同事打开应用并操作几次，几秒后这里就会出现。</div>
      ${releaseCardHtml()}`;
    wireRelease();
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
        <span class="a-tag">${esc(eventName(e.event))}</span>
        <span class="a-tl-props">${esc(propsText(e.props))}</span>
      </div>`).join('');
    return `
    <tr class="a-dev-row" data-dev="${esc(d.id)}" title="点击查看这台设备都做了什么">
      <td>
        <div class="a-dev-label">${esc(d.label || '未知机型')}</div>
        <div class="a-dev-sub mono">${esc(shortId(d.id))}${d.screen ? ' · ' + esc(d.screen) : ''}${d.city ? ' · ' + esc(d.city) : ''}</div>
      </td>
      <td>${esc(platformName(d.platform))}</td>
      <td>${esc(d.version)}</td>
      <td>${d.count}</td>
      <td class="a-muted">${fmtTime(d.first)}</td>
      <td>${fmtTime(d.last)}</td>
      <td><span class="a-tag">${esc(eventName(d.lastEvent))}</span></td>
    </tr>
    <tr class="a-dev-detail" hidden><td colspan="7">
      <div class="a-tl-title">最近 ${mine.length} 条操作</div>
      <div class="a-tl">${timeline || '<span class="a-muted">暂无记录</span>'}</div>
    </td></tr>`;
  }).join('');

  const latest = (state.releases && state.releases[0]) || null;
  const nextCode = latest ? Number(latest.version_code) + 1 : 1;
  const nextName = latest ? bumpVersionName(latest.version_name) : '';

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
        <div class="a-rank">${rank(a.byEvent.map(([k, v]) => [eventName(k), v]), a.total)}</div>
      </div>
    </div>

    <div class="a-grid">
      <div class="a-card">
        <h3>版本分布</h3>
        <div class="a-rank">${rank(a.byVersion, a.total)}</div>
      </div>
      <div class="a-card">
        <h3>平台分布</h3>
        <div class="a-rank">${rank(a.byPlatform.map(([k, v]) => [platformName(k), v]), a.total)}</div>
      </div>
    </div>

    <div class="a-card">
      <h3>游戏时长<span>仅 App 端 · 累计游玩时间</span></h3>
      <div class="a-rank">${gameRank(a.byGame)}</div>
    </div>

    <div class="a-card">
      <h3>设备明细<span>点一行展开该设备的操作记录 · 最新 ${a.devices.length} 台</span></h3>
      <div class="a-scroll">
        <table class="a-table">
          <thead><tr><th>设备</th><th>平台</th><th>版本</th><th>事件数</th><th>首次</th><th>最近</th><th>最近事件</th></tr></thead>
          <tbody>${devRows}</tbody>
        </table>
      </div>
    </div>

    ${releaseCardHtml()}`;

  main.querySelectorAll('.a-dev-row').forEach((row) => {
    row.addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('a-dev-detail')) next.hidden = !next.hidden;
    });
  });

  wireRelease();
}

/** 发布新版本卡片（即使还没有统计数据也显示） */
function releaseCardHtml() {
  const latest = (state.releases && state.releases[0]) || null;
  const nextCode = latest ? Number(latest.version_code) + 1 : 1;
  const nextName = latest ? bumpVersionName(latest.version_name) : '';
  const rows = (state.releases || []).map((r) => `
    <div class="a-rel-item">
      <span class="a-tag">v${esc(r.version_name)}</span>
      <span class="a-muted">#${r.version_code}</span>
      <span class="a-muted">${r.size ? (r.size / 1024 / 1024).toFixed(1) + ' MB' : ''}</span>
      <span class="a-muted">${fmtTime(r.created_at)}</span>
      <a href="${esc(r.url)}" target="_blank" rel="noopener">下载</a>
      <button class="a-rel-del" data-del="${r.id}" title="删除这条记录">✕</button>
    </div>`).join('') || '<div class="a-muted">还没有发布记录</div>';
  return `
    <div class="a-card" id="releaseCard">
      <h3>发布新版本<span>选择 APK 上传，已安装的 App 打开时会收到更新提示</span></h3>
      <div class="a-rel">
        <input type="file" id="relFile" accept=".apk,application/vnd.android.package-archive" />
        <div class="a-muted" id="relApkInfo" style="font-size:12px"></div>
        <label class="a-muted" style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="relForce" /> 允许版本名与 APK 不一致（仅测试）</label>
        <div class="a-rel-row">
          <label>versionCode <input id="relCode" type="number" min="1" value="${nextCode}" /></label>
          <label>版本名 <input id="relName" type="text" value="${nextName}" /></label>
        </div>
        <textarea id="relNotes" rows="3" placeholder="更新内容，一行一条"></textarea>
        <div class="a-rel-actions">
          <button class="primary" id="relGo">上传并发布</button>
          <span id="relMsg" class="a-muted"></span>
        </div>
        <div class="update-bar" id="relBar" hidden><i style="width:0%"></i></div>
      </div>
      <div class="a-rel-list">${rows}</div>
    </div>`;
}

function wireRelease() {
  const relGo = main.querySelector('#relGo');
  if (relGo) relGo.addEventListener('click', () => publishFromForm());
  const fileEl = main.querySelector('#relFile');
  if (fileEl) {
    fileEl.addEventListener('change', async () => {
      const info = main.querySelector('#relApkInfo');
      const f = fileEl.files && fileEl.files[0];
      fileEl.dataset.apkVersion = '';
      if (!f) { if (info) info.textContent = ''; return; }
      if (info) { info.textContent = '正在读取 APK 版本…'; info.style.color = ''; }
      const v = await apkInternalVersion(f);
      fileEl.dataset.apkVersion = v || '';
      if (info) {
        if (v) {
          info.textContent = '检测到 APK 内部版本：' + v + '（' + (f.size / 1024 / 1024).toFixed(2) + ' MB）';
          info.style.color = '';
        } else {
          info.textContent = '无法识别版本，可能不是本项目打出的安装包';
          info.style.color = 'var(--danger)';
        }
      }
    });
  }
  main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('删除这条发布记录？（已上传的 APK 文件不会删）')) return;
    try {
      await deleteRelease(b.dataset.del);
      state.releases = await fetchReleases();
      renderDashboard();
    } catch (e) {
      alert(e.message);
    }
  }));
  hydrateVersionDefaults();
}

/* 没有发布记录时，用线上 version.json 推算下一个 versionCode */
async function hydrateVersionDefaults() {
  if (state.releases && state.releases.length) return;
  try {
    const url = new URL('app/version.json', location.href).href;
    const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    const codeEl = main.querySelector('#relCode');
    const nameEl = main.querySelector('#relName');
    if (codeEl && codeEl.value === '1' && Number(info.versionCode) > 0) {
      codeEl.value = String(Number(info.versionCode) + 1);
    }
    if (nameEl && !nameEl.value && info.versionName) {
      nameEl.value = bumpVersionName(info.versionName);
    }
  } catch (e) { /* ignore */ }
}

async function publishFromForm() {
  const fileEl = main.querySelector('#relFile');
  const codeEl = main.querySelector('#relCode');
  const nameEl = main.querySelector('#relName');
  const notesEl = main.querySelector('#relNotes');
  const msg = main.querySelector('#relMsg');
  const bar = main.querySelector('#relBar');
  const btn = main.querySelector('#relGo');

  const file = fileEl && fileEl.files && fileEl.files[0];
  const code = Number(codeEl && codeEl.value);
  const name = String((nameEl && nameEl.value) || '').trim();
  if (!file) { msg.textContent = '请先选择 APK 文件'; return; }
  if (!code || code < 1) { msg.textContent = 'versionCode 必须是正整数'; return; }
  if (!name) { msg.textContent = '请填写版本名'; return; }
  const dup = (state.releases || []).find((r) => Number(r.version_code) === code);
  if (dup) { msg.textContent = `versionCode #${code} 已存在（v${dup.version_name}），请先删除那条记录或改用更大的编号`; return; }
  const apkVer = fileEl.dataset.apkVersion || '';
  if (!apkVer) { msg.textContent = '无法识别这个 APK 的内部版本，请确认选的是「票据管家-vX.apk」'; return; }
  const forceEl = main.querySelector('#relForce');
  const force = !!(forceEl && forceEl.checked);
  if (!force && apkVer !== name) { msg.textContent = `APK 内部版本是 ${apkVer}，和填写的 ${name} 不一致，请检查文件`; return; }

  state.uploading = true;
  btn.disabled = true;
  btn.textContent = '上传中…';
  if (bar) bar.hidden = false;
  msg.textContent = '';

  try {
    // 文件名带版本名 + versionCode：每次发布都是新路径，避免 CDN 返回旧文件
    const apkName = `piaoju-${name}-${code}.apk`;
    await uploadApk(file, apkName, (p) => {
      if (bar) bar.querySelector('i').style.width = `${Math.round(p * 100)}%`;
      msg.textContent = `上传中 ${Math.round(p * 100)}%`;
    });
    const url = `${cfg.supabaseUrl}/storage/v1/object/public/app/${encodeURIComponent(apkName)}?v=${code}`;
    await createRelease({
      code,
      name,
      url,
      size: file.size,
      notes: String((notesEl && notesEl.value) || '').trim(),
    });
    msg.textContent = '发布成功，App 打开后即可收到更新提示';
    btn.textContent = '已发布';
    state.releases = await fetchReleases();
    setTimeout(() => { state.uploading = false; renderDashboard(); }, 1200);
  } catch (e) {
    msg.textContent = e.message;
    btn.disabled = false;
    btn.textContent = '重新上传';
    state.uploading = false;
  }
}

async function refresh() {
  if (state.loading || state.uploading) return;
  state.loading = true;
  try {
    const [events, releases] = await Promise.all([fetchEvents(), fetchReleases()]);
    state.events = events;
    state.releases = releases;
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
  const ver = window.__BUILD || (window.APP_CONFIG || {}).version || '';
  const verEl = document.getElementById('aVer');
  if (verEl) verEl.textContent = ver ? 'v' + ver : '';
  const buildEl = document.getElementById('aBuild');
  if (buildEl) buildEl.textContent = ver ? 'build ' + ver : '';
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    main.innerHTML = `<div class="a-empty">
      还没有配置 Supabase。<br/><br/>
      打开 <code>js/config.js</code>，填入项目的 URL 和 anon key，重新上传后刷新本页。
    </div>`;
    return;
  }
  if (!token()) { renderLogin(); return; }
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible' && !state.uploading) refresh(); }, 60000);
}

boot();
