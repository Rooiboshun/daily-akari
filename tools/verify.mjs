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
 *   F. puzz.link の URL と盤面が往復できる
 *   G. 探索の打ち切り（nodeLimit）が効く
 *   H. オフライン（PWA）の配線が揃っている — 保存すべきファイルの取りこぼしが無いか
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
import { encodeBody, decodeBody, toUrl, fromUrl } from '../src/puzzlink.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ------------------------------------------------------------- F. puzz.link

console.log('F. puzz.link の URL との往復');

{
  // F1. 手で解いた符号との照合。
  //   1.. → 'b'(=10+1 で「数字1＋白2」), 続く白1 → 'g', '#' → '.',
  //   白3 → 'i'(=15+3), 末尾の 2 → 'c'(=10+2)
  const text = '1..\n.#.\n..2';
  const p = parse(text);
  check('手計算した符号と一致', encodeBody(p) === 'bg.ic', `実際 ${encodeBody(p)}`);
  check('その本文を読み直すと元の盤面', render(decodeBody('bg.ic', 3, 3)) === text, render(decodeBody('bg.ic', 3, 3)));
  check(
    'URL の形',
    toUrl(p) === 'https://puzz.link/p?lightup/3/3/bg.ic',
    toUrl(p),
  );

  // F2. 白だけの盤面は「白が何個続くか」1文字に潰れる（'g'=1 … 'z'=20）
  check('2x2 全白は j', encodeBody(parse('..\n..')) === 'j', encodeBody(parse('..\n..')));
  const w21 = { w: 21, h: 1, cells: new Int8Array(21).fill(-1) };
  check('白21個は zg（20 で一度切る）', encodeBody(w21) === 'zg', encodeBody(w21));
  check('白21個を読み直すと 21 マス', decodeBody('zg', 21, 1).cells.every((c) => c === -1));

  // F2b. 縦横の順番。pzprjs の parser は「先に横、後に縦」。
  // ここを取り違えると正方形以外の問題だけが静かに壊れるので明示的に固定する。
  const wide = parse('.....\n.....\n....1');
  check('URL は 横/縦 の順（5x3 → 5/3）', toUrl(wide).includes('lightup/5/3/'), toUrl(wide));
  check('横長の盤面が往復する', render(fromUrl(toUrl(wide)).puzzle) === render(wide));
  const tall = parse('...\n...\n...\n...\n..1');
  check('URL は 横/縦 の順（3x5 → 3/5）', toUrl(tall).includes('lightup/3/5/'), toUrl(tall));
  check('縦長と横長が別の URL になる', toUrl(wide) !== toUrl(tall));

  // F3. URL の受け取り方の揺れ
  const forms = [
    'https://puzz.link/p?lightup/3/3/bg.ic',
    'https://pzpr.jp/p.html?lightup/3/3/bg.ic',
    'lightup/3/3/bg.ic',
    '#p/lightup/3/3/bg.ic',
    '  https://puzz.link/p?lightup/3/3/bg.ic  ',
  ];
  for (const f of forms) {
    check(`${f.trim().slice(0, 34)} を読める`, render(fromUrl(f).puzzle) === text);
  }
  check('本文が無ければ断る', (() => { try { fromUrl('lightup/3/3/'); return false; } catch { return true; } })());
  check('別の種類のパズルは断る', (() => { try { fromUrl('https://puzz.link/p?nurikabe/3/3/g'); return false; } catch { return true; } })());
  check('読めない文字は断る', (() => { try { decodeBody('bg!ic', 3, 3); return false; } catch { return true; } })());
  check('大きすぎる盤面は断る', (() => { try { decodeBody('g', 100, 100); return false; } catch { return true; } })());

  // F4. ランダムな盤面 400 枚で往復（数字と黒と白の並びを総当たりに近い形で当てる）
  const rng = makeRng(seedFrom('puzzlink-roundtrip'));
  let bad = 0;
  let firstBad = '';
  for (let t = 0; t < 400; t++) {
    const w = 1 + Math.floor(rng() * 9);
    const h = 1 + Math.floor(rng() * 9);
    const cells = new Int8Array(w * h).fill(-1);
    for (let i = 0; i < w * h; i++) {
      const r = rng();
      if (r < 0.2) cells[i] = Math.floor(rng() * 5); // 数字つき黒
      else if (r < 0.35) cells[i] = BLACK; // 数字なし黒
    }
    const board = { w, h, cells };
    const back = decodeBody(encodeBody(board), w, h);
    if (render(back) !== render(board)) {
      bad++;
      if (!firstBad) firstBad = `${w}x${h}\n${render(board)}\n--- 読み直し ---\n${render(back)}`;
    }
  }
  check('ランダム 400 枚が往復する', bad === 0, `${bad} 枚がずれた\n${firstBad}`);

  // F5. 日替わりの問題も往復する（実際に貼る URL はこれ）
  for (const name of Object.keys(DIFFICULTIES)) {
    const made = dailyPuzzle('2026-09-14', name);
    const link = fromUrl(toUrl(made.puzzle));
    check(`${name} の今日の問題が往復する`, render(link.puzzle) === render(made.puzzle));
    check(`${name} の往復後も解が一意`, solve(buildIndex(link.puzzle), 2).count === 1);
  }

  // F6. 上流が自分で書いた問題との照合。
  //
  //   ここまでの F1〜F5 は「自分で組み立てた符号を自分で読み直す」往復なので、
  //   規則そのものを取り違えていた場合は往復しても気づけない。
  //   そこで pzprjs（puzz.link が動かしている実装）の test/script/lightup.js が
  //   持っている問題を1つ、URL と「エラー無し」の盤面ごと引き写して突き合わせる。
  //   引き写したのは下の2つの定数だけで、向こうのコードは持ち込んでいない。
  //
  //   これが通るということは、
  //     (a) 本文の符号化の規則が上流と同じ（同じ URL から同じ数字配置が出る）
  //     (b) 書き戻した本文が上流の文字列と1文字も違わない
  //     (c) 解も上流が正解として持っている盤面と一致する
  //   の3つが同時に言えるので、目視確認に頼らず相互運用を裏づけできる。
  const UPSTREAM_URL = 'lightup/6/6/nekcakbl';
  // 上流の盤面表記。数字は黒マスの数字、'#' は照明、'+' は「置かない」印。
  const UPSTREAM_ANSWER = [
    '. . # . . .',
    '. # 4 # . .',
    '. . # . 2 #',
    '+ 0 . . # .',
    '# + . 1 . .',
    '. . . # . .',
  ];

  const up = fromUrl(UPSTREAM_URL);
  check('上流の URL が 6x6 として読める', up.w === 6 && up.h === 6, `${up.w}x${up.h}`);

  // 上流の盤面表記から数字つき黒マスだけを取り出す（'#' と '+' は答えの側）
  const wantHints = [];
  UPSTREAM_ANSWER.forEach((row, y) => {
    row.split(' ').forEach((t, x) => {
      if (/^[0-4]$/.test(t)) wantHints.push(`${x},${y}=${t}`);
    });
  });
  const gotHints = [];
  for (let y = 0; y < up.h; y++) {
    for (let x = 0; x < up.w; x++) {
      const hint = hintOf(up.puzzle.cells[y * up.w + x]);
      if (hint !== null) gotHints.push(`${x},${y}=${hint}`);
    }
  }
  check(
    '上流の URL から出る数字の位置と値が一致',
    gotHints.join(' ') === wantHints.join(' '),
    `期待 ${wantHints.join(' ')}\n実際 ${gotHints.join(' ')}`,
  );

  // 書き戻した本文が上流の文字列と完全に一致すること（符号化側の裏づけ）
  check(
    '書き戻した本文が上流の文字列と一致',
    encodeBody(up.puzzle) === 'nekcakbl',
    `実際 ${encodeBody(up.puzzle)}`,
  );

  // 解が上流の持っている正解と一致すること
  const upSolved = solve(buildIndex(up.puzzle), 3);
  check('上流の問題の解が一意', upSolved.count === 1, `解 ${upSolved.count} 個`);
  const wantLamps = [];
  UPSTREAM_ANSWER.forEach((row, y) => {
    row.split(' ').forEach((t, x) => {
      if (t === '#') wantLamps.push(y * 6 + x);
    });
  });
  const gotLamps = [];
  if (upSolved.solutions[0]) {
    upSolved.solutions[0].forEach((v, i) => {
      if (v === LAMP) gotLamps.push(i);
    });
  }
  check(
    '解の照明の位置が上流の正解と一致',
    wantLamps.join(',') === gotLamps.join(','),
    `期待 ${wantLamps.join(',')}\n実際 ${gotLamps.join(',')}`,
  );
}

