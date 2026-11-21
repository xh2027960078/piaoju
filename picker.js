/* 可搜索选择器（费用项目 / 部门 / 项目中心等）
 * 支持「手动输入」：列表里没有的项（例如新项目还没同步进 options.js）也能直接用 */

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
        <input class="input" id="pickSearch" placeholder="输入关键字搜索，列表没有可直接手动输入" autocomplete="off" />
      </div>
      <div id="pickManual" style="display:none;margin:0 2px 10px"></div>
      <div id="pickList" class="pick-list"></div>`;

    sheet({
      title,
      body,
      tall: list.length > 60,
      onMount(root, close) {
        const listEl = root.querySelector('#pickList');
        const searchEl = root.querySelector('#pickSearch');
        const manualEl = root.querySelector('#pickManual');
        let filtered = list;

        const pickManual = (text) => {
          const v = String(text || '').trim();
          if (!v) return;
          finish(v);
          close();
        };

        const renderManual = () => {
          const q = searchEl.value.trim();
          if (!q) { manualEl.style.display = 'none'; manualEl.innerHTML = ''; return; }
          const exact = list.some((it) => it.name === q);
          if (exact) { manualEl.style.display = 'none'; manualEl.innerHTML = ''; return; }
          manualEl.style.display = '';
          manualEl.innerHTML = `<button class="btn soft block" data-manual="1" style="justify-content:flex-start">
            ${icon('plus')}<span style="margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">用「${esc(q)}」（手动填写，列表里没有）</span>
          </button>`;
        };

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
          if (!filtered.length) rows.push('<p class="hint" style="text-align:center;padding:20px 0">列表里没有匹配项，可用上面「手动填写」</p>');
          if (filtered.length > 200) rows.push('<p class="hint" style="text-align:center">仅显示前 200 项，请继续输入关键字缩小范围</p>');
          listEl.innerHTML = rows.join('');
          renderManual();
        };

        listEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-val]');
          if (!btn) return;
          finish(btn.dataset.val);
          close();
        });

        manualEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-manual]');
          if (btn) pickManual(searchEl.value);
        });

        searchEl.addEventListener('input', () => {
          const q = searchEl.value.trim().toLowerCase();
          filtered = !q ? list : list.filter((it) =>
            it.name.toLowerCase().includes(q) || String(it.code || '').toLowerCase().includes(q));
          render();
        });

        // 回车：列表里恰好只有一项就直接选中，否则用手动填写的值
        searchEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (filtered.length === 1) { finish(filtered[0].name); close(); return; }
          const q = searchEl.value.trim();
          const exact = list.find((it) => it.name === q);
          if (exact) { finish(exact.name); close(); return; }
          if (q) pickManual(q);
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
