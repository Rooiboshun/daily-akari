/*
 * 美術館 (Akari / Light Up) — ソルバと一意解ジェネレータ
 *
 * 依存なしの ES モジュール。ブラウザからも Node からも同じファイルを読める。
 * UI は含まない（盤面ロジックだけ）。
 *
 * ルール:
 *   1. 照明は白マスに置く。照明は自分のマスと上下左右を、黒マスか盤の端に
 *      当たるまで照らす。
 *   2. 照明どうしが照らし合ってはいけない。
 *   3. 数字の入った黒マスは、上下左右に接する照明の数がその数字と一致する。
 *   4. すべての白マスが照らされている。
 */

// ---------------------------------------------------------------- 盤面の表現

export const WHITE = -1; // 白マス
export const BLACK = -2; // 数字なしの黒マス（0..4 は数字つきの黒マス）

export const UNKNOWN = 0; // まだ決めていない白マス
export const LAMP = 1; // 照明を置いた白マス
export const EMPTY = 2; // 照明を置かないと決めた白マス

/**
 * テキストから盤面を読む。'.' 白 / '#' 数字なしの黒 / '0'-'4' 数字つきの黒。
 * @param {string} text
 * @returns {{w:number,h:number,cells:Int8Array}}
 */
export function parse(text) {
  const rows = text
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rows.length === 0) throw new Error('盤面が空です');
  const h = rows.length;
  const w = rows[0].length;
  const cells = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`${y + 1} 行目の長さが揃っていません`);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') cells[y * w + x] = WHITE;
      else if (ch === '#') cells[y * w + x] = BLACK;
      else if (ch >= '0' && ch <= '4') cells[y * w + x] = ch.charCodeAt(0) - 48;
      else throw new Error(`読めない文字: ${ch}`);
    }
  }
  return { w, h, cells };
}

/** 盤面をテキストに戻す。state を渡すと照明を 'L'、確定した空白を '.' で描く。 */
export function render(puzzle, state) {
  const { w, h, cells } = puzzle;
  const out = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = cells[i];
      if (c === WHITE) line += state && state[i] === LAMP ? 'L' : '.';
      else if (c === BLACK) line += '#';
      else line += String(c);
    }
    out.push(line);
  }
  return out.join('\n');
}

export const isWhite = (c) => c === WHITE;
export const isBlack = (c) => c !== WHITE;
export const hintOf = (c) => (c >= 0 ? c : null);

// -------------------------------------------------------------- 事前計算

/**
 * ソルバが毎回使う索引を作る。盤面の形（黒マスの配置）にだけ依存するので、
 * 数字を削りながら何度も解く削り出し作業では使い回せる。
 */
export function buildIndex(puzzle) {
  const { w, h, cells } = puzzle;
  const n = w * h;
  const whites = [];
  for (let i = 0; i < n; i++) if (isWhite(cells[i])) whites.push(i);

  // beams[i] = 白マス i から見える白マス（i 自身を含む）
  const beams = new Array(n).fill(null);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const i of whites) {
    const x0 = i % w;
    const y0 = (i - x0) / w;
    const list = [i];
    for (const [dx, dy] of dirs) {
      let x = x0 + dx;
      let y = y0 + dy;
      while (x >= 0 && x < w && y >= 0 && y < h && isWhite(cells[y * w + x])) {
        list.push(y * w + x);
        x += dx;
        y += dy;
      }
    }
    beams[i] = Int32Array.from(list);
  }

  // 数字つき黒マスと、その上下左右の白マス
  const numbered = [];
  for (let i = 0; i < n; i++) {
    const hint = hintOf(cells[i]);
    if (hint === null) continue;
    const x0 = i % w;
    const y0 = (i - x0) / w;
    const adj = [];
    for (const [dx, dy] of dirs) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const j = y * w + x;
      if (isWhite(cells[j])) adj.push(j);
    }
    numbered.push({ index: i, hint, adj: Int32Array.from(adj) });
  }

  return { puzzle, w, h, cells, whites, beams, numbered };
}

