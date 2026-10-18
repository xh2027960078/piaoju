/* 内置资源加载：单文件版从内嵌 base64 读取，多文件版从 assets/ 读取 */

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 内置报销单模板（xlsx） */
export async function loadDefaultTemplate() {
  if (window.__EMBEDDED_TEMPLATE) return b64ToArrayBuffer(window.__EMBEDDED_TEMPLATE);
  const res = await fetch('assets/template.xlsx');
  if (!res || !res.ok) throw new Error('内置模板加载失败');
  return res.arrayBuffer();
}

/** pdf.js 的 worker 地址：单文件版用内嵌 worker 生成 blob URL */
export function ensurePdfWorker() {
  if (!window.__PDF_WORKER_B64) return '';
  if (window.__PDF_WORKER_URL) return window.__PDF_WORKER_URL;
  try {
    const blob = new Blob([new Uint8Array(b64ToArrayBuffer(window.__PDF_WORKER_B64))], { type: 'application/javascript' });
    window.__PDF_WORKER_URL = URL.createObjectURL(blob);
    return window.__PDF_WORKER_URL;
  } catch (e) {
    return '';
  }
}
