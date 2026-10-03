/*
 * 過去問一覧（アーカイブ）。
 *
 * 日替わりは1日1問だが、問題は日付を種にその場で作られるので、
 * 過去はいくらでも遡れる。足りなかったのは「どの日をやったか」を
 * 一覧で見て、そこから飛べる入口だけ。
 *
 * ここは**問題を作らない**。月のマスを描くのに使うのは localStorage の
 * 記録だけで、盤面の生成は実際にその日を開いたときまで起きない
 * （1か月ぶん 93 問を一覧のたびに作っていたら、開くだけで数百ミリ秒かかる）。
 *
 * 保存の形は ui.js と共有している（`akari:v1:<日付>:<難易度>`）。
 * 鍵の前置きは設定で受け取るので、この file は保存の場所を知らない。
 *
 * 「未クリアだけ」の絞り込みも覚えておく（`akari:v1:archive:unsolved-only`）。
 * 順番に潰していく遊び方だと、開くたびに押し直すのでは意味がないため。
 * 日付の鍵は必ず `YYYY-MM-DD:<難易度>` の形なので、この鍵とはぶつからない。
 */

import { todayString } from './akari.js';

/** 一覧のマスに出す状態。上ほど強い（同じ日に複数は付かない）。 */
const STATUS = {
  done: { mark: '✓', label: 'クリア' },
  revealed: { mark: '答', label: '答えを見た' },
  partial: { mark: '…', label: '途中' },
  none: { mark: '', label: '未着手' },
};

/** 「未クリアだけ」の記憶に使う鍵（前置きのうしろに付く）。 */
const UNSOLVED_KEY = 'archive:unsolved-only';

/** クリア済みかどうか。「未クリア」は done 以外すべて（途中・答えを見た・未着手）。 */
const isCleared = (st) => st === 'done';

const pad = (n) => String(n).padStart(2, '0');
const monthOf = (dateStr) => dateStr.slice(0, 7);
const dayStr = (ym, d) => `${ym}-${pad(d)}`;

/** `YYYY-MM` を n か月ずらす。 */
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** その月の1日が何曜日か（0=日）。 */
function firstWeekday(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).getDay();
}

/**
 * 一覧を作る。
 *
 * config:
 *   root        入れ物の要素（`#archive`）
 *   storePrefix 保存キーの前置き（`akari:v1:`）
 *   levels      難易度の並び（`['easy','normal','hard']`）
 *   levelLabel  難易度 → 表示名
 *   onPick      日付と難易度が選ばれたときに呼ばれる
 */
