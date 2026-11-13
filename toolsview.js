/* 工具中心：格式转换 / 文档扫描 / 拼图 / 做个决定 */
import { state } from '../store.js';
import { rerender } from '../render.js';
import { renderFmt } from './tools/fmt.js';
import { renderScan } from './tools/scan.js';
import { renderCollage } from './tools/collage.js';
import { renderWheel } from './tools/wheel.js';

const TOOLS = [
  { id: 'fmt', name: '格式转换', desc: 'JPG / PNG / WEBP 互转，可调质量', emoji: '🔄' },
  { id: 'scan', name: '文档扫描', desc: '拍照自动增强，多页合成 PDF', emoji: '📄' },
  { id: 'collage', name: '拼图工具', desc: '多张图片上下拼成长图', emoji: '🧩' },
  { id: 'wheel', name: '做个决定', desc: '输入选项，转盘随机决定', emoji: '🎯' },
];

export function renderTools(root) {
  const current = state.tool || '';
  if (current) {
    const back = () => { state.tool = ''; rerender(); };
    const fn = { fmt: renderFmt, scan: renderScan, collage: renderCollage, wheel: renderWheel }[current];
    if (fn) { fn(root, back); return; }
  }

  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-grid">
        ${TOOLS.map((t) => `
          <button class="tool-card-btn" data-tool="${t.id}">
            <span class="tool-emoji">${t.emoji}</span>
            <b>${t.name}</b>
            <em>${t.desc}</em>
          </button>`).join('')}
      </div>
      <p class="hint" style="text-align:center;margin-top:16px">全部在本地处理，图片不会上传。</p>
    </div>`;

  root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    state.tool = b.dataset.tool;
    rerender();
  }));
}
