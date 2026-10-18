/* 外观：主题色、壁纸、图表开关 */

export const THEMES = [
  { key: 'blue', name: '经典蓝', color: '#2f6bff' },
  { key: 'teal', name: '青碧', color: '#0f9b8e' },
  { key: 'violet', name: '星紫', color: '#7c5cff' },
  { key: 'green', name: '森林绿', color: '#1f9d55' },
  { key: 'orange', name: '暖橙', color: '#e8760c' },
  { key: 'rose', name: '玫红', color: '#e0457b' },
];

export const CHART_TOGGLES = [
  { key: 'calendar', name: '每日花费日历' },
  { key: 'monthly', name: '近 6 个月花费' },
  { key: 'items', name: '费用项目占比' },
  { key: 'types', name: '发票类型占比' },
  { key: 'periods', name: '周期支出排行' },
];

export const DEFAULT_CHARTS = {
  calendar: true, monthly: true, items: true, types: true, periods: true,
};

export function applyAppearance(settings) {
  const s = settings || {};
  const theme = s.theme || 'blue';
  document.documentElement.dataset.theme = theme;

  const bg = document.getElementById('bg');
  if (bg) {
    if (s.wallpaper) {
      bg.style.backgroundImage = `url("${s.wallpaper}")`;
      document.body.classList.add('has-wallpaper');
    } else {
      bg.style.backgroundImage = '';
      document.body.classList.remove('has-wallpaper');
    }
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const t = THEMES.find((x) => x.key === theme);
    meta.setAttribute('content', t ? t.color : '#2f6bff');
  }
}

/** 把选中图片压到合适尺寸再存，避免占空间 */
export async function readWallpaper(file) {
  const max = 1600;
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
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (e) {
    return null;
  }
}
