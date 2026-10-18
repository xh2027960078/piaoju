/* 可搜索选择器（费用项目 / 部门 / 项目中心等） */

import { sheet, icon, esc } from './ui.js';

function normalize(list) {
  return (list || []).map((it) => (typeof it === 'string' ? { name: it, code: '' } : it));
}

export function pickOption({ title = '请选择', options = [], value = '', allowEmpty = true, emptyLabel = '不填写', hint = '' }) {
  return new Promise((resolve) => {
    const list = normalize(options);
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    const body = `
      <div class="field" style="margin-bottom:10px">
        <input class="input" id="pickSearch" placeholder="输入关键字搜索" autocomplete="off" />
      </div>
      <div id="pickList" class="pick-list"></div>`;

    sheet({
      title,
      body,
      tall: list.length > 60,
      onMount(root, close) {
        const listEl = root.querySelector('#pickList');
        const searchEl = root.querySelector('#pickSearch');
        let filtered = list;

        const render = () => {
          const cur = value;
          const rows = [];
          if (allowEmpty) {
            rows.push(`<button class="pick-item ${!cur ? 'is-active' : ''}" data-val="">
              <span class="pick-name">${esc(emptyLabel)}</span>
              ${!cur ? icon('check') : ''}
            </button>`);
          }
          rows.push(...filtered.slice(0, 200).map((it) => `
            <button class="pick-item ${it.name === cur ? 'is-active' : ''}" data-val="${esc(it.name)}">
              <span class="pick-name">${esc(it.name)}</span>
              ${it.code ? `<span class="pick-code">${esc(it.code)}</span>` : ''}
              ${it.name === cur ? icon('check') : ''}
            </button>`));
          if (!filtered.length) rows.push('<p class="hint" style="text-align:center;padding:24px 0">没有匹配项</p>');
          if (filtered.length > 200) rows.push('<p class="hint" style="text-align:center">仅显示前 200 项，请继续输入关键字缩小范围</p>');
          listEl.innerHTML = rows.join('');
        };

        listEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-val]');
          if (!btn) return;
          finish(btn.dataset.val);
          close();
        });

        searchEl.addEventListener('input', () => {
          const q = searchEl.value.trim().toLowerCase();
          filtered = !q ? list : list.filter((it) =>
            it.name.toLowerCase().includes(q) || String(it.code || '').toLowerCase().includes(q));
          render();
        });

        root.querySelector('.sheet-head h2').insertAdjacentHTML('afterend',
          `<span class="badge gray" style="margin-right:6px">${list.length} 项</span>`);
        if (hint) listEl.insertAdjacentHTML('beforebegin', `<p class="hint" style="margin:0 2px 10px">${esc(hint)}</p>`);
        render();
        setTimeout(() => { if (list.length > 20) searchEl.focus(); }, 260);
      },
      onClose() { finish(null); },
    });
  });
}
