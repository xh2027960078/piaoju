/* 平台适配：Android 原生桥 / 浏览器 / 微信内置浏览器 */

import { sheet, toast } from './ui.js';
import { isWeChat } from './env.js';

const bridge = window.Android || null;
export const isNative = !!bridge;

export function toastNative(msg) {
  if (bridge && bridge.toast) bridge.toast(String(msg));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 兼容旧版 WebView 的 ArrayBuffer 读取 */
export function toArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/** 通过原生桥分块写文件，mode: download | share | open */
async function nativeWrite(blob, filename, mode) {
  const mime = blob.type || 'application/octet-stream';
  if (bridge.beginFile && bridge.writeChunk && bridge.endFile) {
    const token = bridge.beginFile(filename, mime, mode);
    if (String(token).startsWith('err')) return { ok: false, error: String(token).slice(4) };
    const b64 = await blobToBase64(blob);
    const CHUNK = 1 << 21;
    for (let i = 0; i < b64.length; i += CHUNK) {
      const res = bridge.writeChunk(token, b64.slice(i, i + CHUNK));
      if (String(res).startsWith('err')) {
        try { bridge.endFile(token); } catch (e) { /* ignore */ }
        return { ok: false, error: String(res).slice(4) };
      }
    }
    const done = String(bridge.endFile(token));
    if (done.startsWith('ok')) return { ok: true, native: true, path: done.slice(3) };
    return { ok: false, error: done.slice(4) };
  }
  const b64 = await blobToBase64(blob);
  const fn = mode === 'share' ? 'shareFile' : mode === 'open' ? 'openFile' : 'saveFile';
  if (!bridge[fn]) return { ok: false, error: '当前版本不支持该操作' };
  const res = String(bridge[fn](filename, mime, b64));
  if (res.startsWith('ok')) return { ok: true, native: true, path: res.slice(3) };
  return { ok: false, error: res.slice(4) };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/** 微信内置浏览器不能保存文件：给出可执行的替代方案 */
function showWeChatHelp(blob, filename) {
  const isImg = (blob.type || '').startsWith('image/');
  const url = isImg ? URL.createObjectURL(blob) : '';
  const body = `
    ${isImg ? `<img src="${url}" style="width:100%;border-radius:14px;max-height:50vh;object-fit:contain;background:#00000010" alt="">` : ''}
    <p class="hint" style="margin:12px 2px 8px">微信内置浏览器不允许直接保存文件，可以这样拿到文件：</p>
    <div class="kv"><span class="k">推荐</span><span class="v" style="text-align:right">点右上角「…」→「在浏览器打开」，再点导出</span></div>
    ${isImg ? '<div class="kv"><span class="k">图片</span><span class="v" style="text-align:right">长按上方图片 → 保存到相册</span></div>' : ''}
    <div class="kv"><span class="k">转发</span><span class="v" style="text-align:right">在浏览器里导出后，用「转发」发给自己或财务</span></div>`;
  sheet({
    title: '保存文件',
    body,
    foot: `${isImg ? '' : '<button class="btn ghost" data-x="try">尝试直接下载</button>'}
           <button class="btn primary" data-x="copy">复制页面链接</button>`,
    onMount(root, close) {
      root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.x === 'try') triggerDownload(blob, filename);
        if (b.dataset.x === 'copy') {
          try {
            await navigator.clipboard.writeText(location.href);
            toast('链接已复制，粘贴到浏览器打开', 'ok');
          } catch (e) {
            toast(location.href, '');
          }
        }
        close();
      }));
    },
    onClose() { if (url) URL.revokeObjectURL(url); },
  });
}

/** 保存文件：原生桥 → 浏览器保存对话框 → 下载 → 微信引导 */
export async function saveBlob(blob, filename) {
  if (bridge && (bridge.beginFile || bridge.saveFile)) {
    try { return await nativeWrite(blob, filename, 'download'); } catch (e) { return { ok: false, error: e.message }; }
  }
  if (window.showSaveFilePicker && !isWeChat) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { ok: true, native: false, saved: true };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, canceled: true };
    }
  }
  if (isWeChat) {
    showWeChatHelp(blob, filename);
    return { ok: false, wechat: true, canceled: true };
  }
  try {
    triggerDownload(blob, filename);
    return { ok: true, native: false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 转发：拉起系统分享（微信、QQ、邮件等） */
export async function shareBlob(blob, filename) {
  if (bridge && (bridge.beginFile || bridge.shareFile)) {
    try { return await nativeWrite(blob, filename, 'share'); } catch (e) { return { ok: false, error: e.message }; }
  }
  if (isWeChat) {
    showWeChatHelp(blob, filename);
    return { ok: false, wechat: true, canceled: true };
  }
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return { ok: true };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, canceled: true };
    }
  }
  const r = await saveBlob(blob, filename);
  return { ...r, downloaded: r.ok };
}

/** 用系统应用打开 */
export async function openBlob(blob, filename) {
  if (bridge && (bridge.beginFile || bridge.openFile)) {
    try {
      const r = await nativeWrite(blob, filename, 'open');
      return r.ok;
    } catch (e) { return false; }
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/** 拍照，返回 File 或 null（取消时原生会回调空串） */
export function takePhoto() {
  if (bridge && bridge.takePhoto) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); window.__onNativePhoto = null; resolve(v); };
      const timer = setTimeout(() => finish(null), 120000);
      window.__onNativePhoto = (dataUrl) => {
        if (!dataUrl) { finish(null); return; }
        try {
          const [head, b64] = String(dataUrl).split(',');
          const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
          const blob = base64ToBlob(b64, mime);
          const name = `照片_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.jpg`;
          finish(new File([blob], name, { type: mime }));
        } catch (e) { finish(null); }
      };
      bridge.takePhoto();
    });
  }
  return pickViaInput('image/*', true, true);
}

/** 选择文件，返回 File[] */
export function pickFiles(accept = '*/*', multiple = true) {
  return pickViaInput(accept, multiple, false);
}

function pickViaInput(accept, multiple, capture) {
  return new Promise((resolve) => {
    const el = document.getElementById(capture ? 'photoPicker' : 'filePicker');
    el.value = '';
    el.accept = accept || '*/*';
    el.multiple = !!multiple && !capture;

    let done = false;
    let resumeTimer = null;

    const cleanup = () => {
      el.removeEventListener('change', onChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (window.__onPickCancel === onCancel) window.__onPickCancel = null;
      clearTimeout(timer);
      clearTimeout(resumeTimer);
    };
    const finish = (files) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(files);
    };
    const onChange = () => finish(Array.from(el.files || []));
    const onCancel = () => finish([]);
    // 用户从选择器返回时：若没有 change 事件，视为取消（安卓端取消不会触发 change）
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || done) return;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { if (!done) finish([]); }, 1500);
    };

    const timer = setTimeout(() => finish([]), 120000);
    el.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.__onPickCancel = onCancel;
    el.click();
  });
}

export function vibrate(ms = 12) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
}

export async function requestPersist() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch (e) { return false; }
  }
  return false;
}
