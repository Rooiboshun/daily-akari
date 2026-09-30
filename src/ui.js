/*
 * 日替わり美術館 — プレイ UI
 *
 * 盤面のルールと生成は akari.js が全部持っている。ここは
 * 「描く・触る・数える・覚えておく」だけを担当する。
 * 依存ライブラリなし。ビルドもしない（GitHub Pages にそのまま置ける）。
 */

import {
  LAMP,
  EMPTY,
  UNKNOWN,
  isWhite,
  hintOf,
  buildIndex,
  solve,
  dailyPuzzle,
  DIFFICULTIES,
  todayString,
} from './akari.js';
import { PID, toUrl, fromUrl } from './puzzlink.js';
import { createArchive } from './archive.js';

// EMPTY はソルバでは「照明を置かないと決めたマス」。
// UI ではプレイヤーが自分で付ける「×」印がそれにあたる。
const MARK = EMPTY;
// 「仮置き」の△。ソルバには無い、UI だけの状態（game.state の外へは出さない）。
// 照明と同じように照らすが別の色で描き、クリア判定には数えない。
// 矛盾を探すために「ここに置いたらどうなるか」を試すためのもの。
const TENT = 3;

// タップの意味（スマホ用に切り替えられる）。ボタンを押すたびにこの順で回る
const TAP_MODES = ['lamp', 'mark', 'tent'];
const TAP_LABEL = { lamp: 'タップ: 照明', mark: 'タップ: ×印', tent: 'タップ: △仮置き' };

const LEVEL_LABEL = {
  easy: 'やさしい 7×7',
  normal: 'ふつう 9×9',
  hard: 'むずかしい 10×10',
};

const STORE_PREFIX = 'akari:v1:';

const el = {
  board: document.getElementById('board'),
  levels: document.getElementById('levels'),
  date: document.getElementById('date'),
  prevDay: document.getElementById('prev-day'),
  nextDay: document.getElementById('next-day'),
  today: document.getElementById('today'),
  archive: document.getElementById('archive'),
  archiveOpen: document.getElementById('archive-open'),
  lamps: document.getElementById('lamps'),
  timer: document.getElementById('timer'),
  state: document.getElementById('state'),
  mode: document.getElementById('mode'),
  hint: document.getElementById('hint'),
  check: document.getElementById('check'),
  reset: document.getElementById('reset'),
  reveal: document.getElementById('reveal'),
  tentCommit: document.getElementById('tent-commit'),
  tentClear: document.getElementById('tent-clear'),
  snapSave: document.getElementById('snap-save'),
  snapLoad: document.getElementById('snap-load'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayBody: document.getElementById('overlay-body'),
  overlayClose: document.getElementById('overlay-close'),
  busy: document.getElementById('busy'),
  seedline: document.getElementById('seedline'),
  linkInput: document.getElementById('link-input'),
  linkOpen: document.getElementById('link-open'),
  linkOut: document.getElementById('link-out'),
  linkCopy: document.getElementById('link-copy'),
  linkMsg: document.getElementById('link-msg'),
};

/**
 * 外から読み込んだ問題を解くときの探索の上限。
 * 自分で作った問題は数ミリ秒で解けるが、他所から来た URL は
 * 解が無いまま探索が膨らむことがあるので、画面が固まる前に諦める。
 */
const IMPORT_NODE_LIMIT = 300000;

/** 今遊んでいる問題。盤面が変わるたび丸ごと入れ替える。 */
let game = null;
/** 盤面のマス要素（描き直しのたびに作り直さず、class だけ書き換える） */
let cellEls = [];
/** ヒントで置いてもらったマス（印を付けて分かるようにする） */
let givenCells = new Set();
/** 「まちがい探し」で赤くしたマス。次に触ったら消す */
let wrongCells = new Set();
/** タップの意味。TAP_MODES のどれか */
let tapMode = 'lamp';
/** 最後に遊んだ日替わりの難易度。読み込んだ問題から日付に戻るときの行き先 */
let lastDifficulty = 'normal';

// ------------------------------------------------------------------ 日付

const TODAY = todayString();

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayString(dt);
}

/**
 * URL の # を読む。二通りある。
 *   #2026-09-13/normal          日替わりの問題
 *   #p/lightup/10/10/xxxx       読み込んだ問題（puzz.link と同じ本文）
 * 壊れていたら今日の normal に落とす。
 */
