/* 要闻：天气 + 微博热搜（在线拉取，离线显示上次缓存） */
import { toast } from '../ui.js';
import { rerender } from '../render.js';

const CACHE_KEY = 'pj-news-cache-v1';
const LOC_KEY = 'pj-news-loc';

const WEATHER_TEXT = {
  0: ['晴', '☀️'], 1: ['晴间多云', '🌤'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫'], 48: ['雾凇', '🌫'],
  51: ['小毛毛雨', '🌦'], 53: ['毛毛雨', '🌦'], 55: ['大毛毛雨', '🌦'],
  61: ['小雨', '🌧'], 63: ['中雨', '🌧'], 65: ['大雨', '🌧'],
  66: ['冻雨', '🌧'], 67: ['冻雨', '🌧'],
  71: ['小雪', '🌨'], 73: ['中雪', '🌨'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨'],
  80: ['阵雨', '🌦'], 81: ['强阵雨', '🌧'], 82: ['暴雨', '⛈'],
  85: ['阵雪', '🌨'], 86: ['强阵雪', '❄️'],
  95: ['雷阵雨', '⛈'], 96: ['雷雨冰雹', '⛈'], 99: ['强雷雨冰雹', '⛈'],
};

const HOT_SOURCES = [
  'https://api.vvhan.com/api/hotlist/wbHot',
  'https://api.vvhan.com/api/hotlist?type=wbHot',
];

let tried = false;

let state = {
  weather: null,
  hot: [],
  updatedAt: 0,
  loading: false,
  errWeather: '',
  errHot: '',
};

/* ---------------- 缓存 ---------------- */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object') return null;
    return c;
  } catch (e) { return null; }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      weather: state.weather, hot: state.hot, updatedAt: Date.now(),
    }));
  } catch (e) { /* ignore */ }
}

