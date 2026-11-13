/* 娱乐页签：扫雷 / 2048（纯本地，离线可玩，带成就与音效） */
import { toast, sheet } from '../ui.js';
import { rerender } from '../render.js';
import { track } from '../telemetry.js';

let screen = 'menu'; // menu | mine | g2048

/* ---------------- 音效（WebAudio 合成，无需音频文件，离线可用） ---------------- */
let audioCtx = null;
let soundTimer = [];

function soundOn() {
  try { return localStorage.getItem('pj-game-sound') !== '0'; } catch (e) { return true; }
}
function setSound(on) {
  try { localStorage.setItem('pj-game-sound', on ? '1' : '0'); } catch (e) { /* ignore */ }
}

function tone(freq, dur = 0.08, type = 'sine', vol = 0.06) {
  if (!soundOn()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (e) { /* 静默失败 */ }
}

function seq(freqs, gap = 90, dur = 0.12, vol = 0.06) {
  freqs.forEach((f, i) => {
    soundTimer.push(setTimeout(() => tone(f, dur, 'sine', vol), i * gap));
  });
}

const SFX = {
  open: () => tone(520, 0.05, 'triangle', 0.05),
  flag: () => tone(760, 0.06, 'square', 0.04),
  boom: () => { tone(120, 0.4, 'sawtooth', 0.12); },
  win: () => seq([523, 659, 784, 1046]),
  merge: () => tone(880, 0.06, 'sine', 0.05),
  over: () => seq([440, 330, 220], 120, 0.16, 0.07),
  achievement: () => seq([880, 1174, 1568], 80, 0.14, 0.07),
};

/* ---------------- 成就 ---------------- */
const ACH = {
  mine: [
    { id: 'first_win', name: '初次通关', desc: '任意难度通关一次' },
    { id: 'fast10', name: '手速惊人', desc: '初级 10 秒内通关' },
    { id: 'noflag', name: '全靠推理', desc: '一次都不插旗通关' },
    { id: 'hard', name: '排雷专家', desc: '高级难度通关' },
    { id: 'streak3', name: '三连胜', desc: '连续通关 3 局' },
  ],
  g2048: [
    { id: 't256', name: '小有所成', desc: '合成 256' },
    { id: 't512', name: '渐入佳境', desc: '合成 512' },
    { id: 't1024', name: '一步之遥', desc: '合成 1024' },
    { id: 't2048', name: '达成 2048', desc: '合成 2048' },
    { id: 't4096', name: '超越极限', desc: '合成 4096' },
    { id: 'score5000', name: '高分选手', desc: '单局得分超过 5000' },
  ],
  tetris: [
    { id: 'clear1', name: '开张', desc: '消掉第一行' },
    { id: 'clear4', name: '四连消', desc: '一次消掉 4 行' },
    { id: 'level5', name: '越战越勇', desc: '达到 5 级' },
    { id: 'score1000', name: '千分达成', desc: '单局得分达到 1000' },
  ],
  snake: [
    { id: 'eat10', name: '食不厌精', desc: '一局吃到 10 个食物' },
    { id: 'len20', name: '长蛇阵', desc: '蛇身长度达到 20 节' },
    { id: 'score100', name: '百分选手', desc: '单局得分达到 100' },
  ],
};

function achGet(game) {
  try { return JSON.parse(localStorage.getItem('pj-ach-' + game) || '[]'); } catch (e) { return []; }
}

function achUnlock(game, id) {
  const list = achGet(game);
  if (list.includes(id)) return false;
  list.push(id);
  try { localStorage.setItem('pj-ach-' + game, JSON.stringify(list)); } catch (e) { /* ignore */ }
  const def = (ACH[game] || []).find((a) => a.id === id);
  if (def) {
    setTimeout(() => {
      toast('🏆 成就解锁：' + def.name, 'ok');
      SFX.achievement();
    }, 260);
  }
  return true;
}

function achCount(game) {
  return achGet(game).length + '/' + (ACH[game] || []).length;
}

function openAchSheet(game, title) {
  const got = achGet(game);
  const rows = (ACH[game] || []).map((a) => `
    <div class="kv">
      <span class="k">${got.includes(a.id) ? '🏆' : '🔒'} ${a.name}</span>
      <span class="v" style="text-align:right;font-size:12px;color:var(--text-3)">${a.desc}</span>
    </div>`).join('');
  sheet({ title: title + ' · 成就 ' + achCount(game), body: rows, foot: '<button class="btn primary" data-x="1">知道了</button>' });
}

/* ---------------- 游玩时长统计 ---------------- */
let playStart = 0;
let playGame = '';

function startPlay(game) {
  flushPlay();
  playGame = game;
  playStart = Date.now();
}

function flushPlay() {
  if (!playStart) return;
  const secs = Math.round((Date.now() - playStart) / 1000);
  const game = playGame;
  playStart = 0;
  playGame = '';
  if (secs >= 5) track('game_play', { game, seconds: secs });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPlay();
    else if (screen === 'mine' || screen === 'g2048' || screen === 'snake' || screen === 'tetris') startPlay(screen);
  });
}

