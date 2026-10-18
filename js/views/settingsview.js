/* 设置：报销人信息、报销单模板、数据备份 */

import { state, saveSettings, DEFAULT_SETTINGS } from '../store.js';
import { esc, icon, toast, confirmSheet, fmtBytes } from '../ui.js';
import { pickOption } from '../picker.js';
import { repo } from '../db.js';
import { rerender } from '../render.js';
import { inspectTemplate } from '../xlsx.js';
import { pickFiles, saveBlob, toArrayBuffer } from '../platform.js';
import { THEMES, CHART_TOGGLES, applyAppearance, readWallpaper } from '../appearance.js';
import { isWeChat } from '../env.js';
import { loadDefaultTemplate } from '../assets.js';
import { checkForUpdate, currentVersion } from '../update.js';
import { track, telemetryEnabled, setTelemetryEnabled, telemetryReady, telemetryHidden } from '../telemetry.js';

const OPTIONS = window.OPTIONS || {};

const PROFILE_FIELDS = [
  { key: 'traveler', label: '报销人姓名', type: 'text', placeholder: '会填入报销人的姓名列' },
  { key: 'empCode', label: '工号（申请人编码）', type: 'text', placeholder: '如 159，金蝶导入用' },
  { key: 'dept', label: '费用承担部门', type: 'pick', list: () => OPTIONS.departments || [] },
  { key: 'org', label: '申请组织', type: 'pick', list: () => OPTIONS.orgs || [] },
  { key: 'causa', label: '事由', type: 'text', placeholder: '默认「出差」' },
];

function lastBackupText() {
  const t = Number((state.settings && state.settings.lastBackupAt) || 0);
  if (!t) return '从未备份';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return days + ' 天前';
}

function backupHint() {
  const t = Number((state.settings && state.settings.lastBackupAt) || 0);
  const days = t ? (Date.now() - t) / 86400000 : 999;
  if (days <= 7) return '';
  return '<p class="hint" style="margin-top:8px">建议每周备份一次：备份包可存到电脑或网盘，换设备 / 换浏览器时用「恢复」导入。刷新页面、更新版本都不会影响已录入的数据。</p>';
}

