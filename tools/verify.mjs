/*
 * ソルバと一意解ジェネレータの検証。
 *
 *   node tools/verify.mjs
 *
 * 確かめること:
 *   A. ソルバが手元の既知の問題を正しく解く（解の数まで含めて）
 *   B. 生成した盤面が本当に一意解になっている（生成器とは独立に解き直す）
 *   C. 出てきた解がルールを満たしている
 *   D. 数字が極小になっている（どれか1つ外すと条件が崩れる）
 *   E. 同じ日付なら必ず同じ問題が出る（日替わりが決定的）
 */

import {
  parse,
  render,
  buildIndex,
  solve,
  isValidSolution,
  solvableByLogicAlone,
  generate,
  makeRng,
  seedFrom,
  dailyPuzzle,
  DIFFICULTIES,
  BLACK,
  LAMP,
  hintOf,
} from '../src/akari.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- A. ソルバ

console.log('A. ソルバの基本動作');

{
  // 3x3 の全白。照明は行も列も重ねられないので、解は 3x3 の置換行列 6 通り
  // ちょうど（2個以下では必ず照らし残しが出て、4個以上は同じ行に入る）。
  const ix = buildIndex(parse('...\n...\n...'));
  const r = solve(ix, 100);
  check('3x3 全白の解が6通り', r.count === 6, `実際 ${r.count}`);
  for (const s of r.solutions) check('3x3 の解がルールを満たす', isValidSolution(ix, s));
}

{
  // 数字で完全に縛った例。1マスの白を 4 が囲む → そこに照明が1つ。
  const ix = buildIndex(parse('#1#\n1.1\n#1#'));
  const r = solve(ix, 5);
  check('四方を 1 に囲まれた1マスは一意', r.count === 1, `実際 ${r.count}`);
  check('その解は中央が照明', r.count === 1 && r.solutions[0][4] === LAMP);
  check('分岐なしで解ける', r.logicOnly);
}

{
  // 0 は「隣に照明を置くな」。1x3 の白の真ん中を 0 で塞ぐ形。
  const ix = buildIndex(parse('#0#\n...\n#0#'));
  const r = solve(ix, 10);
  check('0 制約つきでも解が出る', r.count >= 1, `実際 ${r.count}`);
  for (const s of r.solutions) {
    check('0 の隣に照明が無い', s[1] !== LAMP && s[7] !== LAMP);
    check('0 制約の解がルールを満たす', isValidSolution(ix, s));
  }
}

{
  // 照らし合い禁止の検出。横一列の白 4 マスに照明は必ず1つだけ。
  const ix = buildIndex(parse('....'));
  const r = solve(ix, 10);
  check('横一列 4 マスの解は4通り', r.count === 4, `実際 ${r.count}`);
  for (const s of r.solutions) {
    const lamps = [0, 1, 2, 3].filter((i) => s[i] === LAMP).length;
    check('一列に照明は1つだけ', lamps === 1, `実際 ${lamps}`);
  }
}

{
  // 解なしの例: 2 なのに隣接する白マスが 1 つしかない
  const ix = buildIndex(parse('#2#\n#.#\n###'));
  const r = solve(ix, 5);
  check('満たせない数字の問題は解なし', r.count === 0, `実際 ${r.count}`);
}

{
  // 白マスが無い盤面は「解が1つ（何も置かない）」
  const ix = buildIndex(parse('##\n##'));
  const r = solve(ix, 5);
  check('全部黒なら解は1つ', r.count === 1, `実際 ${r.count}`);
}

// ------------------------------------------- A2. 総当たりとの突き合わせ

// 小さな盤面をランダムに作り、「全白マスの部分集合を全部試す」愚直な数え上げと
// ソルバの答えが一致するかを見る。制約伝播と分岐の刈り方が解を落としたり
// 二重に数えたりしていないことの裏取り。
console.log('A2. 総当たりとの突き合わせ (4x4 をランダムに 60 盤面)');
{
  const rng = makeRng(seedFrom('brute-force'));
  let mismatched = 0;
  let totalSolutions = 0;
  for (let t = 0; t < 60; t++) {
    const w = 4;
    const h = 4;
    const cells = new Int8Array(w * h).fill(-1); // WHITE
    for (let i = 0; i < w * h; i++) {
      if (rng() < 0.3) cells[i] = rng() < 0.6 ? Math.floor(rng() * 5) : BLACK;
    }
    const ix = buildIndex({ w, h, cells });
    const nW = ix.whites.length;
    if (nW > 14) continue;

    // 愚直: 白マスの部分集合を全部試す
    let brute = 0;
    for (let mask = 0; mask < 1 << nW; mask++) {
      const st = new Int8Array(w * h);
      for (let k = 0; k < nW; k++) st[ix.whites[k]] = mask & (1 << k) ? LAMP : 2;
      if (isValidSolution(ix, st)) brute++;
    }
    const r = solve(ix, 1 << 20);
    totalSolutions += brute;
    if (r.count !== brute) {
      mismatched++;
      check(`4x4 #${t} の解の数が総当たりと一致`, false, `ソルバ ${r.count} / 総当たり ${brute}\n${render({ w, h, cells })}`);
    }
  }
  check('60 盤面すべてで総当たりと一致', mismatched === 0, `${mismatched} 盤面がずれた`);
  check('突き合わせに中身があった（解が1つ以上出ている）', totalSolutions > 0, `解の総数 ${totalSolutions}`);
}