// -------------------------------------------------------------- 制約伝播

/**
 * 分岐せずに決まるところだけを埋める。矛盾したら false。
 * 三つの制約をそれぞれ規則にして、変化が止まるまで回す。
 */
export function propagate(ix, st) {
  const { whites, beams, numbered } = ix;
  let changed = true;
  while (changed) {
    changed = false;

    // 規則1: 照明を置いたマスの光の通り道には、他の照明は置けない
    for (const i of whites) {
      if (st[i] !== LAMP) continue;
      const beam = beams[i];
      for (let k = 1; k < beam.length; k++) {
        const j = beam[k];
        if (st[j] === LAMP) return false; // 照らし合っている
        if (st[j] === UNKNOWN) {
          st[j] = EMPTY;
          changed = true;
        }
      }
    }

    // 規則2: 数字つき黒マスの周りの本数を合わせる
    for (const nb of numbered) {
      let lamps = 0;
      let unknown = 0;
      for (const j of nb.adj) {
        if (st[j] === LAMP) lamps++;
        else if (st[j] === UNKNOWN) unknown++;
      }
      if (lamps > nb.hint) return false;
      if (lamps + unknown < nb.hint) return false;
      if (unknown === 0) continue;
      if (lamps === nb.hint) {
        for (const j of nb.adj) if (st[j] === UNKNOWN) st[j] = EMPTY;
        changed = true;
      } else if (lamps + unknown === nb.hint) {
        for (const j of nb.adj) if (st[j] === UNKNOWN) st[j] = LAMP;
        changed = true;
      }
    }

    // 規則3: すべての白マスは照らされる。照らせる候補が1つしかなければ確定
    for (const i of whites) {
      const beam = beams[i];
      let lit = false;
      for (let k = 0; k < beam.length; k++) {
        if (st[beam[k]] === LAMP) {
          lit = true;
          break;
        }
      }
      if (lit) continue;
      let cand = -1;
      let count = 0;
      for (let k = 0; k < beam.length; k++) {
        if (st[beam[k]] === UNKNOWN) {
          cand = beam[k];
          if (++count > 1) break;
        }
      }
      if (count === 0) return false; // どうやっても照らせない
      if (count === 1) {
        st[cand] = LAMP;
        changed = true;
      }
    }
  }
  return true;
}

/** 完成した配置が本当にルールを満たしているかを最後に確かめる。 */
export function isValidSolution(ix, st) {
  const { whites, beams, numbered } = ix;
  for (const i of whites) {
    if (st[i] !== LAMP && st[i] !== EMPTY) return false;
    const beam = beams[i];
    let lit = false;
    for (let k = 0; k < beam.length; k++) if (st[beam[k]] === LAMP) lit = true;
    if (!lit) return false; // 照らされていない白マスがある
    if (st[i] === LAMP) {
      for (let k = 1; k < beam.length; k++) if (st[beam[k]] === LAMP) return false;
    }
  }
  for (const nb of numbered) {
    let lamps = 0;
    for (const j of nb.adj) if (st[j] === LAMP) lamps++;
    if (lamps !== nb.hint) return false;
  }
  return true;
}

// -------------------------------------------------------------- ソルバ本体

/**
 * 解を limit 個まで数える。一意性の検査は limit=2 で呼んで count===1 を見る。
 *
 * opt.nodeLimit を渡すと、探索の節をその数だけ見たところで打ち切って
 * aborted: true を返す。自分で作った問題は数ミリ秒で解けるので既定は無制限だが、
 * 外から読み込んだ問題（puzz.link の URL など）は解が無いまま探索が
 * 膨らむことがあるので、画面が固まらないように上限を付けて呼ぶ。
 *
 * @returns {{count:number, solutions:Int8Array[], guesses:number,
 *            logicOnly:boolean, nodes:number, aborted:boolean}}
 */
