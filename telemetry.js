/* 匿名使用统计：只上报「发生了什么事件」，不含票据、金额、文件名等任何内容。
   未配置 Supabase 时自动关闭；用户也可在「设置」里关闭。 */

const QUEUE_KEY = 'pj-tq';
const DEVICE_KEY = 'pj-device';
const OPT_OUT_KEY = 'pj-telemetry';
const MAX_QUEUE = 200;
const FLUSH_DELAY = 8000;

function cfg() {
  return window.APP_CONFIG || {};
}

export function telemetryReady() {
  const c = cfg();
  return !!(c.supabaseUrl && c.supabaseAnonKey);
}

export function telemetryEnabled() {
  if (!telemetryReady()) return false;
  // 部署方可以选择隐藏开关（强制开启）；隐藏时忽略本地退出标记
  if (cfg().showPrivacyToggle === false) return true;
  try { return localStorage.getItem(OPT_OUT_KEY) !== '0'; } catch (e) { return true; }
}

export function telemetryHidden() {
  return (cfg().showPrivacyToggle === false);
}

export function setTelemetryEnabled(on) {
  try { localStorage.setItem(OPT_OUT_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}

/** 设备标识：机型 + 系统 + 微信版本 + 屏幕尺寸（都来自 UA，不申请任何权限） */
export function deviceInfo() {
  const ua = navigator.userAgent || '';
  let label = '';
  const android = ua.match(/Android\s+([\d.]+);\s*([^;)]+)/);
  if (android) label = `${android[2].trim()} · Android ${android[1]}`;
  else if (/iPad/i.test(ua)) label = 'iPad';
  else if (/iPhone|iPod/i.test(ua)) label = 'iPhone';
  else if (/Windows/i.test(ua)) label = 'Windows';
  else if (/Macintosh/i.test(ua)) label = 'Mac';
  else label = platform();
  const wx = ua.match(/MicroMessenger\/([\d.]+)/);
  if (wx) label += ` · 微信${wx[1]}`;
  let screenSize = '';
  try { screenSize = `${window.screen.width}x${window.screen.height}`; } catch (e) { screenSize = ''; }
  return { label, screen: screenSize };
}

function randId() {
  const b = new Uint8Array(12);
  (window.crypto || window.msCrypto).getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = randId(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch (e) {
    return 'anon';
  }
}

function platform() {
  if (window.Android) return 'app';
  const ua = navigator.userAgent || '';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'desktop';
}

function sanitize(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 40);
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

let queue = load();
let timer = null;

function save() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE))); } catch (e) { /* ignore */ }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_DELAY);
}

/** 记录一个事件（props 只允许数字/布尔/短字符串） */
export function track(event, props) {
  if (!telemetryEnabled()) return;
  const di = deviceInfo();
  queue.push({
    device_id: deviceId(),
    device_label: di.label,
    screen: di.screen,
    event: String(event).slice(0, 40),
    props: sanitize(props),
    app_version: String(cfg().version || '').slice(0, 20),
    platform: platform(),
    created_at: new Date().toISOString(),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  save();
  schedule();
}

/** 立即上报队列（失败会留在本地下次再试） */
export async function flush() {
  if (!telemetryEnabled() || !queue.length) return;
  const c = cfg();
  const batch = queue.slice(-50);
  try {
    const res = await fetch(`${c.supabaseUrl}/rest/v1/events`, {
      method: 'POST',
      headers: {
        apikey: c.supabaseAnonKey,
        // 旧版 anon key 是 JWT，需要同时放 Authorization；新版 sb_publishable_ 只认 apikey
        ...(/^eyJ/.test(c.supabaseAnonKey) ? { Authorization: `Bearer ${c.supabaseAnonKey}` } : {}),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (res && res.ok) {
      queue = queue.slice(batch.length);
      save();
    }
  } catch (e) {
    /* 离线时保留，下次再试 */
  }
}

export function initTelemetry() {
  if (!telemetryReady()) return;
  const onHide = () => flush();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', onHide);
  setTimeout(() => flush(), 3000);
}
