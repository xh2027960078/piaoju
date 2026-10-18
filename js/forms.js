/* 表单与录入流程：周期编辑、票据/附件信息、导入与识别 */

import { repo } from './db.js';
import { state, periodById, nextSeq } from './store.js';
import { sheet, toast, icon, esc, todayISO, daysBetween, closeSheet } from './ui.js';
import { toArrayBuffer } from './platform.js';
import { pickOption } from './picker.js';
import { buildFileName, uniqueNameInPeriod } from './naming.js';
import { openFileViewer } from './viewer.js';
import { detectFromPdf } from './pdftext.js';

const OPTIONS = window.OPTIONS || { costItems: [], travelTypes: [], invoiceTypes: [], departments: [], projects: [], orgs: [] };

const LISTS = {
  costItem: { label: '费用项目', list: () => OPTIONS.costItems },
  travelType: { label: '差旅费类型', list: () => OPTIONS.travelTypes },
  invoiceType: { label: '发票类型', list: () => OPTIONS.invoiceTypes },
  dept: { label: '费用承担部门', list: () => OPTIONS.departments },
  project: { label: '项目中心', list: () => OPTIONS.projects },
  org: { label: '申请组织', list: () => OPTIONS.orgs },
};

/* ---------------- 缩略图 ---------------- */
export async function makeThumb(file, max = 360) {
  if (!file.type.startsWith('image/')) return null;
  try {
    let bmp;
    if (window.createImageBitmap) bmp = await createImageBitmap(file);
    else {
      bmp = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = bmp.width, h0 = bmp.height;
    const scale = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch (e) {
    return null;
  }
}

function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.includes('pdf') || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'other';
}

/* ---------------- 新增/编辑周期 ---------------- */
export function openPeriodForm(existing = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const today = todayISO();
    const p = existing || { name: '', start: today, end: today, from: '', to: '', note: '' };
    let nameTouched = !!existing;

    const body = `
      <div class="field">
        <label class="field-label">周期名称<span class="req">*</span></label>
        <input class="input" id="pName" value="${esc(p.name)}" placeholder="例如：9月东莞出差" maxlength="30" />
      </div>
      <div class="field-row">
        <div class="field"><label class="field-label">开始日期<span class="req">*</span></label>
          <input class="input" type="date" id="pStart" value="${esc(p.start)}" /></div>
        <div class="field"><label class="field-label">结束日期<span class="req">*</span></label>
          <input class="input" type="date" id="pEnd" value="${esc(p.end)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="field-label">出发地</label>
          <input class="input" id="pFrom" value="${esc(p.from || '')}" placeholder="如：广州" maxlength="20" /></div>
        <div class="field"><label class="field-label">目的地</label>
          <input class="input" id="pTo" value="${esc(p.to || '')}" placeholder="如：东莞" maxlength="20" /></div>
      </div>
      <div class="field">
        <label class="field-label">备注</label>
        <input class="input" id="pNote" value="${esc(p.note || '')}" placeholder="选填" maxlength="60" />
      </div>
      <p class="hint" id="pDays">共 1 天</p>`;

    sheet({
      title: existing ? '编辑周期' : '新建出差周期',
      body,
      foot: `<button class="btn ghost" data-x="0">取消</button>
             <button class="btn primary" data-x="1">${existing ? '保存' : '创建'}</button>`,
      onMount(root, close) {
        const $ = (id) => root.querySelector(id);
        const nameEl = $('#pName'), startEl = $('#pStart'), endEl = $('#pEnd'), toEl = $('#pTo');
        const daysEl = $('#pDays');

        const syncDays = () => {
          const d = daysBetween(startEl.value, endEl.value);
          daysEl.textContent = startEl.value && endEl.value
            ? (endEl.value < startEl.value ? '结束日期早于开始日期' : `共 ${d} 天`)
            : '';
          if (!nameTouched) {
            const s = startEl.value.slice(5).replace('-', '.');
            nameEl.value = `${toEl.value ? toEl.value : ''}出差 ${s}`.trim();
          }
        };
        nameEl.addEventListener('input', () => { nameTouched = true; });
        [startEl, endEl, toEl].forEach((el) => el.addEventListener('change', syncDays));
        if (!nameTouched && !p.name) syncDays();

        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.x !== '1') { finish(null); close(); return; }
          const name = nameEl.value.trim();
          if (!name) { toast('请填写周期名称', 'err'); return; }
          if (!startEl.value || !endEl.value) { toast('请选择开始和结束日期', 'err'); return; }
          if (endEl.value < startEl.value) { toast('结束日期不能早于开始日期', 'err'); return; }
          finish({
            ...(existing || {}),
            name,
            start: startEl.value,
            end: endEl.value,
            from: $('#pFrom').value.trim(),
            to: toEl.value.trim(),
            note: $('#pNote').value.trim(),
          });
          close();
        }));
      },
      onClose() { finish(null); },
    });
  });
}