function readHash() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (/^p\//i.test(raw)) {
    try {
      return { kind: 'link', link: fromUrl(raw) };
    } catch {
      // 読めない問題だった。日替わりに落ちる
    }
  }
  const [date, level] = raw.split('/');
  const okDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : TODAY;
  const okLevel = DIFFICULTIES[level] ? level : 'normal';
  return { kind: 'daily', date: okDate > TODAY ? TODAY : okDate, difficulty: okLevel };
}

function writeHash(next) {
  if (location.hash !== next) history.replaceState(null, '', next);
  return next;
}

const dailyHash = (date, difficulty) => `#${date}/${difficulty}`;
const linkHash = (link) => `#p/${PID}/${link.w}/${link.h}/${link.body}`;

// ------------------------------------------------------------------ 保存

const storeKey = (id) => `${STORE_PREFIX}${id}`;

function saveProgress() {
  if (!game) return;
  try {
    localStorage.setItem(
      storeKey(game.id),
      JSON.stringify({
        s: Array.from(game.state).join(''),
        ms: elapsedMs(),
        done: game.done,
        revealed: game.revealed,
        hints: game.hintsUsed,
        given: Array.from(givenCells),
        snap: game.snap,
      }),
    );
  } catch {
    // 容量オーバーやプライベートモード。遊ぶのに支障は無いので黙って諦める
  }
}

function loadProgress(id, size) {
  try {
    const raw = localStorage.getItem(storeKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.s !== 'string' || data.s.length !== size) return null;
    if (data.snap && (typeof data.snap.s !== 'string' || data.snap.s.length !== size)) data.snap = null;
    return data;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 時間

function elapsedMs() {
  if (!game) return 0;
  return game.accumMs + (game.runningSince ? Date.now() - game.runningSince : 0);
}

function startTimer() {
  if (!game || game.done || game.revealed || game.runningSince) return;
  game.runningSince = Date.now();
}

function stopTimer() {
  if (!game || !game.runningSince) return;
  game.accumMs += Date.now() - game.runningSince;
  game.runningSince = null;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

setInterval(() => {
  if (game) el.timer.textContent = formatTime(elapsedMs());
}, 500);

// 裏に回っている間は時間を止める（放置した時間を記録に足さない）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopTimer();
    saveProgress();
  } else if (game && !game.done && !game.revealed && game.touched) {
    startTimer();
  }
});

// ------------------------------------------------------------------ 判定

/**
 * 各マスが何本の照明に照らされているかを数える。2本以上なら照らし合い。
 * 仮置き（△）の光は別に数える（判定には使わず、描き分けと矛盾探しに使う）。
 */
function computeLit() {
  const { ix, state } = game;
  const lit = new Uint8Array(ix.w * ix.h);
  const tent = new Uint8Array(ix.w * ix.h);
  for (const i of ix.whites) {
    const into = state[i] === LAMP ? lit : state[i] === TENT ? tent : null;
    if (!into) continue;
    for (const j of ix.beams[i]) into[j]++;
  }
  return { lit, tent };
}

/** 仮置き込みで見たときの矛盾（照らし合い・数字オーバー）の数。 */
function inspectWithTent(lit, tent) {
  const { ix, state } = game;
  let tents = 0;
  let clash = 0;
  for (const i of ix.whites) {
    if (state[i] === TENT) tents++;
    if ((state[i] === LAMP || state[i] === TENT) && lit[i] + tent[i] > 1) clash++;
  }
  let overHints = 0;
  for (const nb of ix.numbered) {
    let n = 0;
    for (const j of nb.adj) if (state[j] === LAMP || state[j] === TENT) n++;
    if (n > nb.hint) overHints++;
  }
  return { tents, clash, overHints };
}

/** 今の盤面の出来具合。完成判定と、状況表示の材料をまとめて返す。 */
function inspect(lit) {
  const { ix, state } = game;
  let lamps = 0;
  let unlit = 0;
  let clash = 0;
  for (const i of ix.whites) {
    if (state[i] === LAMP) {
      lamps++;
      if (lit[i] > 1) clash++;
    }
    if (lit[i] === 0) unlit++;
  }
  // 足りない数字は「まだ途中」なので責めない。多すぎる数字だけが間違い。
  let badHints = 0;
  let overHints = 0;
  for (const nb of ix.numbered) {
    let n = 0;
    for (const j of nb.adj) if (state[j] === LAMP) n++;
    if (n !== nb.hint) badHints++;
    if (n > nb.hint) overHints++;
  }
  return {
    lamps,
    unlit,
    clash,
    badHints,
    overHints,
    complete: unlit === 0 && clash === 0 && badHints === 0,
  };
}