export function solve(ix, limit = 2, opt = {}) {
  const st = new Int8Array(ix.w * ix.h); // 全部 UNKNOWN(0)
  const solutions = [];
  const stats = {
    guesses: 0,
    branched: false,
    nodes: 0,
    nodeLimit: opt.nodeLimit === undefined ? Infinity : opt.nodeLimit,
    aborted: false,
  };
  search(ix, st, solutions, limit, stats);
  return {
    count: solutions.length,
    solutions,
    guesses: stats.guesses,
    // 一度も分岐せずに解けたか（＝素直な論理だけで解ける易しい問題か）
    logicOnly: !stats.branched && solutions.length === 1 && !stats.aborted,
    nodes: stats.nodes,
    aborted: stats.aborted,
  };
}

function search(ix, st, solutions, limit, stats) {
  if (solutions.length >= limit) return;
  if (stats.aborted) return;
  if (++stats.nodes > stats.nodeLimit) {
    stats.aborted = true;
    return;
  }
  if (!propagate(ix, st)) return;

  const { whites, beams } = ix;

  // まだ照らされていない白マスのうち、候補がいちばん少ないものを選ぶ
  let target = -1;
  let targetCand = null;
  for (const i of whites) {
    const beam = beams[i];
    let lit = false;
    for (let k = 0; k < beam.length; k++) {
      if (st[beam[k]] === LAMP) {
        lit = true;
        break;
      }
    }
    if (lit) continue;
    const cand = [];
    for (let k = 0; k < beam.length; k++) if (st[beam[k]] === UNKNOWN) cand.push(beam[k]);
    if (targetCand === null || cand.length < targetCand.length) {
      target = i;
      targetCand = cand;
      if (cand.length <= 1) break;
    }
  }

  if (target === -1) {
    // すべての白マスが照らされた。残りの未確定マスに照明は置けない
    // （置くと必ず既存の照明と照らし合う）ので、空白で埋めて検査する。
    const done = st.slice();
    for (const i of whites) if (done[i] === UNKNOWN) done[i] = EMPTY;
    if (isValidSolution(ix, done)) solutions.push(done);
    return;
  }

  // 候補を「最初の1つが照明」「それは空白で次が照明」…と排他的に分ける。
  // こうしないと同じ解を二度数えてしまう（行方向と列方向の候補は
  // 互いに照らし合わないので同時に真になり得るため）。
  const base = st.slice();
  if (targetCand.length > 1) {
    stats.branched = true;
    stats.guesses += targetCand.length - 1;
  }
  for (let k = 0; k < targetCand.length; k++) {
    if (solutions.length >= limit) return;
    const next = base.slice();
    for (let m = 0; m < k; m++) next[targetCand[m]] = EMPTY;
    next[targetCand[k]] = LAMP;
    search(ix, next, solutions, limit, stats);
  }
}

/** 分岐なし（制約伝播だけ）で解けるかを調べる。難易度の目安に使う。 */
export function solvableByLogicAlone(ix) {
  const st = new Int8Array(ix.w * ix.h);
  if (!propagate(ix, st)) return null;
  for (const i of ix.whites) if (st[i] === UNKNOWN) st[i] = EMPTY;
  return isValidSolution(ix, st) ? st : null;
}

// -------------------------------------------------------------- 乱数

