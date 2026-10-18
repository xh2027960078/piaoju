/* 要闻：天气 + 微博热搜（在线拉取，离线显示上次缓存） */
import { toast, sheet } from '../ui.js';
import { rerender } from '../render.js';
import { track } from '../telemetry.js';

const CACHE_KEY = 'pj-news-cache-v2';
const LOC_KEY = 'pj-news-loc';
const CITY_KEY = 'pj-news-city';
const REPORT_KEY = 'pj-news-reported';

const CITIES = [
  ['广州', 23.13, 113.26], ['深圳', 22.54, 114.06], ['北京', 39.90, 116.41],
  ['上海', 31.23, 121.47], ['杭州', 30.27, 120.16], ['南京', 32.06, 118.80],
  ['苏州', 31.30, 120.58], ['成都', 30.57, 104.07], ['重庆', 29.56, 106.55],
  ['武汉', 30.59, 114.31], ['西安', 34.34, 108.94], ['长沙', 28.23, 112.94],
  ['郑州', 34.75, 113.63], ['天津', 39.08, 117.20], ['青岛', 36.07, 120.38],
  ['东莞', 23.02, 113.75], ['佛山', 23.02, 113.12], ['厦门', 24.48, 118.09],
  ['福州', 26.07, 119.30], ['昆明', 25.04, 102.71], ['贵阳', 26.65, 106.63],
  ['南宁', 22.82, 108.37], ['合肥', 31.82, 117.23], ['济南', 36.65, 117.12],
  ['沈阳', 41.81, 123.43], ['哈尔滨', 45.80, 126.53], ['大连', 38.91, 121.61],
  ['南昌', 28.68, 115.86], ['太原', 37.87, 112.55], ['石家庄', 38.04, 114.51],
  ['兰州', 36.06, 103.83], ['乌鲁木齐', 43.82, 87.62], ['拉萨', 29.65, 91.14],
  ['海口', 20.04, 110.20], ['三亚', 18.25, 109.51], ['宁波', 29.87, 121.55],
  ['温州', 27.99, 120.70], ['无锡', 31.49, 120.31], ['常州', 31.81, 119.97],
  ['珠海', 22.27, 113.58], ['中山', 22.52, 113.39], ['惠州', 23.11, 114.42],
];

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
  locating: false,
};