export function createArchive(config) {
  const { root, storePrefix, levels, levelLabel, onPick } = config;
  const today = todayString();

  let month = monthOf(today);
  let level = levels[0];
  let open = false;
  let unsolvedOnly = readUnsolvedOnly();

  // --- 絞り込みの記憶（読めない・書けない環境でも黙って続ける）

  function readUnsolvedOnly() {
    try {
      return localStorage.getItem(`${storePrefix}${UNSOLVED_KEY}`) === '1';
    } catch {
      return false;
    }
  }

  function writeUnsolvedOnly() {
    try {
      localStorage.setItem(`${storePrefix}${UNSOLVED_KEY}`, unsolvedOnly ? '1' : '0');
    } catch {
      /* プライベートモードなど。絞り込みはその場だけ効く */
    }
  }

  // --- 入れ物を組み立てる（index.html には空の器だけ置いてある）

  const card = document.createElement('div');
  card.className = 'archive-card';

  const top = document.createElement('div');
  top.className = 'archive-top';
  const prev = chip('◀', '前の月');
  const title = document.createElement('span');
  title.className = 'archive-month';
  const next = chip('▶', '次の月');
  const close = chip('閉じる');
  close.classList.add('archive-close');
  top.append(prev, title, next, close);

  const levelRow = document.createElement('div');
  levelRow.className = 'archive-levels';
  const levelButtons = new Map();
  for (const key of levels) {
    const b = chip(levelLabel[key] || key);
    b.addEventListener('click', () => {
      level = key;
      render();
    });
    levelButtons.set(key, b);
    levelRow.appendChild(b);
  }

  // 「未クリアだけ」の絞り込み。クリアした日は印ごと伏せて、残りだけが見える。
  const filterRow = document.createElement('div');
  filterRow.className = 'archive-filter';
  const unsolvedBtn = chip('未クリアだけ', 'クリアした日を伏せる');
  unsolvedBtn.classList.add('archive-unsolved');
  unsolvedBtn.addEventListener('click', () => {
    unsolvedOnly = !unsolvedOnly;
    writeUnsolvedOnly();
    render();
  });
  filterRow.append(unsolvedBtn);

  const head = document.createElement('div');
  head.className = 'archive-week';
  for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
    const c = document.createElement('span');
    c.textContent = w;
    head.appendChild(c);
  }

  const grid = document.createElement('div');
  grid.className = 'archive-grid';

  const sum = document.createElement('p');
  sum.className = 'archive-sum';

  const findBtn = document.createElement('button');
  findBtn.type = 'button';
  findBtn.className = 'btn archive-find';
  findBtn.textContent = 'まだ解いていない日へ';

  const note = document.createElement('p');
  note.className = 'archive-note';
  note.textContent =
    '問題はその日付から手元で作られるので、過去へはいくらでも遡れます（通信は要りません）。';

  const foot = document.createElement('div');
  foot.className = 'archive-foot';
  foot.append(findBtn);

  card.append(top, levelRow, filterRow, head, grid, sum, foot, note);
  root.appendChild(card);

  function chip(text, title2 = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = text;
    if (title2) b.title = title2;
    return b;
  }

  // --- 記録を読む（問題は作らない）

  function statusOf(date, lv) {
    let raw = null;
    try {
      raw = localStorage.getItem(`${storePrefix}${date}:${lv}`);
    } catch {
      return 'none'; // プライベートモードなど。一覧は出せるので黙って続ける
    }
    if (!raw) return 'none';
    try {
      const d = JSON.parse(raw);
      if (d.done) return 'done';
      if (d.revealed) return 'revealed';
      if ((d.ms && d.ms > 0) || (typeof d.s === 'string' && /[^0]/.test(d.s))) return 'partial';
      return 'none';
    } catch {
      return 'none';
    }
  }

  // --- 描く

  function render() {
    const [y, m] = month.split('-').map(Number);
    title.textContent = `${y}年${m}月`;
    next.disabled = month >= monthOf(today);
    for (const [key, b] of levelButtons) b.classList.toggle('on', key === level);

    unsolvedBtn.classList.toggle('on', unsolvedOnly);
    unsolvedBtn.setAttribute('aria-pressed', unsolvedOnly ? 'true' : 'false');
    // 絞り込み中は「クリアしていない日」＝途中の日も行き先に含める。
    findBtn.textContent = unsolvedOnly ? '未クリアの日へ' : 'まだ解いていない日へ';

    grid.replaceChildren();
    for (let i = 0; i < firstWeekday(month); i++) {
      const blank = document.createElement('span');
      blank.className = 'archive-day blank';
      grid.appendChild(blank);
    }

    let done = 0;
    let playable = 0;
    const last = daysInMonth(month);
    for (let d = 1; d <= last; d++) {
      const date = dayStr(month, d);
      const future = date > today;
      const st = future ? 'none' : statusOf(date, level);
      if (!future) playable++;
      if (st === 'done') done++;

      // 絞り込み中のクリア済みの日は、マスの枠だけ残して伏せる。
      // 消してしまうと曜日の列がずれて、カレンダーとして読めなくなるため。
      const away = unsolvedOnly && isCleared(st);

      const b = document.createElement('button');
      b.type = 'button';
      b.className = away ? 'archive-day filtered' : `archive-day ${st}`;
      b.disabled = future || away;
      b.dataset.date = date;
      if (date === today) b.classList.add('is-today');

      const num = document.createElement('span');
      num.className = 'archive-num';
      num.textContent = String(d);
      const mark = document.createElement('span');
      mark.className = 'archive-mark';
      mark.textContent = away ? '' : STATUS[st].mark;
      b.append(num, mark);
      b.setAttribute(
        'aria-label',
        away
          ? `${m}月${d}日 クリア済み（絞り込みで伏せています）`
          : `${m}月${d}日 ${levelLabel[level] || level} ${STATUS[st].label}`,
      );

      if (!future && !away) b.addEventListener('click', () => pick(date));
      grid.appendChild(b);
    }

    if (!unsolvedOnly) {
      sum.textContent = `この月: クリア ${done} / ${playable}日`;
    } else if (playable - done === 0) {
      sum.textContent = `この月は ${playable}日ぜんぶクリア済みです`;
    } else {
      sum.textContent = `この月: 未クリア ${playable - done}日（クリア ${done}日は伏せています）`;
    }
  }

  function pick(date) {
    hide();
    onPick(date, level);
  }

  /**
   * 行き先の日を、今日から過去へ向かって探す。
   * 見つからないまま 2 年ぶん遡ったら諦める（全部やっている人向けの保険）。
   *
   * 探す相手は絞り込みに合わせる。普段は「まだ手を付けていない日」だが、
   * 「未クリアだけ」を立てているときは途中でやめた日・答えを見た日も行き先に
   * 含める（順番に潰していく遊び方では、やり残しこそ戻りたい先なので）。
   */
  function findUnplayed() {
    const wanted = (st) => (unsolvedOnly ? !isCleared(st) : st === 'none');
    const [y, m, d] = today.split('-').map(Number);
    for (let i = 0; i < 730; i++) {
      const dt = new Date(y, m - 1, d - i);
      const date = todayString(dt);
      if (wanted(statusOf(date, level))) return date;
    }
    return null;
  }

  findBtn.addEventListener('click', () => {
    const date = findUnplayed();
    if (!date) {
      sum.textContent = unsolvedOnly
        ? 'この難易度は2年ぶん全部クリア済みです。'
        : 'この難易度は2年ぶん全部に手が付いています。';
      return;
    }
    month = monthOf(date);
    pick(date);
  });

  prev.addEventListener('click', () => {
    month = shiftMonth(month, -1);
    render();
  });
  next.addEventListener('click', () => {
    if (month >= monthOf(today)) return;
    month = shiftMonth(month, 1);
    render();
  });
  close.addEventListener('click', hide);

  // 外側（暗い部分）を触ったら閉じる。カードの中は閉じない。
  root.addEventListener('click', (ev) => {
    if (ev.target === root) hide();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && open) hide();
  });

  function show(fromDate, fromLevel) {
    if (levels.includes(fromLevel)) level = fromLevel;
    month = monthOf(fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : today);
    open = true;
    root.classList.remove('hidden');
    render();
    close.focus();
  }

  function hide() {
    open = false;
    root.classList.add('hidden');
  }

  return {
    show,
    hide,
    isOpen: () => open,
    /** 開いたまま記録が変わったとき用（今は使っていないが、外から描き直せるように） */
    refresh: render,
  };
}