/* ---------------- 菜单 ---------------- */
export function resetGames() {
  try { clearInterval(snakeTimer); } catch (e) { /* ignore */ }
  try { clearInterval(tetrisTimer); } catch (e) { /* ignore */ }
  snakeTimer = null;
  tetrisTimer = null;
  screen = 'menu';
}

export function renderGames(root) {
  if (screen !== 'mine') { clearInterval(mineTimer); mineTimer = null; }
  if (screen !== 'snake') { clearInterval(snakeTimer); snakeTimer = null; }
  if (screen !== 'tetris') { clearInterval(tetrisTimer); tetrisTimer = null; }
  if (screen === 'mine') return renderMine(root);
  if (screen === 'g2048') return render2048(root);
  if (screen === 'snake') return renderSnake(root);
  if (screen === 'tetris') return renderTetris(root);

  flushPlay();
  root.innerHTML = `
    <div class="game-menu">
      <button class="game-card" data-game="mine">
        <span class="game-emoji">💣</span>
        <span class="game-info">
          <b>扫雷</b>
          <em>点开格子，长按插旗，别踩到雷</em>
          <em style="color:var(--primary)">🏆 成就 ${achCount('mine')}${mineBest() ? ' · 最快 ' + mineBest() + ' 秒' : ''}</em>
        </span>
      </button>
      <button class="game-card" data-game="g2048">
        <span class="game-emoji">🔢</span>
        <span class="game-info">
          <b>2048</b>
          <em>滑动合并数字，凑出 2048</em>
          <em style="color:var(--primary)">🏆 成就 ${achCount('g2048')}${best2048() ? ' · 最高 ' + best2048() + ' 分' : ''}</em>
        </span>
      </button>
      <button class="game-card" data-game="snake">
        <span class="game-emoji">🐍</span>
        <span class="game-info">
          <b>贪吃蛇</b>
          <em>滑动转向，吃掉方块别撞墙</em>
          <em style="color:var(--primary)">🏆 成就 ${achCount('snake')}${snakeBest() ? ' · 最高 ' + snakeBest() + ' 分' : ''}</em>
        </span>
      </button>
      <button class="game-card" data-game="tetris">
        <span class="game-emoji">🧱</span>
        <span class="game-info">
          <b>俄罗斯方块</b>
          <em>左右移动，旋转下落，消满一行</em>
          <em style="color:var(--primary)">🏆 成就 ${achCount('tetris')}${tetrisBest() ? ' · 最高 ' + tetrisBest() + ' 分' : ''}</em>
        </span>
      </button>
      <p class="hint" style="margin:14px 4px 0">四个小游戏都在本地运行，不联网也能玩；成绩和成就只存在这台设备上。</p>
    </div>`;

  root.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', () => {
    screen = b.dataset.game === 'mine' ? 'mine' : b.dataset.game === 'snake' ? 'snake' : (b.dataset.game === 'tetris' ? 'tetris' : 'g2048');
    startPlay(screen);
    track('game_open', { game: screen });
    rerender();
  }));
}

/* ---------------- 扫雷 ---------------- */
const MINE_LEVELS = {
  easy: { cols: 9, rows: 9, mines: 10, label: '初级' },
  mid: { cols: 12, rows: 12, mines: 24, label: '中级' },
  hard: { cols: 16, rows: 16, mines: 45, label: '高级' },
};

let mine = null;
let mineTimer = null;
let pressTimer = null;

function mineBest() {
  try { return localStorage.getItem('pj-mine-best') || ''; } catch (e) { return ''; }
}

function newMine(levelKey) {
  const lv = MINE_LEVELS[levelKey] || MINE_LEVELS.easy;
  mine = {
    levelKey: lv.key || levelKey,
    lv,
    cells: new Array(lv.cols * lv.rows).fill(0),
    open: new Array(lv.cols * lv.rows).fill(false),
    flag: new Array(lv.cols * lv.rows).fill(false),
    started: false,
    over: false,
    win: false,
    flagMode: false,
    usedFlag: false,
    seconds: 0,
  };
}

function idx(x, y) { return y * mine.lv.cols + x; }

function neighbors(i) {
  const x = i % mine.lv.cols;
  const y = Math.floor(i / mine.lv.cols);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= mine.lv.cols || ny >= mine.lv.rows) continue;
      out.push(idx(nx, ny));
    }
  }
  return out;
}

function plant(safeIndex) {
  const total = mine.lv.cols * mine.lv.rows;
  const banned = new Set([safeIndex, ...neighbors(safeIndex)]);
  const pool = [];
  for (let i = 0; i < total; i++) if (!banned.has(i)) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let k = 0; k < Math.min(mine.lv.mines, pool.length); k++) mine.cells[pool[k]] = -1;
  for (let i = 0; i < total; i++) {
    if (mine.cells[i] === -1) continue;
    mine.cells[i] = neighbors(i).filter((n) => mine.cells[n] === -1).length;
  }
}

function openCell(i) {
  if (mine.open[i] || mine.flag[i] || mine.over) return;
  const stack = [i];
  while (stack.length) {
    const cur = stack.pop();
    if (mine.open[cur] || mine.flag[cur]) continue;
    mine.open[cur] = true;
    if (mine.cells[cur] === 0) {
      neighbors(cur).forEach((n) => { if (!mine.open[n] && !mine.flag[n]) stack.push(n); });
    }
  }
}

