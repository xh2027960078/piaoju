/* 全部：要闻 / 娱乐 / 工具（要闻与工具为折叠式，点开展开内容） */
import { state } from '../store.js';
import { rerender } from '../render.js';
import { renderNews } from './newsview.js';
import { renderTools } from './toolsview.js';
import { renderGames, resetGames } from './gamesview.js';

const ENTRIES = [
  { id: 'news', name: '要闻', desc: '天气 · 热榜 · 小贴士', emoji: '📰', color: '#2f6bff', fold: true },
  { id: 'games', name: '娱乐', desc: '扫雷 · 2048 · 贪吃蛇 · 俄罗斯方块', emoji: '🎮', color: '#f0453a', native: true, fold: true },
  { id: 'tools', name: '工具', desc: '格式转换 · 文档扫描 · 拼图 · 转盘', emoji: '🧰', color: '#16a37b', fold: true },
];

export function renderAll(root) {
  const open = state.open || '';

  root.innerHTML = `
    <div class="all-grid">
      ${ENTRIES.map((e) => `
        <div class="all-block">
          <button class="all-card" data-page="${e.id}" data-fold="${e.fold ? '1' : ''}" ${e.native ? 'data-native' : ''}>
            <span class="all-emoji" style="background:${e.color}1a;color:${e.color}">${e.emoji}</span>
            <span class="all-text">
              <b>${e.name}</b>
              <em>${e.desc}</em>
            </span>
            ${e.fold
              ? `<svg class="all-caret ${open === e.id ? 'is-open' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`
              : '<svg class="all-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'}
          </button>
          ${e.fold && open === e.id ? `<div class="all-panel" data-panel="${e.id}"></div>` : ''}
        </div>`).join('')}
    </div>
    <p class="hint" style="text-align:center;margin-top:18px">点「要闻 / 工具」可直接展开</p>`;

  root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.page;
    if (!b.dataset.fold) {
      state.page = id;
      rerender();
      return;
    }
    state.open = state.open === id ? '' : id;
    if (id !== 'tools') state.tool = '';
    if (id !== 'games') resetGames();
    if (state.open !== 'games') resetGames();
    rerender();
  }));

  const panel = root.querySelector('[data-panel]');
  if (panel) {
    if (open === 'news') renderNews(panel);
    else if (open === 'tools') renderTools(panel);
    else if (open === 'games') {
      if (window.Android) renderGames(panel);
      else { state.open = ''; panel.remove(); }
    }
  }
}