/** 文字列から 32bit の種を作る（FNV-1a）。 */
export function seedFrom(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32。同じ種なら必ず同じ列を返すので、日替わり生成が決定的になる。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// -------------------------------------------------------------- 盤面生成

/**
 * 黒マスの配置を作る。既製の美術館パズルに倣って 180 度回転対称にする。
 */
function makeLayout(w, h, ratio, rng) {
  const n = w * h;
  const cells = new Int8Array(n).fill(WHITE);
  const target = Math.round(n * ratio);
  const slots = [];
  for (let i = 0; i < n; i++) slots.push(i);
  shuffle(slots, rng);
  let placed = 0;
  for (const i of slots) {
    if (placed >= target) break;
    const mirror = n - 1 - i;
    if (cells[i] === BLACK) continue;
    cells[i] = BLACK;
    placed++;
    if (cells[mirror] !== BLACK) {
      cells[mirror] = BLACK;
      placed++;
    }
  }
  return { w, h, cells };
}

/**
 * 白マスをすべて照らす照明配置をランダムに1つ作る。
 * 「まだ照らされていないマス u を選び、u を照らせて、かつ今まだ照らされて
 *  いないマスに置く」を繰り返す。u 自身が必ず候補に残るので必ず成功する。
 */
function randomFullPlacement(ix, rng) {
  const { whites, beams, w, h } = ix;
  const st = new Int8Array(w * h);
  const lit = new Uint8Array(w * h);
  const unlit = new Set(whites);
  while (unlit.size > 0) {
    const pick = Math.floor(rng() * unlit.size);
    let u = -1;
    let k = 0;
    for (const v of unlit) {
      if (k++ === pick) {
        u = v;
        break;
      }
    }
    const cand = [];
    for (const j of beams[u]) if (!lit[j]) cand.push(j);
    const c = cand[Math.floor(rng() * cand.length)];
    st[c] = LAMP;
    for (const j of beams[c]) {
      if (!lit[j]) {
        lit[j] = 1;
        unlit.delete(j);
      }
    }
  }
  for (const i of whites) if (st[i] !== LAMP) st[i] = EMPTY;
  return st;
}

/** 配置から、すべての黒マスの数字を計算して盤面に書き込む。 */
function fillAllHints(puzzle, st) {
  const { w, h, cells } = puzzle;
  const out = new Int8Array(cells);
  for (let i = 0; i < w * h; i++) {
    if (isWhite(cells[i])) continue;
    const x0 = i % w;
    const y0 = (i - x0) / w;
    let lamps = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const j = y * w + x;
      if (isWhite(cells[j]) && st[j] === LAMP) lamps++;
    }
    out[i] = lamps;
  }
  return { w, h, cells: out };
}

/**
 * `generate` が諦めるまでの既定の試行回数。
 *
 * 道具側（`tools/soak.mjs`）が「実際に何回目で当たったか」と突き合わせて
 * 余裕を測るので、数値をそちらへ書き写さず、ここを唯一の出どころにする。
 */
export const DEFAULT_ATTEMPTS = 2000;

/**
 * 一意解の問題を1つ作る。
 *
 * 手順は「完成形を作る → 全黒マスに数字を入れる → 数字を1つずつ外し、
 * 解が一意のままかソルバで検査する」の削り出し方式。
 * 数字を外すほど解は増えこそすれ減らないので、1周すれば
 * 「どの数字を1つ外しても一意でなくなる」極小の問題になる。
 *
 * @param {object} opt
 * @param {number} opt.w 横幅（既定 7）
 * @param {number} opt.h 高さ（既定 7）
 * @param {number} opt.blackRatio 黒マスの割合（既定 0.2）
 * @param {Function} opt.rng 0..1 の乱数。省略時は Math.random
 * @param {boolean} opt.logicOnly true なら「分岐なしで解ける」問題だけ作る
 * @param {number} opt.attempts 諦めるまでの試行回数（既定 DEFAULT_ATTEMPTS = 2000）
 *
 * 試行回数について: 盤面の採用率は実測で easy 10.3% / normal 3.3% / hard 2.4%
 * （日替わり 730 日ぶん 2190 問の総試行回数から逆算。難易度ごとに 60 回だけ
 * 生成して出した旧値 normal 3.8% / hard 1.9% はここで置き換えた）。
 * 捨てられる理由はほぼ全部「全黒マスに数字を入れてもなお解が一意にならない」で、
 * 1回の試行は 0.19〜0.33ms 程度。
 *
 * 既定が 200 回だった頃は、種が日付で決まる dailyPuzzle において
 * 特定の日（2027-01-01 と 2027-06-21）が必ず「作れませんでした」になっていた。
 * これは確率的な事故ではなく、実際に必要な回数が 200 を超える日が
 * 素で存在したということ: 同じ 730 日を測ると、当たるまでに要した回数は
 * hard で最悪 241 回（2027-10-30）、normal で 167 回、easy で 58 回だった。
 *
 * 2000 回は、その実測の最悪値（241）に対して約 8 倍の余裕がある。
 * 幾何分布で見ても hard の失敗見込みは 1e-21 程度。成功する種では
 * 打ち切り回数を増やしても出来上がる問題は変わらない。
 *
 * この余裕は `npm run soak` が毎回報告する。採用率が下がる向きの変更
 * （blackRatio や logicOnly を触るなど）を入れると、失敗 0 件のまま
 * 余裕だけが削れていくので、そちらを早期警報として見ること。
 */
