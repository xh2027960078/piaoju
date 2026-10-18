/* 应用内更新：读取 version.json，比版本号，下载 APK 并拉起系统安装器。
   仅 APK 生效；网页版刷新页面即可拿到新版本。 */
import { sheet, toast } from './ui.js';
import { esc } from './ui.js';

const CHECK_KEY = 'pj-last-update-check';
// 兜底：即使配置文件是旧版（没有 releaseApi），也知道去后台问
const DEFAULT_RELEASE_API = 'https://pihrlxposrvbifachezg.supabase.co/rest/v1/releases?select=*&order=version_code.desc&limit=1';

export function currentVersion() {
  try {
    if (window.Android && window.Android.versionInfo) {
      const parts = String(window.Android.versionInfo()).split('|');
      return { name: parts[0] || '', code: Number(parts[1]) || 0 };
    }
  } catch (e) { /* ignore */ }
  return { name: window.__BUILD || (window.APP_CONFIG || {}).version || '', code: 0 };
}

function resolveUrl(base, rel) {
  try { return new URL(rel, base).href; } catch (e) { return rel; }
}

/** 统一 version.json / releases 表两种格式 */
function normalize(row, base) {
  if (!row) return null;
  const code = Number(row.version_code != null ? row.version_code : row.versionCode);
  if (!code) return null;
  return {
    versionCode: code,
    versionName: row.version_name || row.versionName || '',
    url: row.url ? resolveUrl(base, row.url) : '',
    size: Number(row.size) || 0,
    notes: row.notes || '',
  };
}