function mineStreak() {
  try { return Number(localStorage.getItem('pj-mine-streak') || 0); } catch (e) { return 0; }
}
function setMineStreak(n) {
  try { localStorage.setItem('pj-mine-streak', String(n)); } catch (e) { /* ignore */ }
}

function checkWin() {
  const total = mine.lv.cols * mine.lv.rows;
  let opened = 0;
  for (let i = 0; i < total; i++) if (mine.open[i]) opened++;
  if (opened === total - mine.lv.mines) {
    mine.over = true;
    mine.win = true;
    clearInterval(mineTimer);
    mineTimer = null;
    const t = mine.seconds;
    const best = Number(mineBest() || 0);
    if (!best || t < best) {
      try { localStorage.setItem('pj-mine-best', String(t)); } catch (e) { /* ignore */ }
    }
    achUnlock('mine', 'first_win');
    if (mine.levelKey === 'easy' && t <= 10) achUnlock('mine', 'fast10');
    if (!mine.usedFlag) achUnlock('mine', 'noflag');
    if (mine.levelKey === 'hard') achUnlock('mine', 'hard');
    const streak = mineStreak() + 1;
    setMineStreak(streak);
    if (streak >= 3) achUnlock('mine', 'streak3');
    SFX.win();
    return true;
  }
  return false;
}

function startMineTimer() {
  if (mineTimer || !mine || mine.over) return;
  mineTimer = setInterval(() => {
    if (!mine || mine.over) return;
    mine.seconds++;
    const el = document.querySelector('#mineTime');
    if (el) el.textContent = String(mine.seconds);
  }, 1000);
}

function renderMine(root) {
  if (!mine) newMine('easy');
  const lv = mine.lv;
  const flags = mine.flag.filter(Boolean).length;
  const mineLeft = Math.max(0, lv.mines - flags);

  root.innerHTML = `
    <div class="game-head">
      <button class="btn small ghost" data-back>← 返回</button>
      <div class="game-stats">
        <span>💣 <b id="mineLeft">${mineLeft}</b></span>
        <span>⏱ <b id="mineTime">${mine.seconds}</b></span>
      </div>
      <div class="game-tools">
        <button class="btn small ghost" data-sound>${soundOn() ? '🔊' : '🔇'}</button>
        <button class="btn small ghost" data-ach>🏆</button>
      </div>
    </div>
    <div class="game-levels">
      ${Object.keys(MINE_LEVELS).map((k) => `<button class="chip-btn ${mine.levelKey === k ? 'on' : ''}" data-level="${k}">${MINE_LEVELS[k].label} ${MINE_LEVELS[k].cols}×${MINE_LEVELS[k].rows}</button>`).join('')}
      <button class="chip-btn" data-restart>重新开始</button>
      <button class="chip-btn ${mine.flagMode ? 'on' : ''}" data-flagmode>插旗</button>
    </div>
    <div class="mine-board" id="mineBoard" style="--cols:${lv.cols}">
      ${Array.from({ length: lv.cols * lv.rows }, (_, i) => {
        const opened = mine.open[i];
        const isMine = mine.cells[i] === -1;
        const cls = ['mine-cell'];
        if (opened) cls.push('open');
        if (opened && isMine) cls.push('boom');
        if (mine.flag[i]) cls.push('flag');
        const n = mine.cells[i];
        const label = mine.flag[i] ? '🚩' : (opened ? (isMine ? '💣' : (n > 0 ? n : '')) : '');
        const numCls = opened && !isMine && n > 0 ? ` n${n}` : '';
        return `<button class="${cls.join(' ')}${numCls}" data-i="${i}">${label}</button>`;
      }).join('')}
    </div>
    <p class="hint" style="text-align:center;margin-top:12px">点格子打开；长按（或用「插旗」）标记</p>`;

  const board = root.querySelector('#mineBoard');
  root.querySelector('[data-back]').addEventListener('click', () => { flushPlay(); screen = 'menu'; rerender(); });
  root.querySelector('[data-restart]').addEventListener('click', () => { newMine(mine.levelKey); rerender(); });
  root.querySelector('[data-flagmode]').addEventListener('click', () => { mine.flagMode = !mine.flagMode; rerender(); });
  root.querySelector('[data-sound]').addEventListener('click', () => { setSound(!soundOn()); rerender(); });
  root.querySelector('[data-ach]').addEventListener('click', () => openAchSheet('mine', '扫雷'));
  root.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    newMine(b.dataset.level);
    rerender();
  }));

  const tap = (i) => {
    if (mine.over) return;
    if (!mine.started) { mine.started = true; plant(i); startMineTimer(); }
    if (mine.flagMode || mine.flag[i]) {
      mine.flag[i] = !mine.flag[i];
      mine.usedFlag = true;
      SFX.flag();
      rerender();
      return;
    }
    if (mine.cells[i] === -1) {
      mine.open[i] = true;
      mine.over = true;
      clearInterval(mineTimer);
      mineTimer = null;
      SFX.boom();
      setMineStreak(0);
      rerender();
      toast('踩到雷了，再来一局', 'err');
      return;
    }
    openCell(i);
    if (checkWin()) {
      toast('通关！用时 ' + mine.seconds + ' 秒', 'ok');
    } else {
      SFX.open();
    }
    rerender();
  };

  const toggleFlag = (i) => {
    if (mine.over || mine.open[i]) return;
    mine.flag[i] = !mine.flag[i];
    mine.usedFlag = true;
    SFX.flag();
    rerender();
  };

  board.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    if (b.dataset.longpress === '1') { b.dataset.longpress = '0'; return; }
    tap(Number(b.dataset.i));
  });

  board.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    pressTimer = setTimeout(() => {
      b.dataset.longpress = '1';
      toggleFlag(Number(b.dataset.i));
    }, 420);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    board.addEventListener(ev, () => clearTimeout(pressTimer));
  });
  board.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    e.preventDefault();
    toggleFlag(Number(b.dataset.i));
  });

  if (mine.started && !mine.over) startMineTimer();

  if (mine.over) {
    root.querySelectorAll('.mine-cell').forEach((el) => {
      const i = Number(el.dataset.i);
      if (mine.cells[i] === -1 && !el.classList.contains('open')) {
        el.classList.add('revealed');
        el.textContent = '💣';
      }
    });
  }
}

