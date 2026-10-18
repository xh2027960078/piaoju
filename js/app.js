/* 应用入口：导航、顶栏、初始化 */

import { state, loadAll, loadSettings, refresh, subscribe, totals, missingRows } from './store.js';
import { renderPeriods, createPeriod } from './views/periods.js';
import { renderDetail } from './views/detail.js';
import { renderCharts } from './views/chartsview.js';
import { renderExport } from './views/exportview.js';
import { renderSettings } from './views/settingsview.js';
import { icon, esc, toast, closeSheet, actionSheet, money, sheet } from './ui.js';
import { repo } from './db.js';
import { setRerender } from './render.js';
import { requestPersist } from './platform.js';
import { applyAppearance } from './appearance.js';
import { isWeChat } from './env.js';
import { loadDefaultTemplate } from './assets.js';
import { track, initTelemetry } from './telemetry.js';
import { inspectTemplate } from './xlsx.js';
import { rowsForTemplate, buildZip, buildReimbursement } from './exporter.js';
import { periodMenu } from './views/periods.js';

const TABS = {
  periods: { title: '周期', sub: '' },
  charts: { title: '图表', sub: '报销花费一览' },
  export: { title: '导出', sub: '打包 ZIP / 生成报销单' },
  settings: { title: '设置', sub: '默认填写值与数据管理' },
};

const viewEl = document.getElementById('view');
const topbar = document.getElementById('topbar');
const pageTitle = document.getElementById('pageTitle');
const pageSub = document.getElementById('pageSub');
const topActions = document.getElementById('topActions');
const tabbar = document.getElementById('tabbar');
const backBtn = document.getElementById('backBtn');

function hasSheet() {
  const l = document.getElementById('layer');
  return !!l.querySelector('.sheet');
}

function renderTopbar() {
  const isDetail = state.screen === 'detail';
  topbar.classList.toggle('is-solid', isDetail);
  tabbar.style.display = isDetail ? 'none' : '';
  document.body.style.paddingBottom = '';

  if (isDetail) {
    const p = state.periods.find((x) => x.id === state.periodId);
    pageTitle.textContent = p ? p.name : '周期';
    pageSub.textContent = p ? `${p.start} ~ ${p.end}${p.to ? ' · ' + p.to : ''}` : '';
    backBtn.hidden = false;
    topActions.innerHTML = `<button class="icon-btn" data-a="more" aria-label="更多">${icon('more')}</button>`;
    topActions.querySelector('[data-a="more"]').addEventListener('click', () => periodMenu(state.periodId));
    return;
  }

  backBtn.hidden = true;

  const t = TABS[state.tab] || TABS.periods;
  pageTitle.textContent = t.title;
  let sub = t.sub;
  if (state.tab === 'periods') {
    const tot = totals();
    sub = state.periods.length
      ? `${tot.periods} 个周期 · ${tot.invoices} 张票据 · 合计 ¥${money(tot.amount, false)}`
      : '按出差周期整理票据，报销不再漏单';
  }
  pageSub.textContent = sub;
  topActions.innerHTML = '';
  topActions.style.flexDirection = '';
}

function syncBackFlag() {
  window.__canBack = state.screen === 'detail' || !!document.querySelector('#layer .sheet');
}

export function render() {
  renderTopbar();
  syncBackFlag();
  if (state.screen === 'detail') {
    // 清掉周期页残留的悬浮按钮，详情页自己会渲染一个
    document.querySelectorAll('.fab').forEach((el) => el.remove());
    renderDetail(viewEl);
    return;
  }
  switch (state.tab) {
    case 'charts': renderCharts(viewEl); break;
    case 'export': renderExport(viewEl); break;
    case 'settings': renderSettings(viewEl); break;
    default: renderPeriods(viewEl);
  }
  renderFab();
}

function renderFab() {
  const old = document.querySelector('.fab');
  if (old) old.remove();
  if (state.screen === 'detail' || state.tab !== 'periods') return;
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.setAttribute('aria-label', '新建周期');
  fab.innerHTML = icon('plus');
  fab.addEventListener('click', createPeriod);
  document.getElementById('app').appendChild(fab);
}