/* ---------------- 通用：选择字段 ---------------- */
function pickButton(key, value, label) {
  return `<div class="field">
    <label class="field-label">${esc(label)}</label>
    <button class="input pick-display" data-pick="${key}" style="text-align:left;display:flex;align-items:center;justify-content:space-between">
      <span class="${value ? '' : 'muted'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(value || '请选择')}</span>${icon('right')}
    </button>
  </div>`;
}

function bindPick(root, current) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const key = btn.dataset.pick;
    const cfg = LISTS[key];
    if (!cfg) return;
    const v = await pickOption({ title: cfg.label, options: cfg.list(), value: current[key] || '' });
    if (v === null) return;
    current[key] = v;
    setPickUI(root, key, v);
  });
}

function setPickUI(root, key, value) {
  const btn = root.querySelector(`[data-pick="${key}"]`);
  if (!btn) return;
  btn.innerHTML = `<span class="${value ? '' : 'muted'}">${esc(value || '请选择')}</span>${icon('right')}`;
}

/* ---------------- 票据信息 ---------------- */
export function openInvoiceForm(file, { onSaved } = {}) {
  const p = periodById(file.periodId);
  const meta = {
    amount: '', date: p ? p.start : todayISO(),
    costItem: '', travelType: '', invoiceType: '',
    project: '', from: p ? (p.from || '') : '', to: p ? (p.to || '') : '', remark: '',
    ...(file.meta || {}),
    dept: state.settings.dept || '',
  };
  const current = { ...meta };

  const body = `
    <div class="row" style="margin:0 2px 14px">
      <div class="thumb" style="width:44px;height:44px">${file.thumb ? `<img src="${file.thumb}" alt="">` : icon('doc')}</div>
      <div class="grow">
        <div class="file-name" style="font-size:14px">票据 #${file.seq || 1} · ${esc(p ? p.name : '')}</div>
        <div class="file-meta">${esc(file.name)}</div>
      </div>
      ${file.fileKind === 'pdf' ? '<button class="btn small soft" data-detect="1">识别</button>' : ''}
      <button class="btn small ghost" data-preview="1">预览</button>
    </div>
    <div class="field-row">
      <div class="field"><label class="field-label">金额（元）<span class="req">*</span></label>
        <input class="input" data-f="amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${esc(meta.amount || '')}" /></div>
      <div class="field"><label class="field-label">票据日期</label>
        <input class="input" data-f="date" type="date" value="${esc(meta.date || '')}" /></div>
    </div>
    <div class="chip-row" id="amtChips" style="margin:-6px 2px 12px"></div>
    ${pickButton('project', meta.project, '项目中心')}
    ${pickButton('costItem', meta.costItem, '费用项目')}
    <div class="field-row" style="align-items:flex-start">
      <div style="flex:1;min-width:0">${pickButton('travelType', meta.travelType, '差旅费类型')}</div>
      <div style="flex:1;min-width:0">${pickButton('invoiceType', meta.invoiceType, '发票类型')}</div>
    </div>
    <div class="field-row">
      <div class="field"><label class="field-label">出发地</label>
        <input class="input" data-f="from" maxlength="20" placeholder="如：广州" value="${esc(meta.from || '')}" /></div>
      <div class="field"><label class="field-label">目的地</label>
        <input class="input" data-f="to" maxlength="20" placeholder="如：东莞" value="${esc(meta.to || '')}" /></div>
    </div>
    <div class="field"><label class="field-label">备注（会写进文件名）</label>
      <input class="input" data-f="remark" maxlength="40" placeholder="如：住宿2晚 / 客户拜访" value="${esc(meta.remark || '')}" /></div>
    <p class="hint">费用承担部门取自「设置」，不在这里填；保存后文件名为：项目中心-费用项目-备注-金额</p>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };

    sheet({
      title: '票据信息',
      body,
      tall: true,
      foot: `<button class="btn ghost" data-x="0">取消</button><button class="btn primary" data-x="1">保存</button>`,
      onMount(root, close) {
        bindPick(root, current);
        root.querySelector('[data-preview]').addEventListener('click', () => openFileViewer(file.id, {}));

        // 识别到多个金额时给出一排可点的候选值，避免自动选错时还要手输
        const chipsBox = root.querySelector('#amtChips');
        const renderChips = (list) => {
          if (!chipsBox) return;
          const uniq = [...new Set((list || []).filter((n) => Number(n) > 0))];
          if (uniq.length < 2) { chipsBox.innerHTML = ''; return; }
          chipsBox.innerHTML = '<span class="hint" style="margin-right:6px;align-self:center">识别到：</span>'
            + uniq.map((n) => `<button class="chip" data-amt="${n}">${n}</button>`).join('');
        };
        renderChips((meta.detected && meta.detected.candidates) || []);
        chipsBox && chipsBox.addEventListener('click', (e) => {
          const chip = e.target.closest('[data-amt]');
          if (!chip) return;
          const input = root.querySelector('[data-f="amount"]');
          if (input) input.value = chip.dataset.amt;
        });

        const detBtn = root.querySelector('[data-detect]');
        if (detBtn) detBtn.addEventListener('click', async () => {
          detBtn.disabled = true;
          detBtn.textContent = '识别中';
          const buf = await repo.data(file.id);
          const det = buf ? await detectFromPdf(buf) : null;
          detBtn.disabled = false;
          detBtn.textContent = '识别';
          if (!det || (!det.amount && !det.date)) { toast('没识别到金额，请手动填写', 'err'); return; }
          if (det.amount) root.querySelector('[data-f="amount"]').value = det.amount;
          if (det.date) root.querySelector('[data-f="date"]').value = det.date;
          for (const key of ['invoiceType', 'travelType']) {
            if (det[key]) { current[key] = det[key]; setPickUI(root, key, det[key]); }
          }
          renderChips(det.candidates);
          toast(det.amount ? `识别到金额 ¥${det.amount}` : '识别到日期', 'ok');
        });

        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
          if (b.dataset.x !== '1') { finish(null); close(); return; }
          const read = (k) => {
            const el = root.querySelector(`[data-f="${k}"]`);
            return el ? el.value.trim() : '';
          };
          const amount = Number(String(read('amount')).replace(/[^\d.\-]/g, ''));
          if (!amount || amount <= 0) { toast(`票据 #${file.seq || 1} 金额未填`, 'err'); return; }
          const next = {
            ...current,
            amount,
            date: read('date') || current.date,
            from: read('from'),
            to: read('to'),
            remark: read('remark'),
            dept: state.settings.dept || '',
          };
          const name = uniqueNameInPeriod(file.periodId, buildFileName(next, file.name, file.mime), file.id);
          const saved = await repo.saveFile({ ...file, name, meta: next });
          finish(saved);
          if (onSaved) onSaved(saved);
          toast('已保存', 'ok');
          close();
        }));
      },
      onClose() { finish(null); },
    });
  });
}