/* ---------------- 2048 ---------------- */
const G2048_KEY = 'pj-2048-state';
let b2048 = null;
let score2048 = 0;
let won2048 = false;

function best2048() {
  try { return Number(localStorage.getItem('pj-2048-best') || 0) || 0; } catch (e) { return 0; }
}

function save2048() {
  try {
    localStorage.setItem(G2048_KEY, JSON.stringify({ board: b2048, score: score2048, won: won2048 }));
  } catch (e) { /* ignore */ }
}

function load2048() {
  try {
    const raw = localStorage.getItem(G2048_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.board) || s.board.length !== 4) return false;
    b2048 = s.board;
    score2048 = Number(s.score) || 0;
    won2048 = !!s.won;
    return true;
  } catch (e) { return false; }
}

function empty2048() {
  return Array.from({ length: 4 }, () => new Array(4).fill(0));
}

function start2048() {
  b2048 = empty2048();
  score2048 = 0;
  won2048 = false;
  addTile2048();
  addTile2048();
  save2048();
}

function addTile2048() {
  const spots = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (!b2048[y][x]) spots.push([x, y]);
  if (!spots.length) return;
  const [x, y] = spots[Math.floor(Math.random() * spots.length)];
  b2048[y][x] = Math.random() < 0.9 ? 2 : 4;
}

function slideRow(row) {
  const vals = row.filter((v) => v);
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) { out.push(vals[i] * 2); i++; } else out.push(vals[i]);
  }
  while (out.length < 4) out.push(0);
  return out;
}

function maxTile2048() {
  let m = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) m = Math.max(m, b2048[y][x]);
  return m;
}

function move2048(dir) {
  const before = JSON.stringify(b2048);
  if (dir === 'left' || dir === 'right') {
    for (let y = 0; y < 4; y++) {
      let row = b2048[y].slice();
      if (dir === 'right') row.reverse();
      row = slideRow(row);
      if (dir === 'right') row.reverse();
      b2048[y] = row;
    }
  } else {
    for (let x = 0; x < 4; x++) {
      let col = [b2048[0][x], b2048[1][x], b2048[2][x], b2048[3][x]];
      if (dir === 'down') col.reverse();
      col = slideRow(col);
      if (dir === 'down') col.reverse();
      for (let y = 0; y < 4; y++) b2048[y][x] = col[y];
    }
  }
  const after = JSON.stringify(b2048);
  if (before !== after) {
    addTile2048();
    const s = score2048Now();
    if (s > best2048()) {
      try { localStorage.setItem('pj-2048-best', String(s)); } catch (e) { /* ignore */ }
    }
    save2048();
    SFX.merge();

    const max = maxTile2048();
    if (max >= 256) achUnlock('g2048', 't256');
    if (max >= 512) achUnlock('g2048', 't512');
    if (max >= 1024) achUnlock('g2048', 't1024');
    if (max >= 2048) achUnlock('g2048', 't2048');
    if (max >= 4096) achUnlock('g2048', 't4096');
    if (s > 5000) achUnlock('g2048', 'score5000');
    if (max >= 2048 && !won2048) {
      won2048 = true;
      save2048();
      toast('达成 2048！可以继续挑战更高分', 'ok');
    }
    if (!canMove2048()) {
      SFX.over();
      toast('没有可移动的方块了，试试新开一局', 'err');
    }
  }
  return before !== after;
}

function canMove2048() {
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if (!b2048[y][x]) return true;
      if (x < 3 && b2048[y][x] === b2048[y][x + 1]) return true;
      if (y < 3 && b2048[y][x] === b2048[y + 1][x]) return true;
    }
  }
  return false;
}

function score2048Now() {
  let s = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += b2048[y][x];
  return s;
}

