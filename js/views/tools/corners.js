/* 角点微调：拍照后显示图片与四个角，拖动确认后再矫正 */
import { sheet } from '../../ui.js';

/**
 * @param {HTMLImageElement} img 原图
 * @param {Array<[number,number]>|null} initial 初始四角（原图像素坐标），null 表示用整张图
 * @param {(quad: Array<[number,number]>|null) => void} onDone
 */
export function editCorners(img, initial, onDone) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const fallback = [[0, 0], [iw - 1, 0], [iw - 1, ih - 1], [0, ih - 1]];
  const auto = !!initial;
  let quad = (initial || fallback).map((p) => [p[0], p[1]]);

  const body = `
    <div class="corner-wrap">
      <canvas id="cornerCanvas"></canvas>
      <p class="hint" style="text-align:center;margin:8px 0 0"></p>
    </div>`;

  sheet({
    title: '调整扫描区域',
    body,
    foot: '<button class="btn ghost" data-reset="1">自动识别</button><button class="btn primary" data-ok="1">确定并生成</button>',
    onMount(root, close) {
      const cv = root.querySelector('#cornerCanvas');
      const wrap = root.querySelector('.corner-wrap');
      const maxW = Math.min((wrap.clientWidth || 320) - 0, 420);
      const maxH = Math.max(260, (window.innerHeight || 720) * 0.5);
      const scale = Math.min(maxW / iw, maxH / ih, 1);
      const dw = Math.round(iw * scale);
      const dh = Math.round(ih * scale);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.style.width = dw + 'px';
      cv.style.height = dh + 'px';
      cv.width = Math.round(dw * dpr);
      cv.height = Math.round(dh * dpr);
      const ctx = cv.getContext('2d');

      const toScreen = ([x, y]) => [x * scale * dpr, y * scale * dpr];
      const toImage = (sx, sy) => [Math.max(0, Math.min(iw - 1, sx / (scale * dpr))), Math.max(0, Math.min(ih - 1, sy / (scale * dpr)))];

      const draw = () => {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const pts = quad.map(toScreen);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(47,107,255,.14)';
        ctx.fill();
        ctx.strokeStyle = '#2f6bff';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        pts.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth = 2 * dpr;
          ctx.strokeStyle = '#2f6bff';
          ctx.stroke();
        });
      };
      draw();

      let dragging = -1;
      const pos = (e) => {
        const r = cv.getBoundingClientRect();
        const t = e.touches ? e.touches[0] : e;
        return [t.clientX - r.left, t.clientY - r.top];
      };
      const onDown = (e) => {
        const [sx, sy] = pos(e);
        const x = sx * dpr;
        const y = sy * dpr;
        let best = -1;
        let bestD = Infinity;
        quad.forEach((p, i) => {
          const [px, py] = toScreen(p);
          const d = Math.hypot(px - x, py - y);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (bestD <= 28 * dpr) {
          dragging = best;
          e.preventDefault();
        }
      };
      const onMove = (e) => {
        if (dragging < 0) return;
        e.preventDefault();
        const [sx, sy] = pos(e);
        quad[dragging] = toImage(sx * dpr, sy * dpr);
        draw();
      };
      const onUp = () => { dragging = -1; };

      cv.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      cv.addEventListener('touchstart', onDown, { passive: false });
      cv.addEventListener('touchmove', onMove, { passive: false });
      cv.addEventListener('touchend', onUp);

      root.querySelector('[data-ok]').addEventListener('click', () => {
        close();
        onDone(quad.map((p) => [Math.round(p[0]), Math.round(p[1])]));
      });
      root.querySelector('[data-reset]').addEventListener('click', () => {
        close();
        onDone(null); // 交给自动检测
      });
    },
  });
}