/* ---------------- 定位 ---------------- */
function cachedLoc() {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveLoc(loc) {
  try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch (e) { /* ignore */ }
}

function byGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, city: '' }); },
      () => { clearTimeout(timer); resolve(null); },
      { timeout: 6000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function byIp() {
  try {
    const res = await fetch('https://ipwho.is/', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (j && j.success !== false && j.latitude) {
      return { lat: j.latitude, lon: j.longitude, city: j.city || j.region || '' };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function resolveLocation() {
  const c = cachedLoc();
  if (c && c.lat) return c;
  const geo = await byGeo();
  if (geo) { saveLoc(geo); return geo; }
  const ip = await byIp();
  if (ip) { saveLoc(ip); return ip; }
  return { lat: 23.13, lon: 113.26, city: '广州' };
}

/* ---------------- 天气 ---------------- */
async function loadWeather() {
  const loc = await resolveLocation();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('天气服务 HTTP ' + res.status);
  const j = await res.json();
  const cur = j.current || {};
  const daily = j.daily || {};
  const days = (daily.time || []).map((d, i) => ({
    date: d,
    code: daily.weather_code ? daily.weather_code[i] : 0,
    max: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
    min: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
  }));
  return {
    city: loc.city || '',
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m,
    code: cur.weather_code,
    days,
  };
}

/* ---------------- 微博热搜 ---------------- */
function pickList(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.data)) return j.data;
  if (j && j.data && Array.isArray(j.data.data)) return j.data.data;
  if (j && Array.isArray(j.result)) return j.result;
  return [];
}

async function loadHot() {
  let lastErr = '';
  for (const url of HOT_SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const j = await res.json();
      const list = pickList(j).map((it) => ({
        title: it.title || it.name || it.hot_word || it.word || '',
        hot: Number(it.hot || it.hotNum || it.num || it.hotnum || 0) || 0,
        url: it.url || it.link || '',
      })).filter((x) => x.title).slice(0, 10);
      if (list.length) return list;
      lastErr = '接口返回空列表';
    } catch (e) {
      lastErr = e.message || '请求失败';
    }
  }
  throw new Error(lastErr || '热搜加载失败');
}

/* ---------------- 渲染 ---------------- */
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function weatherCard() {
  const w = state.weather;
  if (!w) {
    return `
      <div class="news-card">
        <div class="news-card-head"><b>天气</b><span class="news-sub">${state.errWeather ? '加载失败' : '加载中…'}</span></div>
        ${state.errWeather
          ? `<div class="news-empty">${state.errWeather}<br/><button class="btn small ghost" data-refresh="weather">重试</button></div>`
          : '<div class="news-skeleton" style="height:96px"></div>'}
      </div>`;
  }
  const [text, emoji] = WEATHER_TEXT[w.code] || ['未知', '🌡'];
  const days = (w.days || []).slice(0, 3).map((d, i) => {
    const [, e] = WEATHER_TEXT[d.code] || ['', ''];
    const label = i === 0 ? '今天' : i === 1 ? '明天' : '后天';
    return `<div class="wx-day">
      <span class="wx-day-name">${label}</span>
      <span class="wx-day-emoji">${e}</span>
      <span class="wx-day-temp">${Math.round(d.min)}° ~ ${Math.round(d.max)}°</span>
    </div>`;
  }).join('');

  return `
    <div class="news-card wx-card">
      <div class="news-card-head"><b>天气</b><span class="news-sub">${w.city || ''}</span></div>
      <div class="wx-now">
        <span class="wx-emoji">${emoji}</span>
        <span class="wx-temp">${Math.round(w.temp)}<i>°C</i></span>
        <span class="wx-desc">
          <b>${text}</b>
          <em>体感 ${Math.round(w.feels)}° · 湿度 ${w.humidity}% · 风 ${Math.round(w.wind)} km/h</em>
        </span>
      </div>
      <div class="wx-days">${days}</div>
      <div class="news-foot">更新于 ${fmtTime(state.updatedAt)} · <button class="link-btn" data-refresh="all">刷新</button></div>
    </div>`;
}

function hotCard() {
  const list = state.hot || [];
  return `
    <div class="news-card">
      <div class="news-card-head">
        <b>微博热搜</b>
        <span class="news-sub">${list.length ? 'TOP ' + list.length : (state.errHot ? '加载失败' : '加载中…')}</span>
      </div>
      ${list.length
        ? `<div class="hot-list">${list.map((it, i) => `
            <button class="hot-item" data-hot="${i}">
              <span class="hot-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
              <span class="hot-title">${esc(it.title)}</span>
              ${it.hot ? `<span class="hot-num">${fmtHot(it.hot)}</span>` : ''}
            </button>`).join('')}</div>`
        : (state.errHot
          ? `<div class="news-empty">${esc(state.errHot)}<br/><button class="btn small ghost" data-refresh="hot">重试</button></div>`
          : '<div class="news-skeleton" style="height:220px"></div>')}
      ${list.length ? `<div class="news-foot">更新于 ${fmtTime(state.updatedAt)} · 数据来自第三方聚合接口</div>` : ''}
    </div>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtHot(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

export function renderNews(root) {
  if (!state.weather && !state.hot) {
    const c = readCache();
    if (c) {
      state.weather = c.weather || null;
      state.hot = c.hot || [];
      state.updatedAt = c.updatedAt || 0;
    }
  }

  root.innerHTML = `
    <div class="news-wrap">
      ${weatherCard()}
      ${hotCard()}
      <p class="hint" style="text-align:center;margin:12px 4px 0">天气与热搜需要联网；断网时显示上次缓存的结果。</p>
    </div>`;

  root.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', () => {
    const what = b.dataset.refresh;
    refresh(what === 'all' ? ['weather', 'hot'] : [what]);
  }));

  root.querySelectorAll('[data-hot]').forEach((b) => b.addEventListener('click', () => {
    const it = state.hot[Number(b.dataset.hot)];
    if (!it) return;
    if (it.url) window.open(it.url, '_blank', 'noopener');
    else toast(it.title, '');
  }));

  if (!tried || (!state.weather && !state.hot.length && state.errWeather && state.errHot)) {
    if (!tried) { tried = true; refresh(['weather', 'hot']); }
  }
}

async function refresh(which = ['weather', 'hot']) {
  if (state.loading) return;
  state.loading = true;
  try {
    const jobs = [];
    if (which.includes('weather')) {
      jobs.push(loadWeather().then((w) => { state.weather = w; state.errWeather = ''; })
        .catch((e) => { state.errWeather = '天气加载失败：' + e.message; }));
    }
    if (which.includes('hot')) {
      jobs.push(loadHot().then((h) => { state.hot = h; state.errHot = ''; })
        .catch((e) => { state.errHot = '热搜加载失败：' + e.message; }));
    }
    await Promise.all(jobs);
    state.updatedAt = Date.now();
    writeCache();
  } finally {
    state.loading = false;
    rerender();
  }
}