// ------------------------------------------------------------------ 描画

function buildBoard() {
  const { puzzle } = game;
  el.board.style.gridTemplateColumns = `repeat(${puzzle.w}, var(--cell))`;
  el.board.replaceChildren();
  cellEls = new Array(puzzle.w * puzzle.h);

  for (let i = 0; i < puzzle.w * puzzle.h; i++) {
    const c = puzzle.cells[i];
    if (isWhite(c)) {
      const b = document.createElement('button');
      b.className = 'cell white';
      b.type = 'button';
      b.dataset.i = String(i);
      b.setAttribute('aria-label', `${(i % puzzle.w) + 1}列 ${Math.floor(i / puzzle.w) + 1}行`);
      cellEls[i] = b;
      el.board.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'cell black';
      const hint = hintOf(c);
      if (hint !== null) d.textContent = String(hint);
      cellEls[i] = d;
      el.board.appendChild(d);
    }
  }
}

function paint() {
  const { ix, state } = game;
  const { lit, tent } = computeLit();

  for (const i of ix.whites) {
    const node = cellEls[i];
    const lampish = state[i] === LAMP || state[i] === TENT;
    node.classList.toggle('lamp', state[i] === LAMP);
    node.classList.toggle('tent', state[i] === TENT);
    node.classList.toggle('mark', state[i] === MARK);
    node.classList.toggle('lit', lit[i] > 0);
    // 本物の光が当たっていないマスだけ、仮置きの色で塗る
    node.classList.toggle('tlit', lit[i] === 0 && tent[i] > 0);
    node.classList.toggle('clash', lampish && lit[i] + tent[i] > 1);
    node.classList.toggle('given', givenCells.has(i));
    node.classList.toggle('wrong', wrongCells.has(i));
  }

  for (const nb of ix.numbered) {
    let n = 0;
    let t = 0;
    for (const j of nb.adj) {
      if (state[j] === LAMP) n++;
      else if (state[j] === TENT) t++;
    }
    const node = cellEls[nb.index];
    node.classList.toggle('sat', n === nb.hint);
    // 仮置きを足すと合う数字は、仮置きの色で見せる
    node.classList.toggle('tsat', t > 0 && n + t === nb.hint);
    node.classList.toggle('over', n + t > nb.hint);
  }

  const info = inspect(lit);
  const withTent = inspectWithTent(lit, tent);
  el.lamps.textContent = withTent.tents > 0 ? `照明 ${info.lamps} · △ ${withTent.tents}` : `照明 ${info.lamps}`;
  el.timer.textContent = formatTime(elapsedMs());

  el.state.classList.remove('ok', 'ng');
  if (game.revealed) {
    el.state.textContent = '答えを見た';
  } else if (game.done) {
    el.state.textContent = 'クリア済み';
    el.state.classList.add('ok');
  } else if (info.clash > 0 || info.overHints > 0) {
    const parts = [];
    if (info.clash > 0) parts.push(`照らし合い ${info.clash}`);
    if (info.overHints > 0) parts.push(`数字オーバー ${info.overHints}`);
    el.state.textContent = parts.join(' / ');
    el.state.classList.add('ng');
  } else if (withTent.clash > 0 || withTent.overHints > 0) {
    const parts = [];
    if (withTent.clash > 0) parts.push(`照らし合い ${withTent.clash}`);
    if (withTent.overHints > 0) parts.push(`数字オーバー ${withTent.overHints}`);
    el.state.textContent = `△で矛盾: ${parts.join(' / ')}`;
    el.state.classList.add('ng');
  } else {
    el.state.textContent = `未点灯 ${info.unlit}`;
  }

  el.board.classList.toggle('done', game.done || game.revealed);
  const playing = !game.done && !game.revealed;
  if (el.tentCommit) el.tentCommit.disabled = !playing || withTent.tents === 0;
  if (el.tentClear) el.tentClear.disabled = !playing || withTent.tents === 0;
  if (el.snapSave) el.snapSave.disabled = !playing;
  if (el.snapLoad) el.snapLoad.disabled = !playing || !game.snap;
  el.seedline.textContent = `${game.label} · ヒント ${game.hintsUsed}`;

  return info;
}

