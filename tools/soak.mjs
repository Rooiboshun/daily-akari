/*
 * 日替わり問題の連続検査（soak）。
 *
 *   node tools/soak.mjs [開始日 YYYY-MM-DD] [日数] [難易度...]
 *   例: node tools/soak.mjs 2026-09-14 365
 *
 * verify.mjs は各難易度 12 問しか見ないので、「ある日だけ問題が作れない」
 * のような、日付ごとの当たり外れで起きる事故を取りこぼす。ここでは指定した
 * 期間の全日程・全難易度を実際に生成し、1問ずつ次を確かめる。
 *
 *   1. 例外を投げずに生成できる（dailyPuzzle が失敗しない）
 *   2. 盤面テキストから読み直して独立に解いたとき、解がちょうど1つ
 *   3. その解がルールを満たす
 *   4. 生成器が返してきた解と一致する
 *
 * 併せて1問あたりの生成時間を集計する（ブラウザで開いた瞬間に作る前提のため、
 * 平均より最悪値のほうが大事）。失敗が1件でもあれば終了コード 1。
 */

import {
  parse,
  render,
  buildIndex,
  solve,
  isValidSolution,
  dailyPuzzle,
  DIFFICULTIES,
  LAMP,
} from '../src/akari.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const startStr = argv[0] && /^\d{4}-\d{2}-\d{2}$/.test(argv[0]) ? argv[0] : '2026-09-14';
const days = Number(argv[1]) > 0 ? Number(argv[1]) : 365;
const difficulties = argv.slice(2).length > 0 ? argv.slice(2) : Object.keys(DIFFICULTIES);

for (const d of difficulties) {
  if (!DIFFICULTIES[d]) {
    console.error(`知らない難易度: ${d}`);
    process.exit(2);
  }
}

/** 'YYYY-MM-DD' に日数を足す。UTC で数えるので夏時間の影響を受けない。 */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  const p = (v) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

console.log(`${startStr} から ${days} 日ぶん × ${difficulties.join(' / ')} を検査します`);

const failures = [];
const times = Object.fromEntries(difficulties.map((d) => [d, []]));
let checked = 0;

for (let k = 0; k < days; k++) {
  const date = addDays(startStr, k);
  for (const difficulty of difficulties) {
    const t0 = performance.now();
    let res;
    try {
      res = dailyPuzzle(date, difficulty);
    } catch (e) {
      failures.push(`${date} ${difficulty}: 生成に失敗 — ${e.message}`);
      continue;
    }
    times[difficulty].push({ ms: performance.now() - t0, date });

    // 生成器の戻り値を信じずに、盤面テキストから読み直して独立に解く
    const ix = buildIndex(parse(render(res.puzzle)));
    const r = solve(ix, 2);
    checked++;
    if (r.count !== 1) {
      failures.push(`${date} ${difficulty}: 解が ${r.count} 個（一意でない）`);
      continue;
    }
    if (!isValidSolution(ix, r.solutions[0])) {
      failures.push(`${date} ${difficulty}: 解がルールを満たしていない`);
      continue;
    }
    const a = r.solutions[0];
    const b = res.solution;
    for (let i = 0; i < a.length; i++) {
      if ((a[i] === LAMP) !== (b[i] === LAMP)) {
        failures.push(`${date} ${difficulty}: 解き直した答えが生成時の解と違う`);
        break;
      }
    }
  }
}

console.log('\n--- 1問あたりの生成時間 ---');
for (const difficulty of difficulties) {
  const list = times[difficulty];
  if (list.length === 0) continue;
  const ms = list.map((x) => x.ms).sort((p, q) => p - q);
  const avg = ms.reduce((s, x) => s + x, 0) / ms.length;
  const at = (q) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))];
  const worst = list.reduce((p, q) => (q.ms > p.ms ? q : p));
  console.log(
    `${difficulty.padEnd(7)} ${String(list.length).padStart(4)} 問  ` +
      `平均 ${avg.toFixed(1)}ms  中央 ${at(0.5).toFixed(1)}ms  ` +
      `95% ${at(0.95).toFixed(1)}ms  最悪 ${worst.ms.toFixed(1)}ms (${worst.date})`,
  );
}

console.log(`\n生成 ${days * difficulties.length} 問 / 解き直し ${checked} 問`);
if (failures.length === 0) {
  console.log('結果: 失敗 0 件');
} else {
  console.log(`結果: 失敗 ${failures.length} 件`);
  for (const f of failures.slice(0, 50)) console.log(`  NG  ${f}`);
  if (failures.length > 50) console.log(`  … 他 ${failures.length - 50} 件`);
  process.exit(1);
}
