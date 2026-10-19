/* 工具：做个决定 —— 随机转盘 */
import { toast, sheet } from '../../ui.js';

const COLORS = ['#2f6bff', '#16a37b', '#f5a623', '#f0453a', '#7b3fe4', '#0a9aa8', '#e8760c', '#3f8cff'];

let st = {
  title: '',
  options: ['吃火锅', '吃日料', '吃烧烤', '随便吃点'],
  spinning: false,
  angle: 0,
  result: '',
};

function rotateTo(angle) {
  st.angle = angle;
  const cv = document.querySelector('#wheelCanvas');
  if (!cv) return;
  drawWheel(cv.getContext('2d'), cv.width, cv.height, angle);
}

function drawWheel(ctx, w, h, angle) {
  if (!ctx) return;
  const opts = st.options.filter(Boolean);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 10;
  ctx.clearRect(0, 0, w, h);
  if (!opts.length) return;

  const n = opts.length;
  const arc = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const start = angle + i * arc;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + arc);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(11, Math.min(16, r / 9))}px system-ui, sans-serif`;
    const label = opts[i].length > 8 ? opts[i].slice(0, 8) + '…' : opts[i];
    ctx.fillText(label, r - 14, 5);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(24,39,75,.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function spin(root, back) {
  const opts = st.options.filter(Boolean);
  if (opts.length < 2) { toast('至少填两个选项', 'err'); return; }
  if (st.spinning) return;
  st.spinning = true;
  st.result = '';

  const n = opts.length;
  const arc = (Math.PI * 2) / n;
  const winner = Math.floor(Math.random() * n);
  // 让中奖扇区停在指针（顶部 -90°）位置
  const targetBase = -Math.PI / 2 - winner * arc - arc / 2;
  const turns = 6 + Math.random() * 2;
  const startAngle = st.angle;
  const endAngle = startAngle + turns * Math.PI * 2 + (targetBase - startAngle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const dur = 3200;
  const t0 = performance.now();

  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    rotateTo(startAngle + (endAngle - startAngle) * ease);
    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      st.spinning = false;
      st.result = opts[winner];
      showResult(opts[winner], root, back);
    }
  };
  requestAnimationFrame(tick);
}

function showResult(text, root, back) {
  try {
    if (window.Android && window.Android.vibrateHaptic) window.Android.vibrateHaptic();
  } catch (e) { /* ignore */ }
  sheet({
    title: st.title || '结果',
    body: `<div class="wheel-result"><span>${text}</span></div>`,
    foot: `<button class="btn ghost" data-x="1">关闭</button><button class="btn primary" data-again="1">再转一次</button>`,
    onMount(el, close) {
      el.querySelector('[data-again]').addEventListener('click', () => { close(); spin(root, back); });
    },
  });
}

export function renderWheel(root, back) {
  root.innerHTML = `
    <div class="tool-page">
      <div class="tool-bar">
        <button class="btn small ghost" data-back>← 工具</button>
        <b>做个决定</b>
      </div>

      <div class="tool-card">
        <input class="tool-input" type="text" placeholder="标题（可不填），比如：今晚吃什么" value="${st.title.replace(/"/g, '&quot;')}" data-title />
        <textarea class="tool-textarea" rows="5" placeholder="每行一个选项" data-options>${st.options.join('\n')}</textarea>
        <div class="tool-actions">
          <button class="btn primary" data-spin ${st.spinning ? 'disabled' : ''}>开始转</button>
          <button class="btn ghost" data-example>来点示例</button>
        </div>
      </div>

      <div class="wheel-wrap">
        <canvas id="wheelCanvas" width="640" height="640"></canvas>
      </div>
      <p class="hint" style="text-align:center">选项 2–8 个效果最好；转动后指针指向的就是结果。</p>
    </div>`;

  root.querySelector('[data-back]').addEventListener('click', back);

  const titleEl = root.querySelector('[data-title]');
  const optEl = root.querySelector('[data-options]');
  titleEl.addEventListener('input', () => { st.title = titleEl.value; });
  optEl.addEventListener('input', () => {
    st.options = optEl.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    rotateTo(st.angle);
  });

  root.querySelector('[data-example]').addEventListener('click', () => {
    st.options = ['吃火锅', '吃日料', '吃烧烤', '随便吃点'];
    optEl.value = st.options.join('\n');
    rotateTo(st.angle);
  });

  root.querySelector('[data-spin]').addEventListener('click', () => spin(root, back));

  const cv = root.querySelector('#wheelCanvas');
  drawWheel(cv.getContext('2d'), cv.width, cv.height, st.angle);
}