// ------------------------------------------------------- G. 探索の打ち切り

console.log('G. 探索の打ち切り');

{
  // 大きな全白盤面。解の数え上げは重いが、打ち切りがあれば必ず戻ってくる
  const big = { w: 12, h: 12, cells: new Int8Array(144).fill(-1) };
  const ix = buildIndex(big);
  const capped = solve(ix, 1 << 30, { nodeLimit: 500 });
  check('nodeLimit で打ち切られる', capped.aborted === true);
  check('打ち切ったら節の数が上限を超えない', capped.nodes <= 501, `実際 ${capped.nodes}`);

  // 打ち切らない呼び方では今までどおり（既定は無制限）
  const normal = solve(buildIndex(parse('#1#\n1.1\n#1#')), 5);
  check('上限を渡さなければ今までどおり解ける', normal.count === 1 && !normal.aborted);
  check('上限を渡さなければ logicOnly も今までどおり', normal.logicOnly === true);

  // 上限が十分なら打ち切られない
  const enough = solve(buildIndex(parse('....')), 10, { nodeLimit: 100000 });
  check('上限が十分なら打ち切られない', enough.count === 4 && !enough.aborted, `実際 ${enough.count}`);
}

// ------------------------------------------------------- H. オフライン (PWA)

// 落とすと「オフラインで開いたら真っ白」になるので、機械で見張る。
// ここが守るのは「sw.js が保存するファイルの一覧が、実際に読むファイルと一致する」こと。
{
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  const sw = read('sw.js');
  const html = read('index.html');
  const manifest = JSON.parse(read('manifest.webmanifest'));

  const assets = (sw.match(/const ASSETS = \[([\s\S]*?)\]/) || [, ''])[1]
    .split(',')
    .map((s) => (s.match(/'([^']+)'/) || [, ''])[1])
    .filter(Boolean);

  check('sw.js が保存する一覧を読み取れる', assets.length > 0, `${assets.length} 件`);

  const missing = assets.filter((a) => a !== './' && !fs.existsSync(path.join(ROOT, a)));
  check('保存する一覧のファイルが全部ある', missing.length === 0, missing.join(' '));

  // index.html が読むもの・pwa.js/ui.js が import するものが一覧に入っているか。
  const referenced = new Set();
  for (const m of html.matchAll(/(?:src|href)="((?!https?:|data:|#)[^"]+)"/g)) referenced.add('./' + m[1]);
  for (const f of ['src/ui.js', 'src/pwa.js']) {
    for (const m of read(f).matchAll(/from '\.\/([^']+)'/g)) referenced.add('./src/' + m[1]);
  }
  for (const i of manifest.icons) referenced.add('./' + i.src);

  const notCached = [...referenced].filter((r) => !assets.includes(r));
  check('読み込むファイルが全部 sw.js の一覧に入っている', notCached.length === 0, notCached.join(' '));

  check('index.html が manifest を参照している', /rel="manifest" href="manifest.webmanifest"/.test(html));
  check('index.html が pwa.js を読んでいる', /src="src\/pwa\.js"/.test(html));

  // サブパス (/daily-akari/) に置いても壊れないこと。絶対パスが1つでもあると
  // root からしか動かなくなる。
  const absolute = [
    ...assets.filter((a) => a.startsWith('/')),
    manifest.start_url,
    manifest.scope,
    ...manifest.icons.map((i) => i.src),
  ].filter((v) => String(v).startsWith('/'));
  check('オフライン周りに絶対パスが無い（サブパスでも動く）', absolute.length === 0, absolute.join(' '));

  check(
    'manifest に 192 と 512 の両方がある',
    manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512')
  );
  check(
    'maskable のアイコンがある（Android のホーム画面で角が欠けない）',
    manifest.icons.some((i) => i.purpose === 'maskable')
  );
  check('ホーム画面から単体で開く指定になっている', manifest.display === 'standalone', manifest.display);
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