function showOverlay(title, body) {
  el.overlayTitle.textContent = title;
  el.overlayBody.textContent = body;
  el.overlay.classList.remove('hidden');
}

// ------------------------------------------------------------------ 操作

function afterEdit() {
  if (wrongCells.size) wrongCells.clear();
  game.touched = true;
  startTimer();
  const info = paint();
  if (info.complete && !game.done && !game.revealed) {
    game.done = true;
    stopTimer();
    paint();
    const hintNote = game.hintsUsed > 0 ? `\nヒント ${game.hintsUsed} 回` : '\nノーヒント';
    showOverlay('クリア！', `${formatTime(elapsedMs())}${hintNote}`);
  }
  saveProgress();
}

function setCell(i, next) {
  if (!game || game.done || game.revealed) return;
  game.state[i] = next;
  givenCells.delete(i);
  afterEdit();
}

function toggleLamp(i) {
  setCell(i, game.state[i] === LAMP ? UNKNOWN : LAMP);
}

function toggleMark(i) {
  setCell(i, game.state[i] === MARK ? UNKNOWN : MARK);
}

function toggleTent(i) {
  setCell(i, game.state[i] === TENT ? UNKNOWN : TENT);
}

/** タップ（クリック）1回ぶん。今のタップの意味に従う */
function tap(i) {
  if (tapMode === 'mark') toggleMark(i);
  else if (tapMode === 'tent') toggleTent(i);
  else toggleLamp(i);
}

// 長押しで印を付けた直後の click は捨てる（同じ操作で2回反応しないように）
let swallowClick = false;

// クリック（マウス左 / キーボードの Enter・Space もここに来る）
el.board.addEventListener('click', (ev) => {
  const node = ev.target.closest('.cell.white');
  if (!node) return;
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  const i = Number(node.dataset.i);
  // Shift+クリックは、今のタップの意味にかかわらず△
  if (ev.shiftKey) toggleTent(i);
  else tap(i);
});

// 右クリックは「×」印。メニューは出さない
el.board.addEventListener('contextmenu', (ev) => {
  const node = ev.target.closest('.cell.white');
  if (!node) return;
  ev.preventDefault();
  toggleMark(Number(node.dataset.i));
});

// スマホの長押しも「×」印にする（押しっぱなしで発火し、直後の click は捨てる）
let pressTimer = null;
el.board.addEventListener('pointerdown', (ev) => {
  const node = ev.target.closest('.cell.white');
  if (!node || ev.pointerType === 'mouse') return;
  swallowClick = false;
  const i = Number(node.dataset.i);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    swallowClick = true;
    // 長押しは「×」印。タップが×印のときだけ照明にする
    if (tapMode === 'mark') toggleLamp(i);
    else toggleMark(i);
  }, 450);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
  el.board.addEventListener(type, () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });
}

// キーボード: 矢印で移動、x で「×」印、t で△
el.board.addEventListener('keydown', (ev) => {
  const node = ev.target.closest('.cell.white');
  if (!node) return;
  const i = Number(node.dataset.i);
  if (ev.key === 'x' || ev.key === 'X') {
    ev.preventDefault();
    toggleMark(i);
    return;
  }
  if (ev.key === 't' || ev.key === 'T') {
    ev.preventDefault();
    toggleTent(i);
    return;
  }
  const step = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[ev.key];
  if (!step) return;
  ev.preventDefault();
  const { w, h } = game.puzzle;
  let x = i % w;
  let y = Math.floor(i / w);
  for (let n = 0; n < Math.max(w, h); n++) {
    x += step[0];
    y += step[1];
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const node2 = cellEls[y * w + x];
    if (node2 && node2.classList.contains('white')) {
      node2.focus();
      return;
    }
  }
});

// ------------------------------------------------------------------ 道具

el.mode.addEventListener('click', () => {
  tapMode = TAP_MODES[(TAP_MODES.indexOf(tapMode) + 1) % TAP_MODES.length];
  el.mode.textContent = TAP_LABEL[tapMode];
  el.mode.dataset.mode = tapMode;
  el.mode.setAttribute('aria-pressed', String(tapMode !== 'lamp'));
});

