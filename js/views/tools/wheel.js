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

/* ---------- 音效与震动 ---------- */
let audioCtx = null;
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
  return audioCtx;
}
function tick(freq) {
  const ac = ensureAudio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq || 1200;
  gain.gain.setValueAtTime(0.12, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.07);
}
function fanfare() {
  const ac = ensureAudio();
  if (!ac) return;
  [0, 0.12, 0.24].forEach((t, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = [660, 880, 1320][i];
    gain.gain.setValueAtTime(0.001, ac.currentTime + t);
    gain.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.22);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(ac.currentTime + t);
    osc.stop(ac.currentTime + t + 0.24);
  });
}
function buzz(ms, strong) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  try { if (window.Android && window.Android.vibrate) window.Android.vibrate(ms, strong ? 1 : 0); } catch (e) { /* ignore */ }
}
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

  // 指针（垂直向上，指向 12 点方向的扇区）
  const pr = Math.max(12, r * 0.09);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.lineTo(cx - pr * 0.7, cy - r - pr * 1.5);
  ctx.lineTo(cx + pr * 0.7, cy - r - pr * 1.5);
  ctx.closePath();
  ctx.fillStyle = '#ff3b59';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

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
  let lastSeg = Math.floor(st.angle / arc);

  const animate = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    const angle = startAngle + (endAngle - startAngle) * ease;
    rotateTo(angle);
    const seg = Math.floor(angle / arc);
    if (seg !== lastSeg) {
      lastSeg = seg;
      tick(1000 + Math.random() * 400);
      buzz(8, false);
    }
    if (p < 1) {
      requestAnimationFrame(animate);
    } else {
      st.spinning = false;
      st.result = opts[winner];
      fanfare();
      buzz(60, true);
      showResult(opts[winner], root, back);
    }
  };
  requestAnimationFrame(animate);
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
      const again = el.querySelector('[data-again]');
      if (again) again.addEventListener('click', () => { close(); spin(root, back); });
      const x = el.querySelector('[data-x="1"]');
      if (x) x.addEventListener('click', (ev) => { ev.preventDefault(); close(); });
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
