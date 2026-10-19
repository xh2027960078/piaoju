/* 全部：要闻 / 娱乐 / 工具 */
import { state } from '../store.js';
import { rerender } from '../render.js';

const ENTRIES = [
  { id: 'news', name: '要闻', desc: '天气 · 热榜 · 小贴士', emoji: '📰', color: '#2f6bff' },
  { id: 'games', name: '娱乐', desc: '扫雷 · 2048 · 贪吃蛇 · 俄罗斯方块', emoji: '🎮', color: '#f0453a', native: true },
  { id: 'tools', name: '工具', desc: '格式转换 · 文档扫描 · 拼图 · 转盘', emoji: '🧰', color: '#16a37b' },
];

export function renderAll(root) {
  root.innerHTML = `
    <div class="all-grid">
      ${ENTRIES.map((e) => `
        <button class="all-card" data-page="${e.id}" ${e.native ? 'data-native' : ''}>
          <span class="all-emoji" style="background:${e.color}1a;color:${e.color}">${e.emoji}</span>
          <span class="all-text">
            <b>${e.name}</b>
            <em>${e.desc}</em>
          </span>
          <svg class="all-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>`).join('')}
    </div>
    <p class="hint" style="text-align:center;margin-top:18px">更多功能会陆续放到这里</p>`;

  root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
    state.page = b.dataset.page;
    rerender();
  }));
}
