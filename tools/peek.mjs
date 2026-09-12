/*
 * その日の問題を覗くための小さな道具。
 *
 *   node tools/peek.mjs                      今日の normal
 *   node tools/peek.mjs 2026-09-20 hard      日付と難易度を指定
 *   node tools/peek.mjs 2026-09-20 hard -a   答えも表示
 */

import { render, dailyPuzzle, todayString, DIFFICULTIES } from '../src/akari.js';

const args = process.argv.slice(2);
const showAnswer = args.includes('-a') || args.includes('--answer');
const rest = args.filter((a) => !a.startsWith('-'));
const date = rest[0] || todayString();
const difficulty = rest[1] || 'normal';

if (!DIFFICULTIES[difficulty]) {
  console.error(`知らない難易度: ${difficulty}（使えるのは ${Object.keys(DIFFICULTIES).join(' / ')}）`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`日付は YYYY-MM-DD で: ${date}`);
  process.exit(1);
}

const t0 = Date.now();
const res = dailyPuzzle(date, difficulty);
const ms = Date.now() - t0;

console.log(`${date} / ${difficulty} (${res.puzzle.w}x${res.puzzle.h})  生成 ${ms}ms`);
console.log(render(res.puzzle));
if (showAnswer) {
  console.log('\n--- 答え ---');
  console.log(render(res.puzzle, res.solution));
}
console.log(
  `\n黒マス ${res.stats.blacks} / 数字 ${res.stats.hints} / 照明 ${res.stats.lamps} / ` +
    `${res.stats.logicOnly ? '分岐なしで解ける' : '試行錯誤が要る'}`
);