/* ---------------- 附件信息 ---------------- */
export function openAttachmentForm(file, { onSaved } = {}) {
  const p = periodById(file.periodId);
  const meta = { project: '', costItem: '', remark: '', amount: '', ...(file.meta || {}) };
  const current = { ...meta };

  const body = `
    <div class="row" style="margin:0 2px 14px">
      <div class="thumb" style="width:44px;height:44px">${file.thumb ? `<img src="${file.thumb}" alt="">` : icon('file')}</div>
      <div class="grow">
        <div class="file-name" style="font-size:14px">附件 #${file.seq || 1} · ${esc(p ? p.name : '')}</div>
        <div class="file-meta">${esc(file.name)}</div>
      </div>
      <button class="btn small ghost" data-preview="1">预览</button>
    </div>
    ${pickButton('project', meta.project, '项目中心')}
    ${pickButton('costItem', meta.costItem, '费用项目')}
    <div class="field-row">
      <div class="field"><label class="field-label">备注（会写进文件名）</label>
        <input class="input" data-f="remark" maxlength="40" placeholder="如：出差审批单" value="${esc(meta.remark || '')}" /></div>
      <div class="field"><label class="field-label">金额（元）<span class="req">*</span></label>
        <input class="input" data-f="amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${esc(meta.amount || '')}" /></div>
    </div>
    <p class="hint">保存后文件名自动改为：项目中心-费用项目-备注-金额</p>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    sheet({
      title: '附件信息',
      body,
      foot: `<button class="btn ghost" data-x="0">取消</button><button class="btn primary" data-x="1">保存</button>`,
      onMount(root, close) {
        bindPick(root, current);
        root.querySelector('[data-preview]').addEventListener('click', () => openFileViewer(file.id, {}));
        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
          if (b.dataset.x !== '1') { finish(null); close(); return; }
          const read = (k) => {
            const el = root.querySelector(`[data-f="${k}"]`);
            return el ? el.value.trim() : '';
          };
          const amount = Number(String(read('amount')).replace(/[^\d.\-]/g, ''));
          if (!amount || amount <= 0) { toast(`附件 #${file.seq || 1} 金额未填`, 'err'); return; }
          const next = { ...current, remark: read('remark'), amount };
          const name = uniqueNameInPeriod(file.periodId, buildFileName(next, file.name, file.mime), file.id);
          const saved = await repo.saveFile({ ...file, name, meta: next });
          finish(saved);
          if (onSaved) onSaved(saved);
          toast('已保存', 'ok');
          close();
        }));
      },
      onClose() { finish(null); },
    });
  });
}