async function loadSource(url) {
  const cfg = window.APP_CONFIG || {};
  const sep = url.includes('?') ? '&' : '?';
  const isSb = /supabase\.co/i.test(url);
  // Supabase 的 PostgREST 会把多余参数当成列筛选（400），所以不加时间戳
  const full = isSb ? url : `${url}${sep}t=${Date.now()}`;
  const headers = {};
  if (isSb && cfg.supabaseAnonKey) {
    headers.apikey = cfg.supabaseAnonKey;
    if (/^eyJ/.test(cfg.supabaseAnonKey)) headers.Authorization = `Bearer ${cfg.supabaseAnonKey}`;
    headers['Cache-Control'] = 'no-cache';
  }
  let res;
  try {
    res = await fetch(full, { cache: 'no-store', headers });
  } catch (e) {
    // 部分 WebView 对 cache 选项敏感，退回普通请求
    res = await fetch(full, { headers });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : [data];
  const first = rows[0];
  if (!first) return null;
  if (first.redirect) return loadSource(resolveUrl(url, first.redirect));
  return normalize(first, url);
}

/** 后台发布（releases 表）优先，其次 GitHub 上的 version.json */
export async function checkForUpdate(opts = {}) {
  const cfg = window.APP_CONFIG || {};
  const sources = [cfg.releaseApi || DEFAULT_RELEASE_API, cfg.updateUrl].filter(Boolean);
  if (!sources.length) {
    if (!opts.silent) toast('当前版本未配置更新地址', 'err');
    return;
  }
  if (!window.Android) {
    if (!opts.silent) toast('网页版刷新页面即为最新版本');
    return;
  }
  try {
    const found = [];
    const attempts = [];
    for (const u of sources) {
      try {
        const r = await loadSource(u);
        attempts.push({ url: u, ok: !!r, code: r ? r.versionCode : 0, name: r ? r.versionName : '', err: r ? '' : '返回空结果' });
        if (r) found.push(r);
      } catch (e) {
        attempts.push({ url: u, ok: false, err: (e && e.message) || 'fail' });
      }
    }
    if (!found.length) {
      if (!opts.silent) showDiag(attempts, null);
      throw new Error('读取版本信息失败');
    }
    const info = found.reduce((a, b) => (b.versionCode > a.versionCode ? b : a));
    const cur = currentVersion();
    if (info.versionCode <= cur.code) {
      if (!opts.silent) showDiag(attempts, { info, cur });
      return;
    }
    if (!info.url) throw new Error('版本信息缺少下载地址');
    showUpdate(info, cur);
  } catch (e) {
    if (!opts.silent) toast(`检查更新失败：${e.message}`, 'err');
  }
}


/** 诊断面板：显示当前版本与每个更新源的真实结果 */
function showDiag(attempts, result) {
  const cur = currentVersion();
  const rows = attempts.map((a) => {
    const host = (() => { try { return new URL(a.url).host; } catch (e) { return a.url; } })();
    const detail = a.ok ? `读到 v${a.name}（#${a.code}）` : `失败：${a.err || '无返回'}`;
    return `<div class="kv"><span class="k">${esc(host)}</span><span class="v" style="text-align:right;font-size:12px">${esc(detail)}</span></div>`;
  }).join('');
  const tail = result
    ? `<div class="kv"><span class="k">服务端最新</span><span class="v" style="text-align:right">v${esc(result.info.versionName)}（#${result.info.versionCode}）</span></div>`
      + `<div class="kv"><span class="k">本机版本</span><span class="v" style="text-align:right">v${esc(result.cur.name)}（#${result.cur.code}）</span></div>`
      + `<p class="hint" style="margin-top:8px">两者相同，所以判定为最新版。</p>`
    : `<p class="hint" style="margin-top:8px">所有更新源都读取失败，无法判断是否有新版。</p>`;
  sheet({
    title: '检查更新',
    body: `<div class="kv"><span class="k">本机</span><span class="v" style="text-align:right">v${esc(cur.name)}${cur.code ? '（#' + cur.code + '）' : ''}</span></div>${rows}${tail}`,
    foot: '<button class="btn primary" data-x="1">知道了</button>',
  });
}
/** 启动时每天自动检查一次（不打扰用户，只有发现新版才提示） */
export function maybeAutoCheck() {
  if (!window.Android) return;
  try {
    const last = Number(localStorage.getItem(CHECK_KEY) || 0);
    if (Date.now() - last < 24 * 3600 * 1000) return;
    localStorage.setItem(CHECK_KEY, String(Date.now()));
  } catch (e) { /* ignore */ }
  setTimeout(() => checkForUpdate({ silent: true }), 4000);
}

function showUpdate(info, cur) {
  const notes = String(info.notes || '').split('\n').filter(Boolean);
  const apkUrl = resolveUrl((window.APP_CONFIG || {}).updateUrl, info.url || '');

  sheet({
    title: '发现新版本',
    body: `
      <div class="kv"><span class="k">当前版本</span><span class="v">v${esc(cur.name)}</span></div>
      <div class="kv"><span class="k">新版本</span><span class="v" style="color:var(--accent);font-weight:700">v${esc(info.versionName || '')}</span></div>
      <div class="kv"><span class="k">大小</span><span class="v">${info.size ? (info.size / 1024 / 1024).toFixed(1) + ' MB' : '未知'}</span></div>
      ${notes.length ? `<div style="margin:12px 2px 6px;font-size:12px;color:var(--text-3);font-weight:600">更新内容</div>
        <ul style="margin:0 0 12px;padding-left:18px;font-size:13px;line-height:1.7;color:var(--text-2)">
          ${notes.map((n) => `<li>${esc(n)}</li>`).join('')}
        </ul>` : ''}
      <div id="upWrap" style="display:none;margin-top:6px">
        <div class="update-bar"><i id="upBar" style="width:0%"></i></div>
        <div id="upLabel" class="hint" style="margin-top:6px">准备下载…</div>
      </div>`,
    foot: `<button class="btn ghost" data-x="later">以后再说</button>
           <button class="btn primary" data-x="go">下载并安装</button>`,
    onMount(root, close) {
      const bar = root.querySelector('#upBar');
      const wrap = root.querySelector('#upWrap');
      const label = root.querySelector('#upLabel');
      const goBtn = root.querySelector('[data-x="go"]');
      const laterBtn = root.querySelector('[data-x="later"]');

      window.__onUpdateProgress = (p) => {
        if (wrap) wrap.style.display = 'block';
        if (bar) bar.style.width = `${p}%`;
        if (label) label.textContent = p >= 100 ? '下载完成，正在打开安装器…' : `正在下载 ${p}%`;
      };
      window.__onUpdateFail = (msg) => {
        if (label) label.textContent = `下载失败：${msg}`;
        if (goBtn) { goBtn.disabled = false; goBtn.textContent = '重试'; }
      };

      laterBtn.addEventListener('click', close);

      goBtn.addEventListener('click', () => {
        if (!apkUrl) { toast('更新地址无效', 'err'); return; }
        if (window.Android.canInstallPackages && !window.Android.canInstallPackages()) {
          toast('请允许「安装未知应用」，返回后再点一次', 'err');
          window.Android.openInstallPermission();
          return;
        }
        goBtn.disabled = true;
        goBtn.textContent = '下载中…';
        wrap.style.display = 'block';
        window.Android.downloadAndInstall(apkUrl);
      });
    },
    onClose() {
      window.__onUpdateProgress = null;
      window.__onUpdateFail = null;
    },
  });
}