export function generate(opt = {}) {
  const {
    w = 7,
    h = 7,
    blackRatio = 0.2,
    rng = Math.random,
    logicOnly = true,
    attempts = DEFAULT_ATTEMPTS,
  } = opt;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = makeLayout(w, h, blackRatio, rng);
    const layoutIx = buildIndex(layout);
    if (layoutIx.whites.length === 0) continue;

    const solution = randomFullPlacement(layoutIx, rng);
    let puzzle = fillAllHints(layout, solution);

    // 数字を全部入れた状態ですら一意でないなら、この盤面は捨てる
    let ix = buildIndex(puzzle);
    if (solve(ix, 2).count !== 1) continue;

    // 数字を1つずつ外していく（外せなかった数字は以後も外せない）
    const hints = [];
    for (let i = 0; i < w * h; i++) if (hintOf(puzzle.cells[i]) !== null) hints.push(i);
    shuffle(hints, rng);
    let removed = 0;
    for (const i of hints) {
      const trial = new Int8Array(puzzle.cells);
      trial[i] = BLACK;
      const trialPuzzle = { w, h, cells: trial };
      const trialIx = buildIndex(trialPuzzle);
      const r = solve(trialIx, 2);
      if (r.count !== 1) continue;
      if (logicOnly && !solvableByLogicAlone(trialIx)) continue;
      puzzle = trialPuzzle;
      ix = trialIx;
      removed++;
    }

    const final = solve(ix, 2);
    if (final.count !== 1) continue; // 念のため
    if (logicOnly && !final.logicOnly) continue;

    return {
      puzzle,
      solution: final.solutions[0],
      stats: {
        attempt: attempt + 1,
        whites: layoutIx.whites.length,
        blacks: w * h - layoutIx.whites.length,
        lamps: layoutIx.whites.filter((i) => final.solutions[0][i] === LAMP).length,
        hints: hints.length - removed,
        removedHints: removed,
        guesses: final.guesses,
        logicOnly: final.logicOnly,
      },
    };
  }
  return null;
}

// -------------------------------------------------------------- 日替わり

/** 難易度の設定。日替わりは曜日で切り替える想定で、後から増やせる。 */
export const DIFFICULTIES = {
  easy: { w: 7, h: 7, blackRatio: 0.2, logicOnly: true },
  normal: { w: 9, h: 9, blackRatio: 0.2, logicOnly: true },
  hard: { w: 10, h: 10, blackRatio: 0.18, logicOnly: false },
};

/** 'YYYY-MM-DD' を受け取って、その日の問題を決定的に作る。サーバも DB も要らない。 */
export function dailyPuzzle(dateStr, difficulty = 'normal') {
  const conf = DIFFICULTIES[difficulty];
  if (!conf) throw new Error(`知らない難易度: ${difficulty}`);
  const rng = makeRng(seedFrom(`akari|${dateStr}|${difficulty}`));
  const res = generate({ ...conf, rng });
  if (!res) throw new Error(`${dateStr} の問題を作れませんでした`);
  return { date: dateStr, difficulty, ...res };
}

/** ローカル時刻の日付を 'YYYY-MM-DD' で返す。 */
export function todayString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