export async function renderSettings(root) {
  const s = state.settings;
  const usage = await repo.usage();
  const fileCount = state.files.length;
  const tpl = state.template;
  const tplInfo = state.templateInfo;

  const fieldHtml = PROFILE_FIELDS.map((f) => f.type === 'pick'
    ? `<div class="field">
         <label class="field-label">${f.label}</label>
         <button class="input pick-display" data-pick="${f.key}" style="text-align:left;display:flex;align-items:center;justify-content:space-between">
           <span class="${s[f.key] ? '' : 'muted'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s[f.key] || '请选择')}</span>${icon('right')}
         </button>
       </div>`
    : `<div class="field">
         <label class="field-label">${f.label}</label>
         <input class="input" data-f="${f.key}" type="text" value="${esc(s[f.key] == null ? '' : s[f.key])}" placeholder="${esc(f.placeholder || '')}" />
       </div>`).join('');


  root.innerHTML = `
    <div class="section-title"><span>报销人信息</span><span class="card-sub">生成报销单时写入表头</span></div>
    <div class="card">${fieldHtml}
      <p class="hint">费用项目、项目中心这类每笔都不同的字段，不在设置里给默认值，录入票据时单独选。</p>
    </div>

    <div class="section-title"><span>个性化</span></div>
    <div class="card">
      <div class="card-sub" style="margin-bottom:8px">主题色</div>
      <div class="theme-row">
        ${THEMES.map((t) => `<button class="theme-dot ${(s.theme || 'blue') === t.key ? 'on' : ''}" data-theme-key="${t.key}" style="background:${t.color}" title="${esc(t.name)}" aria-label="${esc(t.name)}"></button>`).join('')}
      </div>

      <div class="card-sub" style="margin:16px 0 8px">壁纸</div>
      <div class="wallpaper-preview" id="wpPreview" style="${s.wallpaper ? `background-image:url("${s.wallpaper}")` : ''}">
        ${s.wallpaper ? '' : '未设置壁纸'}
      </div>
      <div class="btn-row">
        <button class="btn soft" data-a="wp-pick">${icon('image')}选择壁纸</button>
        <button class="btn ghost" data-a="wp-clear">清除</button>
      </div>

      <div class="card-sub" style="margin:16px 0 8px">图表显示</div>
      ${CHART_TOGGLES.map((c) => `<div class="row" style="justify-content:space-between;padding:7px 2px">
        <span style="font-size:14px">${c.name}</span>
        <div class="switch ${(s.charts && s.charts[c.key] !== false) ? 'on' : ''}" data-chart="${c.key}"></div>
      </div>`).join('')}
    </div>

    <div class="section-title"><span>报销单模板</span></div>
    <div class="card">
      <div class="row" style="gap:10px">
        <div class="thumb" style="width:40px;height:40px;background:var(--primary-soft);color:var(--primary)">${icon('doc')}</div>
        <div class="grow">
          <div style="font-weight:600">${esc(tpl ? tpl.name : '未导入模板')}</div>
          <div class="file-meta">${tplInfo && tplInfo.ok
            ? `工作表 ${esc(tplInfo.sheetName)} · 表头第 ${tplInfo.headerRow} 行 · 数据从第 ${tplInfo.dataStartRow} 行起`
            : (tplInfo ? '模板解析失败：' + esc(tplInfo.error) : '导入金蝶《员工报销单》模板后可一键生成')}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn soft" data-a="tpl-import">${icon('upload')}导入模板</button>
        <button class="btn ghost" data-a="tpl-reset">恢复内置</button>
      </div>
    </div>

    <div class="section-title"><span>数据</span></div>
    <div class="card">
      <div class="kv"><span class="k">周期 / 文件</span><span class="v">${state.periods.length} 个 / ${fileCount} 个</span></div>
      <div class="kv"><span class="k">占用空间</span><span class="v">${usage && usage.usage ? fmtBytes(usage.usage) : '—'}${usage && usage.quota ? ` / ${fmtBytes(usage.quota)}` : ''}</span></div>
      <div class="kv"><span class="k">上次备份</span><span class="v">${lastBackupText()}</span></div>
      <div class="btn-row">
        <button class="btn soft" data-a="backup">${icon('download')}备份</button>
        <button class="btn ghost" data-a="restore">${icon('upload')}恢复</button>
      </div>
      ${isWeChat ? '<p class="hint" style="margin-top:10px">微信内使用时，数据保存在微信浏览器缓存中；清理微信缓存或卸载微信会丢失，建议每周备份一次，并在浏览器里导出备份包。</p>' : ''}
      <button class="btn danger block mt12" data-a="wipe">${icon('trash')}清空全部数据</button>
      ${backupHint()}
    </div>

    <div class="section-title"><span>隐私</span></div>
    <div class="card">
      <div class="row" style="justify-content:space-between;gap:12px;align-items:flex-start">
        <div class="grow">
          <div style="font-weight:600">使用情况统计</div>
          <div class="file-meta" style="margin-top:3px">会记录功能使用情况（设备型号、打开、建周期、导入、导出等事件），用于改进工具；<b>不上传发票文件、金额、文件名</b>。</div>
        </div>
        ${telemetryReady() && !telemetryHidden() ? `<div class="switch ${telemetryEnabled() ? 'on' : ''}" data-tel style="margin-top:4px"></div>` : ''}
      </div>
      ${telemetryReady() ? '' : '<p class="hint" style="margin-top:8px">当前部署未接入统计服务。</p>'}
    </div>

    <div class="section-title"><span>关于</span></div>
    <div class="card">
      <div class="kv"><span class="k">应用</span><span class="v">票据管家 ${currentVersion().name || ""}</span></div>
      <div class="kv"><span class="k">版本更新</span><span class="v"><button class="btn small ghost" data-update>检查更新</button></span></div>
      <div class="kv"><span class="k">数据存储</span><span class="v">仅保存在本机</span></div>
      <p class="hint">所有票据、附件与报表都在手机本地处理，不会上传到任何服务器。</p>
    </div>`;

  root.querySelectorAll('[data-f]').forEach((el) => {
    el.addEventListener('change', async () => {
      await saveSettings({ [el.dataset.f]: el.value.trim() });
      toast('已保存');
    });
  });
  root.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cfg = PROFILE_FIELDS.find((f) => f.key === btn.dataset.pick);
      if (!cfg) return;
      const v = await pickOption({ title: cfg.label, options: cfg.list(), value: state.settings[cfg.key] || '' });
      if (v === null) return;
      await saveSettings({ [cfg.key]: v });
      rerender();
    });
  });

  root.querySelectorAll('[data-theme-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await saveSettings({ theme: btn.dataset.themeKey });
      applyAppearance(state.settings);
      rerender();
    });
  });
  root.querySelectorAll('[data-chart]').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const key = sw.dataset.chart;
      const charts = { ...(state.settings.charts || {}) };
      charts[key] = charts[key] === false;
      await saveSettings({ charts });
      rerender();
    });
  });

  const telSw = root.querySelector('[data-tel]');
  if (telSw) {
    telSw.addEventListener('click', async () => {
      const next = !telemetryEnabled();
      setTelemetryEnabled(next);
      await saveSettings({ telemetry: next });
      toast(next ? '已开启匿名统计' : '已关闭匿名统计');
      rerender();
    });
  }

  const upBtn = root.querySelector('[data-update]');
  if (upBtn) upBtn.addEventListener('click', () => checkForUpdate({ silent: false }));

  const wire = (a, fn) => { const el = root.querySelector(`[data-a="${a}"]`); if (el) el.addEventListener('click', fn); };
  wire('wp-pick', pickWallpaper);
  wire('wp-clear', clearWallpaper);
  wire('tpl-import', importTemplate);
  wire('tpl-reset', resetTemplate);
  wire('backup', backup);
  wire('restore', restore);
  wire('wipe', wipeAll);
}