/* ---------------- 逐张补录（不做“应用到全部”） ---------------- */
export function openBatchMeta(files, kind, { onDone } = {}) {
  const isInvoice = kind === 'invoice';
  const rows = files.map((f) => ({
    file: f,
    seq: f.seq || 1,
    amount: f.meta && f.meta.amount ? f.meta.amount : '',
    date: (f.meta && f.meta.date) || '',
    remark: (f.meta && f.meta.remark) || '',
  }));

  const body = `<p class="hint" style="margin:0 2px 12px">逐张填写，每条的字段各自独立；金额必填。</p>
    <div id="batchList">
      ${rows.map((r, i) => `
        <div class="batch-row" data-i="${i}">
          <div class="row" style="gap:10px">
            <div class="thumb" style="width:40px;height:40px">${r.file.thumb ? `<img src="${r.file.thumb}" alt="">` : icon(isInvoice ? 'doc' : 'file')}</div>
            <div class="grow">
              <div class="batch-name" title="${esc(r.file.name)}">${isInvoice ? '票据' : '附件'} #${r.seq}</div>
              <div class="file-meta">${esc(r.file.name)}${r.file.meta && r.file.meta.detected && r.file.meta.detected.amount ? ' · 已识别金额' : ''}</div>
            </div>
            <button class="btn small ghost" data-preview="${i}">预览</button>
          </div>
          <div class="row" style="gap:8px;margin-top:8px">
            <input class="input" style="flex:1;height:40px" data-bamount="${i}" type="number" inputmode="decimal" step="0.01" placeholder="金额（必填）" value="${esc(r.amount || '')}" />
            ${isInvoice
              ? `<input class="input" style="flex:1;height:40px" data-bdate="${i}" type="date" value="${esc(r.date)}" />`
              : `<input class="input" style="flex:1;height:40px" data-bremark="${i}" maxlength="40" placeholder="备注" value="${esc(r.remark || '')}" />`}
            <button class="btn small soft" data-detail="${i}">详情</button>
          </div>
        </div>`).join('')}
    </div>`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    sheet({
      title: `补充${isInvoice ? '票据' : '附件'}信息（${files.length}）`,
      body,
      tall: true,
      foot: `<button class="btn ghost" data-x="0">稍后再说</button><button class="btn primary" data-x="1">保存</button>`,
      onMount(root, close) {
        root.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => {
          openFileViewer(rows[+b.dataset.preview].file.id, {});
        }));
        root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', () => {
          const idx = +b.dataset.detail;
          const fn = isInvoice ? openInvoiceForm : openAttachmentForm;
          fn(rows[idx].file, {
            onSaved: (saved) => {
              rows[idx].file = saved;
              const input = root.querySelector(`[data-bamount="${idx}"]`);
              if (input && saved.meta && Number(saved.meta.amount) > 0) input.value = saved.meta.amount;
            },
          });
        }));
        root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
          if (b.dataset.x !== '1') { finish(null); close(); return; }
          const missing = [];
          for (let i = 0; i < rows.length; i++) {
            const amt = Number(root.querySelector(`[data-bamount="${i}"]`).value);
            if (!(amt > 0)) missing.push(rows[i].seq);
          }
          if (missing.length) {
            toast(`${isInvoice ? '票据' : '附件'}第 ${missing.join('、')} 行金额未填`, 'err');
            return;
          }
          let n = 0;
          for (let i = 0; i < rows.length; i++) {
            const f = rows[i].file;
            const meta = { ...(f.meta || {}) };
            meta.amount = Number(root.querySelector(`[data-bamount="${i}"]`).value);
            if (isInvoice) {
              const date = root.querySelector(`[data-bdate="${i}"]`).value;
              if (date) meta.date = date;
            } else {
              const remark = root.querySelector(`[data-bremark="${i}"]`).value.trim();
              if (remark) meta.remark = remark;
            }
            const name = uniqueNameInPeriod(f.periodId, buildFileName(meta, f.name, f.mime), f.id);
            await repo.saveFile({ ...f, name, meta });
            n++;
          }
          toast(`已保存 ${n} 条`, 'ok');
          finish(n);
          if (onDone) onDone(n);
          close();
        }));
      },
      onClose() { finish(null); },
    });
  });
}