export function goBack() {
  if (state.screen === 'detail') {
    // 金额未填时不允许离开当前周期
    const miss = missingRows(state.periodId);
    const parts = [];
    if (miss.invoices.length) parts.push(`票据第 ${miss.invoices.map((x) => x.seq).join('、')} 行金额未填`);
    if (miss.attachments.length) parts.push(`附件第 ${miss.attachments.map((x) => x.seq).join('、')} 行金额未填`);
    if (parts.length) {
      toast(parts.join('；'), 'err');
      return false;
    }
    state.screen = 'tabs';
    state.periodId = null;
    state.selectMode = false;
    state.selection.clear();
    render();
    return true;
  }
  return false;
}

export function switchTab(tab) {
  state.tab = tab;
  state.screen = 'tabs';
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
  render();
}

/* 微信里首次使用的提示：数据在本机、导出需在浏览器打开 */
function maybeShowWeChatTip() {
  try { if (localStorage.getItem('wx-tip-v1')) return; } catch (e) { return; }
  setTimeout(() => {
    sheet({
      title: '在微信里使用',
      body: `<p class="hint" style="margin:2px 2px 12px">功能都能正常用，只有「保存文件」受微信限制：</p>
        <div class="kv"><span class="k">数据</span><span class="v" style="text-align:right">只存在这台手机</span></div>
        <div class="kv"><span class="k">注意</span><span class="v" style="text-align:right">清理微信缓存会删除数据，建议定期备份</span></div>
        <div class="kv"><span class="k">导出</span><span class="v" style="text-align:right">点右上角「…」→「在浏览器打开」再导出</span></div>
        <div class="kv"><span class="k">迁移</span><span class="v" style="text-align:right">与 App 版数据不互通，可用备份包迁移</span></div>`,
      foot: '<button class="btn primary" data-x="1">知道了</button>',
      onMount(root, close) {
        root.querySelector('[data-x="1"]').addEventListener('click', () => {
          try { localStorage.setItem('wx-tip-v1', '1'); } catch (e) { /* ignore */ }
          close();
        });
      },
    });
  }, 600);
}

async function init() {
  setRerender(render);
  window.__syncBack = syncBackFlag;
  backBtn.addEventListener('click', goBack);
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  history.replaceState({ root: 1 }, '');
  history.pushState({ guard: 1 }, '');
  window.addEventListener('popstate', () => {
    if (hasSheet()) {
      closeSheet();
      history.pushState({ guard: 1 }, '');
      return;
    }
    if (state.screen === 'detail') goBack();
    history.pushState({ guard: 1 }, '');
  });

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    document.getElementById('topbar').classList.toggle('is-solid', y > 6 || state.screen === 'detail');
  }, { passive: true });

  try {
    await requestPersist();
  } catch (e) { /* ignore */ }

  await loadSettings();
  applyAppearance(state.settings);
  await loadAll();

  // 首次启动：写入内置模板
  if (!state.template) {
    try {
      const buf = await loadDefaultTemplate();
      await repo.set('template', { name: '金蝶员工报销表单（内置）', importedAt: Date.now(), data: buf });
      state.template = { name: '金蝶员工报销表单（内置）', data: buf };
      state.templateInfo = { ...(await inspectTemplate(buf)), ok: true };
    } catch (e) {
      console.warn('内置模板加载失败', e);
      state.templateInfo = { ok: false, error: e.message };
    }
  }

  subscribe(() => render());
  render();
  if (isWeChat) maybeShowWeChatTip();
  initTelemetry();
  track('app_open');

  // 调试/自动化入口（不影响正常使用）
  window.__app = {
    state, repo, render, refresh,
    rowsForTemplate, buildZip, buildReimbursement,
  };


  // 原生壳里资源都在本地，不需要 Service Worker 缓存（也避免更新后读到旧脚本）
  if (!window.Android && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