async function pickWallpaper() {
  const files = await pickFiles('image/*', false);
  if (!files[0]) return;
  const data = await readWallpaper(files[0]);
  if (!data) { toast('图片处理失败，换一张试试', 'err'); return; }
  try {
    await saveSettings({ wallpaper: data });
  } catch (e) {
    toast('壁纸太大，保存失败', 'err');
    return;
  }
  applyAppearance(state.settings);
  toast('壁纸已应用', 'ok');
  rerender();
}

async function clearWallpaper() {
  await saveSettings({ wallpaper: '' });
  applyAppearance(state.settings);
  rerender();
}

async function importTemplate() {
  const files = await pickFiles('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false);
  const file = files[0];
  if (!file) return;
  try {
    const buf = await toArrayBuffer(file);
    await inspectTemplate(buf);
    await repo.set('template', { name: file.name, importedAt: Date.now(), data: buf });
    state.template = { name: file.name, data: buf };
    const info = await inspectTemplate(buf);
    state.templateInfo = { ...info, ok: true };
    toast('模板已导入', 'ok');
    rerender();
  } catch (e) {
    toast('模板不可用：' + e.message, 'err');
  }
}

async function resetTemplate() {
  const ok = await confirmSheet({
    title: '恢复内置模板',
    message: '将用内置的《金蝶员工报销单》模板替换当前模板。已导入的票据数据不受影响。',
    okText: '恢复内置',
  });
  if (!ok) return;
  try {
    const buf = await loadDefaultTemplate();
    const info = await inspectTemplate(buf);
    await repo.set('template', { name: '金蝶员工报销表单（内置）', importedAt: Date.now(), data: buf });
    state.template = { name: '金蝶员工报销表单（内置）', data: buf };
    state.templateInfo = { ...info, ok: true };
    toast('已恢复内置模板', 'ok');
    rerender();
  } catch (e) {
    toast('恢复失败：' + e.message, 'err');
  }
}

async function backup() {
  const ok = await confirmSheet({
    title: '备份数据',
    message: `将导出包含 `` 个文件的备份包（票据、附件、配置），保存到下载目录。`,
    okText: '开始备份',
  });
  if (!ok) return;
  toast('正在备份…');
  const zip = new JSZip();
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    periods: state.periods,
    files: state.files,
    hasTemplate: !!state.template,
  };
  zip.file('data.json', JSON.stringify(data, null, 2));
  if (state.template && state.template.data) {
    zip.file('template.xlsx', state.template.data, { binary: true });
  }
  for (const f of state.files) {
    const buf = await repo.data(f.id);
    if (buf) zip.file(`files/${f.id}`, buf, { binary: true });
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } });
  const name = `票据管家备份_${new Date().toISOString().slice(0, 10)}.zip`;
  const res = await saveBlob(blob, name);
  if (res.ok) { toast('备份已导出', 'ok'); track('backup'); saveSettings({ lastBackupAt: Date.now() }); }
  else if (!res.wechat) toast('备份失败：' + (res.error || ''), 'err');
}

async function restore() {
  const files = await pickFiles('.zip,application/zip', false);
  const file = files[0];
  if (!file) return;
  const ok = await confirmSheet({
    title: '恢复备份', message: '恢复将覆盖当前所有周期和票据数据，确定继续？',
    okText: '覆盖恢复', danger: true,
  });
  if (!ok) return;
  try {
    toast('正在恢复…');
    const zip = await JSZip.loadAsync(file);
    const dFile = zip.file('data.json');
    if (!dFile) throw new Error('备份文件中缺少 data.json');
    const data = JSON.parse(await dFile.async('string'));
    await repo.wipe();
    for (const p of data.periods || []) await repo.savePeriod(p);
    for (const meta of data.files || []) {
      const entry = zip.file(`files/${meta.id}`);
      const buf = entry ? await entry.async('arraybuffer') : null;
      if (buf) await repo.addFile({ ...meta, createdAt: meta.createdAt || Date.now() }, buf);
      else await repo.addFile(meta, null);
    }
    if (data.settings) await repo.set('settings', data.settings);
    const tplEntry = zip.file('template.xlsx');
    if (tplEntry) {
      const buf = await tplEntry.async('arraybuffer');
      await repo.set('template', { name: '备份模板', importedAt: Date.now(), data: buf });
    }
    location.reload();
  } catch (e) {
    toast('恢复失败：' + e.message, 'err');
  }
}

async function wipeAll() {
  const ok = await confirmSheet({
    title: '清空全部数据', message: '将删除所有周期、票据、附件与设置，且无法恢复。建议先备份。',
    okText: '全部清空', danger: true,
  });
  if (!ok) return;
  const ok2 = await confirmSheet({
    title: '再次确认',
    message: '这是不可撤销的操作。清空后所有票据、附件和周期都会消失，确定要继续吗？',
    okText: '我确定，清空', danger: true,
  });
  if (!ok2) return;
  await repo.wipe();
  state.periods = [];
  state.files = [];
  state.settings = { ...DEFAULT_SETTINGS };
  state.template = null;
  state.templateInfo = null;
  toast('已清空', 'ok');
  rerender();
}