function render2048(root) {
  if (!b2048 && !load2048()) start2048();

  root.innerHTML = `
    <div class="game-head">
      <button class="btn small ghost" data-back>← 返回</button>
      <div class="game-stats">
        <span>分数 <b id="gScore">${score2048Now()}</b></span>
        <span>最高 <b id="gBest">${best2048()}</b></span>
      </div>
      <div class="game-tools">
        <button class="btn small ghost" data-sound>${soundOn() ? '🔊' : '🔇'}</button>
        <button class="btn small ghost" data-ach>🏆</button>
      </div>
    </div>
    <div class="g2048-board" id="gBoard">
      ${b2048.map((row) => row.map((v) => `<div class="g-cell ${v ? 'v' + Math.min(v, 4096) : ''}">${v || ''}</div>`).join('')).join('')}
    </div>
    <div class="game-levels" style="margin-top:12px;justify-content:center">
      <button class="chip-btn" data-new>新开一局</button>
    </div>
    <p class="hint" style="text-align:center;margin-top:8px">在棋盘上滑动合并相同数字（电脑可用方向键）</p>`;

  const board = root.querySelector('#gBoard');
  root.querySelector('[data-back]').addEventListener('click', () => { flushPlay(); screen = 'menu'; rerender(); });
  root.querySelector('[data-new]').addEventListener('click', () => { start2048(); rerender(); });
  root.querySelector('[data-sound]').addEventListener('click', () => { setSound(!soundOn()); rerender(); });
  root.querySelector('[data-ach]').addEventListener('click', () => openAchSheet('g2048', '2048'));

  let sx = 0, sy = 0;
  board.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  board.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (move2048(dir)) rerender();
  });

  board.addEventListener('mousedown', (e) => { sx = e.clientX; sy = e.clientY; });
  board.addEventListener('mouseup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (move2048(dir)) rerender();
  });
}


/* ---------------- 贪吃蛇 ---------------- */
const SNAKE_N = 16;
let snakeState = null;
let snakeTimer = null;
let snakeCanvas = null;

function snakeBest() {
  try { return Number(localStorage.getItem('pj-snake-best') || 0) || 0; } catch (e) { return 0; }
}
function setSnakeBest(v) {
  try { localStorage.setItem('pj-snake-best', String(v)); } catch (e) { /* ignore */ }
}