/** 盤面の△を全部 next に変える（確定なら照明、消すなら空白） */
function replaceTents(next) {
  if (!game || game.done || game.revealed) return;
  let changed = false;
  for (const i of game.ix.whites) {
    if (game.state[i] === TENT) {
      game.state[i] = next;
      changed = true;
    }
  }
  if (changed) afterEdit();
}

if (el.tentCommit) el.tentCommit.addEventListener('click', () => replaceTents(LAMP));
if (el.tentClear) el.tentClear.addEventListener('click', () => replaceTents(UNKNOWN));

function sayOk(text) {
  el.state.textContent = text;
  el.state.classList.remove('ng');
  el.state.classList.add('ok');
}

// 盤面の保存と呼び出し。問題ごとに1枠で、途中経過と一緒に localStorage に残る。
// 仮置きで試して行き詰まったとき、置く前の盤面へ一度で戻るためのもの。
if (el.snapSave) {
  el.snapSave.addEventListener('click', () => {
    if (!game || game.done || game.revealed) return;
    game.snap = { s: Array.from(game.state).join(''), given: Array.from(givenCells) };
    saveProgress();
    paint();
    sayOk('盤面を保存しました');
  });
}

if (el.snapLoad) {
  el.snapLoad.addEventListener('click', () => {
    if (!game || game.done || game.revealed || !game.snap) return;
    const { s, given } = game.snap;
    for (let i = 0; i < s.length; i++) game.state[i] = Number(s[i]) || 0;
    givenCells = new Set(Array.isArray(given) ? given : []);
    afterEdit();
    if (!game.done) sayOk('保存した盤面に戻しました');
  });
}

el.reset.addEventListener('click', () => {
  if (!game) return;
  game.state = new Int8Array(game.puzzle.w * game.puzzle.h);
  game.done = false;
  game.revealed = false;
  game.hintsUsed = 0;
  game.accumMs = 0;
  game.runningSince = null;
  game.touched = false;
  game.snap = null;
  givenCells.clear();
  wrongCells.clear();
  el.overlay.classList.add('hidden');
  paint();
  saveProgress();
});

// 間違っている照明だけを赤くする。解は一意なので「答えに無い照明＝間違い」
el.check.addEventListener('click', () => {
  if (!game) return;
  wrongCells.clear();
  for (const i of game.ix.whites) {
    if (game.state[i] === LAMP && game.solution[i] !== LAMP) wrongCells.add(i);
  }
  paint();
  if (wrongCells.size === 0) {
    el.state.textContent = 'ここまでは合っています';
    el.state.classList.remove('ng');
    el.state.classList.add('ok');
  }
});

// ヒント: 間違った照明があれば1つ外す。無ければ正しい照明を1つ置く
el.hint.addEventListener('click', () => {
  if (!game || game.done || game.revealed) return;
  const wrong = game.ix.whites.filter((i) => game.state[i] === LAMP && game.solution[i] !== LAMP);
  if (wrong.length > 0) {
    const i = wrong[Math.floor(Math.random() * wrong.length)];
    game.state[i] = UNKNOWN;
    game.hintsUsed++;
    afterEdit();
    el.state.textContent = '間違った照明を1つ外しました';
    el.state.classList.add('ng');
    return;
  }
  const missing = game.ix.whites.filter((i) => game.solution[i] === LAMP && game.state[i] !== LAMP);
  if (missing.length === 0) return;
  const i = missing[Math.floor(Math.random() * missing.length)];
  game.state[i] = LAMP;
  game.hintsUsed++;
  afterEdit();
  givenCells.add(i);
  paint();
  saveProgress();
});

el.reveal.addEventListener('click', () => {
  if (!game || game.revealed) return;
  if (!game.done && !confirm('答えを表示します。この問題の記録は残りません。')) return;
  stopTimer();
  game.revealed = true;
  game.state = Int8Array.from(game.solution);
  givenCells.clear();
  wrongCells.clear();
  paint();
  saveProgress();
  showOverlay('答え', '次の問題は日付を変えて選べます。');
});

el.overlayClose.addEventListener('click', () => el.overlay.classList.add('hidden'));

// ------------------------------------------------------------------ 問題の切り替え