/* ---------------- 缓存 ---------------- */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
function manualCity() {
  try {
    const raw = localStorage.getItem(CITY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setManualCity(city) {
  try {
    if (city) localStorage.setItem(CITY_KEY, JSON.stringify(city));
    else localStorage.removeItem(CITY_KEY);
  } catch (e) { /* ignore */ }
}

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
    const timer = setTimeout(() => resolve(null), 10000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, city: '', from: 'gps' });
      },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function byIp() {
  try {
    const res = await fetch('https://ipwho.is/', { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (j && j.success !== false && j.latitude) {
      return { lat: j.latitude, lon: j.longitude, city: j.city || j.region || '', from: 'ip' };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function resolveLocation(force) {
  const manual = manualCity();
  if (manual && !force) return { lat: manual.lat, lon: manual.lon, city: manual.name, from: 'manual' };
  if (force === 'gps') {
    const geo = await byGeo();
    if (geo) { saveLoc(geo); return geo; }
    return null;
  }
  if (force === 'ip') {
    const ip = await byIp();
    if (ip) { saveLoc(ip); return ip; }
    return null;
  }
  const c = cachedLoc();
  if (c && c.lat) return c;
  const geo = await byGeo();
  if (geo) { saveLoc(geo); return geo; }
  const ip = await byIp();
  if (ip) { saveLoc(ip); return ip; }
  return { lat: 23.13, lon: 113.26, city: '广州', from: 'default' };
}

/** 定位结果同步到后台（跟设备信息一起） */
function reportLocation(loc) {
  if (!loc) return;
  const key = `${loc.lat},${loc.lon}`;
  try {
    if (localStorage.getItem(REPORT_KEY) === key) return;
    localStorage.setItem(REPORT_KEY, key);
  } catch (e) { /* ignore */ }
  track('device_location', {
    city: String(loc.city || '').slice(0, 20),
    lat: Number(Number(loc.lat).toFixed(2)),
    lon: Number(Number(loc.lon).toFixed(2)),
    src: String(loc.from || ''),
  });
}

/* ---------------- 天气 ---------------- */
async function loadWeather(fixed) {
  const loc = fixed && fixed.lat ? fixed : await resolveLocation(fixed);
  if (!loc) throw new Error('定位失败，可手动选择城市');
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
  reportLocation(loc);
  return {
    city: loc.city || '',
    src: loc.from || '',
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
  if (j && j.data && Array.isArray(j.data.realtime)) return j.data.realtime;
  if (j && Array.isArray(j.result)) return j.result;
  return [];
}

function normalizeHot(list) {
  return list.map((it) => ({
    title: it.title || it.name || it.word || it.hot_word || it.note || '',
    hot: Number(it.hot || it.hotNum || it.num || it.hotnum || it.raw_hot || 0) || 0,
    url: it.url || it.link || (it.word ? 'https://s.weibo.com/weibo?q=' + encodeURIComponent(it.word) : ''),
  })).filter((x) => x.title).slice(0, 10);
}

function loadHotNative() {
  return new Promise((resolve, reject) => {
    if (!window.Android || !window.Android.fetchHotSearch) { reject(new Error('no-native')); return; }
    const id = 'h' + Date.now() + Math.random().toString(16).slice(2, 6);
    const timer = setTimeout(() => { window.__onHotSearch = null; reject(new Error('请求超时')); }, 15000);
    window.__onHotSearch = (cid, json) => {
      if (cid !== id) return;
      clearTimeout(timer);
      window.__onHotSearch = null;
      if (!json) { reject(new Error('接口无返回')); return; }
      try {
        const list = normalizeHot(pickList(JSON.parse(json)));
        if (!list.length) { reject(new Error('数据为空')); return; }
        resolve(list);
      } catch (e) { reject(new Error('数据解析失败')); }
    };
    window.Android.fetchHotSearch(id);
  });
}

async function loadHot() {
  try {
    return await loadHotNative();
  } catch (e) {
    if (e.message !== 'no-native') { /* 继续尝试网页接口 */ }
  }
  let lastErr = '';
  for (const url of HOT_SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const j = await res.json();
      const list = normalizeHot(pickList(j));
      if (list.length) return list;
      lastErr = '接口返回空列表';
    } catch (e) {
      lastErr = '网络不可用';
    }
  }
  throw new Error(lastErr || '热搜加载失败');
}

/* ---------------- 渲染 ---------------- */
/** 打开外部链接：App 内用原生浏览器，网页用 window.open */
function openLink(url) {
  if (!url) return;
  try {
    if (window.Android && window.Android.openExternal) {
      window.Android.openExternal(url);
      return;
    }
  } catch (e) { /* 继续用网页方式 */ }
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtHot(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function srcLabel(src) {
  return { gps: 'GPS 定位', ip: '网络定位', manual: '手动选择', default: '默认城市' }[src] || '';
}

function weatherCard() {
  const w = state.weather;
  if (!w) {
    return `
      <div class="news-card">
        <div class="news-card-head"><b>天气</b><span class="news-sub">${state.errWeather ? '加载失败' : (state.locating ? '正在定位…' : '加载中…')}</span></div>
        ${state.errWeather
          ? `<div class="news-empty">${esc(state.errWeather)}<div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
               <button class="btn small ghost" data-refresh="weather">重试</button>
               <button class="btn small soft" data-city="1">选择城市</button>
             </div></div>`
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
      <div class="news-card-head">
        <b>天气</b>
        <span class="news-sub">
          <button class="link-btn" data-city="1">${esc(w.city || '未知')} · ${srcLabel(w.src)} ▾</button>
        </span>
      </div>
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
          ? `<div class="news-empty">${esc(state.errHot)}<div style="margin-top:10px"><button class="btn small ghost" data-refresh="hot">重试</button></div></div>`
          : '<div class="news-skeleton" style="height:220px"></div>')}
      ${list.length ? `<div class="news-foot">更新于 ${fmtTime(state.updatedAt)} · 数据来自微博</div>` : ''}
    </div>`;
}

function openCityPicker() {
  const rows = CITIES.map(([name, lat, lon]) => `
    <button class="city-item" data-pick="${name}">${name}</button>`).join('');
  sheet({
    title: '选择城市',
    body: `
      <div class="city-actions">
        <button class="btn soft" data-gps="1">用当前位置（GPS）</button>
        <button class="btn ghost" data-ip="1">用网络定位</button>
      </div>
      <p class="hint" style="margin:12px 2px 8px">或手动选择：</p>
      <div class="city-grid">${rows}</div>`,
    foot: '<button class="btn ghost" data-x="1">关闭</button>',
    onMount(root, close) {
      root.querySelector('[data-gps]').addEventListener('click', async () => {
        setManualCity(null);
        close();
        state.locating = true;
        state.weather = null;
        state.errWeather = '';
        rerender();
        try {
          const loc = await resolveLocation('gps');
          if (!loc) { state.errWeather = '定位失败：请允许定位权限，或手动选城市'; toast('没拿到定位', 'err'); }
          else await refresh(['weather'], loc);
        } catch (e) {
          state.errWeather = '定位失败：' + e.message;
        } finally {
          state.locating = false;
          rerender();
        }
      });
      root.querySelector('[data-ip]').addEventListener('click', async () => {
        setManualCity(null);
        close();
        try {
          const loc = await resolveLocation('ip');
          if (!loc) throw new Error('网络定位失败');
          await refresh(['weather'], loc);
        } catch (e) {
          state.errWeather = '网络定位失败：' + e.message;
          rerender();
        }
      });
      root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        const name = b.dataset.pick;
        const c = CITIES.find((x) => x[0] === name);
        setManualCity({ name: c[0], lat: c[1], lon: c[2] });
        close();
        try {
          await refresh(['weather'], { lat: c[1], lon: c[2], city: c[0], from: 'manual' });
        } catch (e) { /* ignore */ }
      }));
    },
  });
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

  root.querySelectorAll('[data-city]').forEach((b) => b.addEventListener('click', openCityPicker));

  root.querySelectorAll('[data-hot]').forEach((b) => b.addEventListener('click', () => {
    const it = state.hot[Number(b.dataset.hot)];
    if (!it) return;
    if (it.url) openLink(it.url);
    else openLink('https://s.weibo.com/weibo?q=' + encodeURIComponent(it.title));
  }));

  if (!tried) {
    tried = true;
    refresh(['weather', 'hot']);
  }
}

async function refresh(which = ['weather', 'hot'], fixedLoc) {
  if (state.loading) return;
  state.loading = true;
  try {
    const jobs = [];
    if (which.includes('weather')) {
      jobs.push(loadWeather(fixedLoc || undefined)
        .then((w) => { state.weather = w; state.errWeather = ''; })
        .catch((e) => { state.errWeather = '天气加载失败：' + e.message; }));
    }
    if (which.includes('hot')) {
      jobs.push(loadHot()
        .then((h) => { state.hot = h; state.errHot = ''; })
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