function snakeFood() {
  const free = [];
  for (let y = 0; y < SNAKE_N; y++) {
    for (let x = 0; x < SNAKE_N; x++) {
      if (!snakeState.body.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

function newSnake() {
  const mid = Math.floor(SNAKE_N / 2);
  snakeState = {
    body: [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }],
    dir: 'right',
    next: 'right',
    food: null,
    score: 0,
    eaten: 0,
    over: false,
    paused: false,
    speed: 175,
  };
  snakeState.food = snakeFood();
  startSnakeLoop();
}

function startSnakeLoop() {
  clearInterval(snakeTimer);
  if (!snakeState || snakeState.over) return;
  snakeTimer = setInterval(() => {
    if (!snakeState || snakeState.over) { clearInterval(snakeTimer); snakeTimer = null; return; }
    if (snakeState.paused) return;
    snakeStep();
    paintSnake();
  }, snakeState.speed);
}

function snakeStep() {
  const s = snakeState;
  s.dir = s.next;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.dir];
  if (!d) return;
  const head = { x: s.body[0].x + d[0], y: s.body[0].y + d[1] };
  const hitWall = head.x < 0 || head.y < 0 || head.x >= SNAKE_N || head.y >= SNAKE_N;
  const hitSelf = s.body.some((seg, i) => i < s.body.length - 1 && seg.x === head.x && seg.y === head.y);

  if (hitWall || hitSelf) {
    s.over = true;
    clearInterval(snakeTimer);
    snakeTimer = null;
    const best = snakeBest();
    if (s.score > best) {
      setSnakeBest(s.score);
      toast('新纪录 ' + s.score + ' 分！', 'ok');
    } else {
      toast('撞上了，得分 ' + s.score, 'err');
    }
    SFX.over();
    rerender();
    return;
  }

  s.body.unshift(head);
  if (s.food && head.x === s.food.x && head.y === s.food.y) {
    s.score += 10;
    s.eaten += 1;
    SFX.merge();
    if (s.eaten >= 10) achUnlock('snake', 'eat10');
    if (s.body.length >= 20) achUnlock('snake', 'len20');
    if (s.score >= 100) achUnlock('snake', 'score100');
    s.food = snakeFood();
    if (s.speed > 90) { s.speed -= 6; startSnakeLoop(); }
  } else {
    s.body.pop();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintSnake() {
  const cv = snakeCanvas;
  if (!cv || !cv.isConnected || !snakeState) return;
  let ctx = null;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return;

  const size = cv.width;
  const cell = size / SNAKE_N;
  ctx.clearRect(0, 0, size, size);
  for (let y = 0; y < SNAKE_N; y++) {
    for (let x = 0; x < SNAKE_N; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#f4f7fd' : '#e9eefb';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  if (snakeState.food) {
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath();
    ctx.arc((snakeState.food.x + 0.5) * cell, (snakeState.food.y + 0.5) * cell, cell * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  snakeState.body.forEach((seg, i) => {
    ctx.fillStyle = i === 0 ? '#2f6bff' : '#5b8cff';
    roundRect(ctx, seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2, cell * 0.14);
    ctx.fill();
  });

  const scoreEl = document.querySelector('#snScore');
  if (scoreEl) scoreEl.textContent = String(snakeState.score);
}

function turnSnake(dir) {
  if (!snakeState || snakeState.over) return;
  const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (opposite[dir] === snakeState.dir) return; // 不能直接反向
  snakeState.next = dir;
}

function renderSnake(root) {
  if (!snakeState) newSnake();
  const paused = snakeState.paused;

  root.innerHTML = `
    <div class="game-head">
      <button class="btn small ghost" data-back>← 返回</button>
      <div class="game-stats">
        <span>得分 <b id="snScore">${snakeState.score}</b></span>
        <span>最高 <b id="snBest">${snakeBest()}</b></span>
      </div>
      <div class="game-tools">
        <button class="btn small ghost" data-sound>${soundOn() ? '🔊' : '🔇'}</button>
        <button class="btn small ghost" data-ach>🏆</button>
      </div>
    </div>
    <div class="snake-wrap">
      <canvas id="snakeCanvas" class="snake-canvas"></canvas>
      ${snakeState.over ? '<div class="snake-mask"><b>撞上了</b><span>得分 ' + snakeState.score + ' 分</span><button class="btn primary" data-again>再来一局</button></div>' : ''}
      ${paused && !snakeState.over ? '<div class="snake-mask"><b>已暂停</b><button class="btn primary" data-resume>继续</button></div>' : ''}
    </div>
    <div class="snake-pad">
      <button class="pad-btn up" data-dir="up">▲</button>
      <button class="pad-btn left" data-dir="left">◀</button>
      <button class="pad-btn mid" data-pause>${paused ? '▶' : '⏸'}</button>
      <button class="pad-btn right" data-dir="right">▶</button>
      <button class="pad-btn down" data-dir="down">▼</button>
    </div>
    <p class="hint" style="text-align:center;margin-top:10px">滑动屏幕或点方向键转向，中间按钮暂停</p>`;

  const cv = root.querySelector('#snakeCanvas');
  const box = root.querySelector('.snake-wrap');
  const cssSize = Math.max(220, Math.min((box && box.clientWidth) || root.clientWidth - 8 || 300, 420));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.style.width = cssSize + 'px';
  cv.style.height = cssSize + 'px';
  cv.width = Math.floor(cssSize * dpr);
  cv.height = Math.floor(cssSize * dpr);
  snakeCanvas = cv;
  paintSnake();

  root.querySelector('[data-back]').addEventListener('click', () => {
    clearInterval(snakeTimer);
    snakeTimer = null;
    flushPlay();
    screen = 'menu';
    rerender();
  });
  root.querySelector('[data-sound]').addEventListener('click', () => { setSound(!soundOn()); rerender(); });
  root.querySelector('[data-ach]').addEventListener('click', () => openAchSheet('snake', '贪吃蛇'));
  root.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => turnSnake(b.dataset.dir)));
  root.querySelector('[data-pause]').addEventListener('click', () => {
    snakeState.paused = !snakeState.paused;
    rerender();
  });
  const again = root.querySelector('[data-again]');
  if (again) again.addEventListener('click', () => { newSnake(); rerender(); });
  const resume = root.querySelector('[data-resume]');
  if (resume) resume.addEventListener('click', () => { snakeState.paused = false; rerender(); });

  // 滑动转向
  let sx = 0, sy = 0;
  cv.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  cv.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    turnSnake(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });
  cv.addEventListener('mousedown', (e) => { sx = e.clientX; sy = e.clientY; });
  cv.addEventListener('mouseup', (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    turnSnake(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });

  if (snakeState.over) { clearInterval(snakeTimer); snakeTimer = null; }
  else startSnakeLoop();
}

/* ---------------- 俄罗斯方块 ---------------- */
const T_COLS = 10;
const T_ROWS = 20;
const T_SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
};
const T_COLORS = { I: '#38bdf8', O: '#fbbf24', T: '#a78bfa', S: '#34d399', Z: '#fb7185', J: '#60a5fa', L: '#fb923c' };

let tetris = null;
let tetrisTimer = null;
let tetrisCanvas = null;

function tetrisBest() {
  try { return Number(localStorage.getItem('pj-tetris-best') || 0) || 0; } catch (e) { return 0; }
}
function setTetrisBest(v) {
  try { localStorage.setItem('pj-tetris-best', String(v)); } catch (e) { /* ignore */ }
}

function tRandPiece() {
  const keys = Object.keys(T_SHAPES);
  return keys[Math.floor(Math.random() * keys.length)];
}

function tMatrix(key) {
  return T_SHAPES[key].map((row) => row.slice());
}

function newTetris() {
  tetris = {
    board: Array.from({ length: T_ROWS }, () => new Array(T_COLS).fill('')),
    cur: null,
    next: tRandPiece(),
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    paused: false,
    speed: 620,
  };
  tSpawn();
  startTetrisLoop();
}

function tSpawn() {
  const key = tetris.next;
  tetris.next = tRandPiece();
  const m = tMatrix(key);
  const piece = { key, m, x: Math.floor((T_COLS - m[0].length) / 2), y: 0 };
  tetris.cur = piece;
  if (tCollide(piece, 0, 0)) {
    tetris.over = true;
    clearInterval(tetrisTimer);
    tetrisTimer = null;
    const best = tetrisBest();
    if (tetris.score > best) {
      setTetrisBest(tetris.score);
      toast('新纪录 ' + tetris.score + ' 分！', 'ok');
    } else {
      toast('Game Over，得分 ' + tetris.score, 'err');
    }
    SFX.over();
    rerender();
  }
}

function tCollide(piece, dx, dy, matrix) {
  const m = matrix || piece.m;
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (!m[y][x]) continue;
      const nx = piece.x + x + dx;
      const ny = piece.y + y + dy;
      if (nx < 0 || nx >= T_COLS || ny >= T_ROWS) return true;
      if (ny >= 0 && tetris.board[ny][nx]) return true;
    }
  }
  return false;
}

function tRotate() {
  const p = tetris.cur;
  if (!p) return;
  const m = p.m;
  const rot = m[0].map((_, i) => m.map((row) => row[i]).reverse());
  if (!tCollide(p, 0, 0, rot)) {
    p.m = rot;
    SFX.open();
  } else if (!tCollide(p, -1, 0, rot)) {
    p.x -= 1;
    p.m = rot;
    SFX.open();
  } else if (!tCollide(p, 1, 0, rot)) {
    p.x += 1;
    p.m = rot;
    SFX.open();
  }
}

function tMove(dx) {
  const p = tetris.cur;
  if (!p || tetris.over || tetris.paused) return;
  if (!tCollide(p, dx, 0)) {
    p.x += dx;
    SFX.open();
    paintTetris();
  }
}

function tSoftDrop() {
  const p = tetris.cur;
  if (!p || tetris.over || tetris.paused) return;
  if (!tCollide(p, 0, 1)) {
    p.y += 1;
    paintTetris();
  } else {
    tLock();
  }
}

function tHardDrop() {
  const p = tetris.cur;
  if (!p || tetris.over || tetris.paused) return;
  while (!tCollide(p, 0, 1)) p.y += 1;
  tLock();
}

function tLock() {
  const p = tetris.cur;
  const color = T_COLORS[p.key];
  for (let y = 0; y < p.m.length; y++) {
    for (let x = 0; x < p.m[y].length; x++) {
      if (!p.m[y][x]) continue;
      const ny = p.y + y;
      const nx = p.x + x;
      if (ny >= 0 && ny < T_ROWS && nx >= 0 && nx < T_COLS) tetris.board[ny][nx] = color;
    }
  }
  // 消行
  let cleared = 0;
  for (let y = T_ROWS - 1; y >= 0; y--) {
    if (tetris.board[y].every((c) => c)) {
      tetris.board.splice(y, 1);
      tetris.board.unshift(new Array(T_COLS).fill(''));
      cleared++;
      y++;
    }
  }
  if (cleared) {
    const gain = [0, 100, 300, 500, 800][cleared] * tetris.level;
    tetris.score += gain;
    tetris.lines += cleared;
    if (cleared >= 1) achUnlock('tetris', 'clear1');
    if (cleared >= 4) achUnlock('tetris', 'clear4');
    const lv = Math.floor(tetris.lines / 10) + 1;
    if (lv !== tetris.level) {
      tetris.level = lv;
      tetris.speed = Math.max(120, 620 - (lv - 1) * 60);
      startTetrisLoop();
    }
    if (tetris.level >= 5) achUnlock('tetris', 'level5');
    if (tetris.score >= 1000) achUnlock('tetris', 'score1000');
    const best = tetrisBest();
    if (tetris.score > best) setTetrisBest(tetris.score);
    SFX.win();
  }
  tSpawn();
  paintTetris();
}

function startTetrisLoop() {
  clearInterval(tetrisTimer);
  if (!tetris || tetris.over) return;
  tetrisTimer = setInterval(() => {
    if (!tetris || tetris.over) { clearInterval(tetrisTimer); tetrisTimer = null; return; }
    if (tetris.paused) return;
    const p = tetris.cur;
    if (!p) return;
    if (!tCollide(p, 0, 1)) {
      p.y += 1;
    } else {
      tLock();
    }
    paintTetris();
  }, tetris.speed);
}

function paintTetris() {
  const cv = tetrisCanvas;
  if (!cv || !cv.isConnected || !tetris) return;
  let ctx = null;
  try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return;

  const cell = cv.width / T_COLS;
  ctx.clearRect(0, 0, cv.width, cv.height);
  // 背景网格
  for (let y = 0; y < T_ROWS; y++) {
    for (let x = 0; x < T_COLS; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#f6f8fd' : '#eef2fb';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const drawCell = (x, y, color) => {
    ctx.fillStyle = color;
    roundRect(ctx, x * cell + 1, y * cell + 1, cell - 2, cell - 2, cell * 0.16);
    ctx.fill();
  };
  // 已落下的方块
  for (let y = 0; y < T_ROWS; y++) {
    for (let x = 0; x < T_COLS; x++) {
      if (tetris.board[y][x]) drawCell(x, y, tetris.board[y][x]);
    }
  }
  // 当前方块
  const p = tetris.cur;
  if (p) {
    for (let y = 0; y < p.m.length; y++) {
      for (let x = 0; x < p.m[y].length; x++) {
        if (p.m[y][x] && p.y + y >= 0) drawCell(p.x + x, p.y + y, T_COLORS[p.key]);
      }
    }
  }
  const s = document.querySelector('#tScore');
  if (s) s.textContent = String(tetris.score);
  const l = document.querySelector('#tLines');
  if (l) l.textContent = String(tetris.lines);
}

function renderTetris(root) {
  if (!tetris) newTetris();

  root.innerHTML = `
    <div class="game-head">
      <button class="btn small ghost" data-back>← 返回</button>
      <div class="game-stats">
        <span>分数 <b id="tScore">${tetris.score}</b></span>
        <span>消行 <b id="tLines">${tetris.lines}</b></span>
      </div>
      <div class="game-tools">
        <button class="btn small ghost" data-sound>${soundOn() ? '🔊' : '🔇'}</button>
        <button class="btn small ghost" data-ach>🏆</button>
      </div>
    </div>
    <div class="snake-wrap">
      <canvas id="tetrisCanvas" class="snake-canvas"></canvas>
      ${tetris.over ? '<div class="snake-mask"><b>结束了</b><span>得分 ' + tetris.score + ' 分</span><button class="btn primary" data-again>再来一局</button></div>' : ''}
      ${tetris.paused && !tetris.over ? '<div class="snake-mask"><b>已暂停</b><button class="btn primary" data-resume>继续</button></div>' : ''}
    </div>
    <div class="t-pad">
      <button class="t-btn" data-t="left">◀<span>左移</span></button>
      <button class="t-btn" data-t="rotate">↻<span>旋转</span></button>
      <button class="t-btn" data-t="right">▶<span>右移</span></button>
      <button class="t-btn" data-t="down">▼<span>下落</span></button>
      <button class="t-btn wide" data-t="drop">⤓<span>直落到底</span></button>
      <button class="t-btn" data-t="pause">${tetris.paused ? '▶' : '⏸'}<span>${tetris.paused ? '继续' : '暂停'}</span></button>
    </div>
    <p class="hint" style="text-align:center;margin-top:10px">全部用下方按钮操作，不会误触</p>`;

  const cv = root.querySelector('#tetrisCanvas');
  const box = root.querySelector('.snake-wrap');
  // 画布高度按屏幕可用空间收缩，保证底部按钮不被挤出屏幕
  const maxW = Math.max(160, Math.min((box && box.clientWidth) || root.clientWidth - 8 || 260, 300));
  const availH = Math.max(280, (window.innerHeight || 720) - 320);
  const cssH = Math.min(maxW * (T_ROWS / T_COLS), availH);
  const cssW = cssH / (T_ROWS / T_COLS);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  cv.width = Math.floor(cssW * dpr);
  cv.height = Math.floor(cssH * dpr);
  tetrisCanvas = cv;
  paintTetris();

  root.querySelector('[data-back]').addEventListener('click', () => {
    clearInterval(tetrisTimer);
    tetrisTimer = null;
    flushPlay();
    screen = 'menu';
    rerender();
  });
  root.querySelector('[data-sound]').addEventListener('click', () => { setSound(!soundOn()); rerender(); });
  root.querySelector('[data-ach]').addEventListener('click', () => openAchSheet('tetris', '俄罗斯方块'));

  const act = (k) => {
    if (!tetris || tetris.over) return;
    if (k === 'left') tMove(-1);
    else if (k === 'right') tMove(1);
    else if (k === 'rotate') { tRotate(); paintTetris(); }
    else if (k === 'down') tSoftDrop();
    else if (k === 'drop') tHardDrop();
    else if (k === 'pause') { tetris.paused = !tetris.paused; rerender(); }
  };
  root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => act(b.dataset.t)));

  const again = root.querySelector('[data-again]');
  if (again) again.addEventListener('click', () => { newTetris(); rerender(); });
  const resume = root.querySelector('[data-resume]');
  if (resume) resume.addEventListener('click', () => { tetris.paused = false; rerender(); });


  if (!tetris.over) startTetrisLoop();
}
/* 键盘（桌面浏览器） */
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (screen === 'snake' && snakeState) {
      const m = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (m[e.key]) { e.preventDefault(); turnSnake(m[e.key]); return; }
      if (e.key === ' ') { e.preventDefault(); snakeState.paused = !snakeState.paused; rerender(); return; }
    }
    if (screen === 'tetris' && tetris) {
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate' };
      const k = map[e.key];
      if (k) {
        e.preventDefault();
        if (k === 'left') tMove(-1);
        else if (k === 'right') tMove(1);
        else if (k === 'down') tSoftDrop();
    else if (k === 'drop') tHardDrop();
        else if (k === 'rotate') { tRotate(); paintTetris(); }
        return;
      }
      if (e.key === ' ') { e.preventDefault(); tHardDrop(); return; }
    }
    if (screen !== 'g2048' || !b2048) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    if (move2048(dir)) rerender();
  });
}