function buildLevels() {
  el.levels.replaceChildren();
  for (const key of Object.keys(DIFFICULTIES)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.level = key;
    b.textContent = LEVEL_LABEL[key] || key;
    // 読み込んだ問題から難易度を選んだときは、今日の問題に戻る
    b.addEventListener('click', () => load(game && game.date ? game.date : TODAY, key));
    el.levels.appendChild(b);
  }
}

function syncControls(date, difficulty) {
  // 読み込んだ問題のときは date が null。日付の並びは「今日へ戻る」ために生かす
  el.date.value = date || TODAY;
  el.date.max = TODAY;
  el.nextDay.disabled = !date || date >= TODAY;
  el.prevDay.disabled = !date;
  el.today.disabled = date === TODAY;
  for (const b of el.levels.children) b.classList.toggle('on', b.dataset.level === difficulty);
}

/**
 * 「まず描いてから重い処理をする」ための待ち。
 * 描画のあとに動かしたいので requestAnimationFrame を使うが、裏のタブや
 * ヘッドレスでは rAF が一度も来ないことがあるので、タイマーでも受ける。
 * 先に来たほうだけが動く。
 */
function afterPaint(fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 50);
}

/**
 * 出来上がった問題を画面に載せる。日替わりでも読み込んだ問題でもここを通る。
 * meta: { date, difficulty, id, label, hash, link }
 */
function install(made, meta) {
  const size = made.puzzle.w * made.puzzle.h;
  game = {
    date: meta.date,
    difficulty: meta.difficulty,
    id: meta.id,
    label: meta.label,
    hash: meta.hash,
    puzzle: made.puzzle,
    solution: made.solution,
    ix: buildIndex(made.puzzle),
    state: new Int8Array(size),
    accumMs: 0,
    runningSince: null,
    touched: false,
    done: false,
    revealed: false,
    hintsUsed: 0,
    // 「盤面を保存」で取っておいた盤面 { s, given }。問題ごとに1枠
    snap: null,
  };
  givenCells = new Set();
  wrongCells = new Set();

  const saved = loadProgress(meta.id, size);
  if (saved) {
    for (let i = 0; i < size; i++) game.state[i] = Number(saved.s[i]) || 0;
    game.accumMs = Number(saved.ms) || 0;
    game.done = !!saved.done;
    game.revealed = !!saved.revealed;
    game.hintsUsed = Number(saved.hints) || 0;
    game.touched = game.accumMs > 0;
    if (Array.isArray(saved.given)) givenCells = new Set(saved.given);
    if (saved.snap) game.snap = saved.snap;
  }

  buildBoard();
  paint();
  syncLinkOut();
  el.busy.classList.add('hidden');
}

function beginLoad(busyText) {
  el.overlay.classList.add('hidden');
  el.busy.textContent = busyText;
  el.busy.classList.remove('hidden');
}

/** 問題を作って画面に載せる。生成は一瞬だが、先に「作っています」を出してから回す。 */
function load(date, difficulty) {
  lastDifficulty = difficulty;
  syncControls(date, difficulty);
  const hash = writeHash(dailyHash(date, difficulty));
  beginLoad('問題を作っています…');

  // 描画を1フレーム挟まないと「作っています」が出ないまま固まって見える
  afterPaint(() => {
    let made;
    try {
      made = dailyPuzzle(date, difficulty);
    } catch (err) {
      el.busy.textContent = `問題を作れませんでした: ${err.message}`;
      return;
    }
    install(made, {
      date,
      difficulty,
      id: `${date}:${difficulty}`,
      label: `${date} / ${difficulty}`,
      hash,
    });
  });
}

/** 読み込んだ問題（puzz.link の URL など）を解いてから画面に載せる。 */
function loadLink(link) {
  syncControls(null, null);
  const hash = writeHash(linkHash(link));
  beginLoad('問題を調べています…');

  afterPaint(() => {
    let r;
    try {
      r = solve(buildIndex(link.puzzle), 2, { nodeLimit: IMPORT_NODE_LIMIT });
    } catch (err) {
      el.busy.textContent = `問題を読めませんでした: ${err.message}`;
      return;
    }
    if (r.count === 0) {
      el.busy.textContent = r.aborted
        ? 'この問題は手に負えませんでした（大きすぎるか、解がありません）'
        : 'この問題には解がありません';
      return;
    }
    install(
      { puzzle: link.puzzle, solution: r.solutions[0] },
      {
        date: null,
        difficulty: null,
        id: `link:${link.w}x${link.h}:${link.body}`,
        label: `読み込んだ問題 ${link.w}×${link.h}`,
        hash,
      },
    );
    setLinkMsg(
      r.count > 1
        ? '読み込みました。解が複数あるので、ヒントとまちがい探しはそのうちの1つを基準にします。'
        : '読み込みました（解は1つ）。',
      r.count > 1 ? 'warn' : 'ok',
    );
  });
}