/* ---------------- 导入文件 ---------------- */
export async function importFiles(periodId, kind, files, { onEach } = {}) {
  const p = periodById(periodId);
  const added = [];
  let seq = nextSeq(periodId, kind);
  for (const file of files) {
    if (file.size > 40 * 1024 * 1024) {
      toast(`${file.name} 超过 40MB，已跳过`, 'err');
      continue;
    }
    if (!file.size) {
      toast(`${file.name || '文件'}：没读到内容（0 字节），已跳过；请先保存到手机再导入`, 'err');
      continue;
    }
    const thumb = await makeThumb(file, kind === 'invoice' ? 360 : 240);
    const meta = kind === 'invoice' ? {
      amount: 0,
      date: p ? p.start : todayISO(),
      costItem: '', travelType: '', invoiceType: '',
      dept: state.settings.dept || '', project: '',
      from: p ? (p.from || '') : '', to: p ? (p.to || '') : '', remark: '',
    } : { project: '', costItem: '', remark: '', amount: 0 };
    const buf = await toArrayBuffer(file);
    if (!buf || buf.byteLength === 0) {
      toast(`${file.name || '文件'}：读取失败（0 字节），已跳过`, 'err');
      continue;
    }
    const rec = await repo.addFile({
      periodId,
      kind,
      seq: seq++,
      name: file.name || `文件_${Date.now()}`,
      mime: file.type || '',
      size: file.size,
      fileKind: kindOf(file),
      shotAt: file.lastModified || Date.now(),
      thumb,
      meta,
    }, buf);
    added.push(rec);
    if (onEach) onEach(rec);
  }
  return added;
}

/**
 * 后台识别 PDF 发票金额：整体限时，单张失败不影响已导入的文件
 */
export async function detectImported(files, { onProgress, budgetMs = 15000 } = {}) {
  const targets = files.filter((f) => f.kind === 'invoice' && f.fileKind === 'pdf' && !(Number(f.meta && f.meta.amount) > 0));
  const deadline = Date.now() + budgetMs;
  let detected = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    if (onProgress) onProgress(i, targets.length);
    if (Date.now() > deadline) break;
    try {
      const buf = await repo.data(f.id);
      if (!buf) continue;
      const det = await Promise.race([
        detectFromPdf(buf),
        new Promise((res) => setTimeout(() => res(null), Math.max(1500, deadline - Date.now()))),
      ]);
      if (det && (det.amount || det.date)) {
        const meta = { ...(f.meta || {}) };
        if (det.amount) { meta.amount = det.amount; detected++; }
        if (det.date) meta.date = det.date;
        if (det.invoiceType) meta.invoiceType = det.invoiceType;
        if (det.travelType) meta.travelType = det.travelType;
        meta.detected = { amount: det.amount, date: det.date, candidates: det.candidates || [] };
        const name = uniqueNameInPeriod(f.periodId, buildFileName(meta, f.name, f.mime), f.id);
        await repo.saveFile({ ...f, name, meta });
      }
    } catch (e) { /* 单张失败忽略 */ }
  }
  if (onProgress) onProgress(targets.length, targets.length);
  return { detected, total: targets.length };
}

/* ---------------- 识别进度弹层 ---------------- */
export function openDetectProgress(total) {
  sheet({
    title: '正在识别金额',
    body: `<p class="hint" style="margin:2px 2px 12px">从 PDF 文字层读取价税合计，稍等几秒；识别不到也可以手动填。</p>
      <div class="progress"><i id="detBar" style="width:6%"></i></div>
      <p class="hint" id="detText" style="text-align:center;margin-top:10px">0 / ${total}</p>`,
  });
  return {
    update(done) {
      const bar = document.querySelector('#detBar');
      const txt = document.querySelector('#detText');
      if (bar) bar.style.width = `${Math.max(6, Math.round((done / Math.max(1, total)) * 100))}%`;
      if (txt) txt.textContent = `${done} / ${total}`;
    },
    close() { closeSheet(); },
  };
}