// ------------------------------------------------- B/C/D. 生成した盤面の検証

console.log('B/C/D. 生成した盤面の一意性・妥当性・極小性');

const PER_DIFF = 12;
const summary = {};

for (const name of Object.keys(DIFFICULTIES)) {
  const conf = DIFFICULTIES[name];
  const rec = { made: 0, unique: 0, minimal: 0, logicOnly: 0, needsGuess: 0, hints: [], lamps: [], ms: [] };
  for (let k = 0; k < PER_DIFF; k++) {
    const rng = makeRng(seedFrom(`verify|${name}|${k}`));
    const t0 = Date.now();
    const res = generate({ ...conf, rng });
    const ms = Date.now() - t0;
    check(`${name} #${k} 生成に成功`, res !== null);
    if (!res) continue;
    rec.made++;
    rec.ms.push(ms);

    // --- 生成器の戻り値を信じず、盤面テキストから読み直して解く
    const text = render(res.puzzle);
    const reIx = buildIndex(parse(text));
    const r = solve(reIx, 2);
    if (r.count === 1) rec.unique++;
    check(`${name} #${k} 解が一意`, r.count === 1, `実際 ${r.count}\n${text}`);
    if (r.count !== 1) continue;

    check(`${name} #${k} 解がルールを満たす`, isValidSolution(reIx, r.solutions[0]));

    // 生成器が持っていた解と、解き直した解が一致すること
    let same = true;
    for (const i of reIx.whites) if (r.solutions[0][i] !== res.solution[i]) same = false;
    check(`${name} #${k} 生成時の解と一致`, same);

    if (r.logicOnly) rec.logicOnly++;
    else rec.needsGuess++;
    if (conf.logicOnly) check(`${name} #${k} 分岐なしで解ける`, r.logicOnly);

    // --- 極小性: 残った数字をどれか1つ外すと、条件（一意 かつ 難易度）が崩れる
    let minimal = true;
    let firstBreak = '';
    for (let i = 0; i < res.puzzle.w * res.puzzle.h; i++) {
      if (hintOf(res.puzzle.cells[i]) === null) continue;
      const trial = new Int8Array(res.puzzle.cells);
      trial[i] = BLACK;
      const tIx = buildIndex({ w: res.puzzle.w, h: res.puzzle.h, cells: trial });
      const tr = solve(tIx, 2);
      const stillOk = tr.count === 1 && (!conf.logicOnly || solvableByLogicAlone(tIx) !== null);
      if (stillOk) {
        minimal = false;
        firstBreak = `マス ${i} の数字は外しても条件を保つ`;
        break;
      }
    }
    if (minimal) rec.minimal++;
    check(`${name} #${k} 数字が極小`, minimal, firstBreak);

    rec.hints.push(res.stats.hints);
    rec.lamps.push(res.stats.lamps);
  }
  summary[name] = rec;
}

// ---------------------------------------------------------------- E. 日替わり

console.log('E. 日替わりの決定性');

const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2027-01-01'];
const seen = new Set();
for (const d of dates) {
  const a = dailyPuzzle(d, 'normal');
  const b = dailyPuzzle(d, 'normal');
  check(`${d} は何度作っても同じ問題`, render(a.puzzle) === render(b.puzzle));
  const ix = buildIndex(parse(render(a.puzzle)));
  check(`${d} の問題が一意解`, solve(ix, 2).count === 1);
  seen.add(render(a.puzzle));
}
check('日付が違えば別の問題になる', seen.size === dates.length, `重複あり (${seen.size}/${dates.length})`);

{
  const easy = render(dailyPuzzle('2026-09-13', 'easy').puzzle);
  const normal = render(dailyPuzzle('2026-09-13', 'normal').puzzle);
  check('同じ日でも難易度が違えば別の問題', easy !== normal);
}

// ---------------------------------------------------------------- まとめ

console.log('\n--- 生成の統計 ---');
const avg = (a) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : '-');
for (const [name, r] of Object.entries(summary)) {
  const c = DIFFICULTIES[name];
  console.log(
    `${name.padEnd(6)} ${c.w}x${c.h}  生成 ${r.made}/${PER_DIFF}  一意 ${r.unique}  極小 ${r.minimal}` +
      `  論理のみで解ける ${r.logicOnly}  要試行錯誤 ${r.needsGuess}` +
      `  平均ヒント数 ${avg(r.hints)}  平均照明数 ${avg(r.lamps)}  平均 ${avg(r.ms)}ms`
  );
}

console.log('\n--- 今日の問題 (normal) ---');
const today = dailyPuzzle('2026-09-13', 'normal');
console.log(render(today.puzzle));
console.log('');
console.log(render(today.puzzle, today.solution));

console.log(`\n結果: ${pass} 件 OK / ${fail} 件 NG`);
if (fail > 0) {
  console.log('失敗:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