/** # の中身に合わせて問題を切り替える。 */
function apply(want) {
  if (want.kind === 'link') loadLink(want.link);
  else load(want.date, want.difficulty);
}

el.prevDay.addEventListener('click', () => {
  if (game && game.date) load(shiftDate(game.date, -1), game.difficulty);
});
el.nextDay.addEventListener('click', () => {
  if (!game || !game.date) return;
  const next = shiftDate(game.date, 1);
  if (next <= TODAY) load(next, game.difficulty);
});
el.today.addEventListener('click', () => load(TODAY, lastDifficulty));
el.date.addEventListener('change', () => {
  const v = el.date.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= TODAY) load(v, lastDifficulty);
  else syncControls(game ? game.date : TODAY, game ? game.difficulty : lastDifficulty);
});

window.addEventListener('hashchange', () => {
  // 自分で書いた # なら何もしない（書き換えのたびに作り直さないため）
  if (game && location.hash === game.hash) return;
  apply(readHash());
});

window.addEventListener('pagehide', () => {
  stopTimer();
  saveProgress();
});

// -------------------------------------------------------------- puzz.link

function setLinkMsg(text, kind = '') {
  if (!el.linkMsg) return;
  el.linkMsg.textContent = text;
  el.linkMsg.className = `link-msg${kind ? ` ${kind}` : ''}`;
}

/** 今の問題の puzz.link URL を、書き出し側のボタンに載せる。 */
function syncLinkOut() {
  if (!el.linkOut || !game) return;
  let url = '';
  try {
    url = toUrl(game.puzzle);
  } catch {
    // 盤面が puzz.link で表せない形（今のところ起きない）
  }
  el.linkOut.href = url || '#';
  el.linkOut.dataset.url = url;
  el.linkOut.classList.toggle('disabled', !url);
  if (el.linkCopy) el.linkCopy.disabled = !url;
}

if (el.linkOpen) {
  el.linkOpen.addEventListener('click', () => {
    const raw = el.linkInput ? el.linkInput.value : '';
    if (!raw.trim()) {
      setLinkMsg('puzz.link の URL を貼ってください', 'warn');
      return;
    }
    let link;
    try {
      link = fromUrl(raw);
    } catch (err) {
      setLinkMsg(err.message, 'warn');
      return;
    }
    setLinkMsg('読み込んでいます…');
    loadLink(link);
  });
}

if (el.linkInput) {
  el.linkInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      el.linkOpen.click();
    }
  });
}

if (el.linkCopy) {
  el.linkCopy.addEventListener('click', async () => {
    const url = el.linkOut ? el.linkOut.dataset.url : '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMsg('URL をコピーしました', 'ok');
    } catch {
      // 権限が無い / http でない。選べる形で出しておく
      if (el.linkInput) {
        el.linkInput.value = url;
        el.linkInput.select();
      }
      setLinkMsg('コピーできなかったので、上の欄に入れました', 'warn');
    }
  });
}

// ---------------------------------------------------------------- 過去問

/**
 * 過去問一覧。記録（localStorage）だけを読んで月のマスを描き、
 * 選ばれた日をここで読み込む。問題を作るのは選ばれた後だけ。
 */
const archive = el.archive
  ? createArchive({
      root: el.archive,
      storePrefix: STORE_PREFIX,
      levels: Object.keys(DIFFICULTIES),
      levelLabel: LEVEL_LABEL,
      onPick: (date, difficulty) => load(date, difficulty),
    })
  : null;

if (el.archiveOpen && archive) {
  el.archiveOpen.addEventListener('click', () => {
    if (archive.isOpen()) archive.hide();
    // 読み込んだ問題を遊んでいるときは date が null なので、今日の月から開く
    else archive.show(game && game.date ? game.date : TODAY, game && game.difficulty ? game.difficulty : lastDifficulty);
  });
}

// -------------------------------------------------------------- 起動

buildLevels();
apply(readHash());
