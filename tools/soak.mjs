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
 *
 * さらに「打ち切りまでの余裕」を報告する。1〜4 の合否は事故が起きてから
 * 初めて赤くなる遅行指標で、これだけを見ていると、採用率が下がる向きの変更を
 * 入れても崖から落ちる直前まで緑のままになる。実際に何回目の試行で当たったかと
 * 打ち切り回数（DEFAULT_ATTEMPTS）の比を見ておけば、落ちる前に気づける。
 * 最悪値が打ち切りの HEADROOM_FAIL を超えたら、失敗 0 件でも終了コード 1。
 */

import {
  parse,
  render,
  buildIndex,
  solve,
  isValidSolution,
  dailyPuzzle,
  DIFFICULTIES,
  DEFAULT_ATTEMPTS,
  LAMP,
} from '../src/akari.js';

/** 最悪の試行回数が打ち切りのこの割合を超えたら、失敗が無くても赤にする。 */
const HEADROOM_WARN = 0.25;
const HEADROOM_FAIL = 0.5;

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
const tries = Object.fromEntries(difficulties.map((d) => [d, []]));
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
    tries[difficulty].push({ n: res.stats.attempt, date });

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

console.log(`\n--- 打ち切りまでの余裕（打ち切り ${DEFAULT_ATTEMPTS} 回）---`);
const thin = [];
for (const difficulty of difficulties) {
  const list = tries[difficulty];
  if (list.length === 0) continue;
  const ns = list.map((x) => x.n).sort((p, q) => p - q);
  const at = (q) => ns[Math.min(ns.length - 1, Math.floor(ns.length * q))];
  const worst = list.reduce((p, q) => (q.n > p.n ? q : p));
  const total = ns.reduce((s, x) => s + x, 0);
  const rate = (list.length / total) * 100; // 1問あたり何回の試行で当たったかの逆数
  const margin = DEFAULT_ATTEMPTS / worst.n;
  const used = worst.n / DEFAULT_ATTEMPTS;
  const flag = used > HEADROOM_FAIL ? '  << 危険' : used > HEADROOM_WARN ? '  << 注意' : '';
  console.log(
    `${difficulty.padEnd(7)} 採用率 ${rate.toFixed(2)}%  ` +
      `中央 ${at(0.5)} 回  95% ${at(0.95)} 回  ` +
      `最悪 ${worst.n} 回 (${worst.date})  余裕 ${margin.toFixed(1)}倍${flag}`,
  );
  if (used > HEADROOM_FAIL) {
    thin.push(
      `${difficulty}: 最悪 ${worst.n} 回 (${worst.date}) が打ち切り ${DEFAULT_ATTEMPTS} 回の ` +
        `${(used * 100).toFixed(0)}% に達している（採用率 ${rate.toFixed(2)}%）`,
    );
  }
}

console.log(`\n生成 ${days * difficulties.length} 問 / 解き直し ${checked} 問`);
if (failures.length === 0 && thin.length === 0) {
  console.log('結果: 失敗 0 件');
} else if (failures.length === 0) {
  console.log(`結果: 失敗 0 件 — ただし打ち切りまでの余裕が足りない ${thin.length} 件`);
  for (const t of thin) console.log(`  NG  ${t}`);
  console.log('  打ち切り回数を増やすか、採用率を下げた変更を見直すこと。');
  process.exit(1);
} else {
  console.log(`結果: 失敗 ${failures.length} 件`);
  for (const f of failures.slice(0, 50)) console.log(`  NG  ${f}`);
  if (failures.length > 50) console.log(`  … 他 ${failures.length - 50} 件`);
  process.exit(1);
}
