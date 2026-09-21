/*
 * オフラインで本当に遊べるかの実測。
 *
 *   npm run offlinetest
 *   npm run offlinetest -- /daily-akari   → サブパスの下に置いた状態で検査
 *
 * やり方は単純で、「一度開いてから、サーバを止めて、もう一度開く」。
 *
 *   1. サーバを立てて開く（Service Worker が入り、ファイルが保存される）
 *   2. もう一度開く（保存済みの版で起動することを確かめる）
 *   3. **サーバを止めて**もう一度開く ← ここが本番。回線が無い状態そのもの
 *
 * Chrome のプロファイル（保存先）を3回で使い回すので、3 回目は本当に
 * 手元の保存だけで動いている。盤面のマスが描かれていれば、JS もソルバも
 * 保存から読めているということ（問題は端末の中で作られるので通信は要らない）。
 *
 * verify.mjs の H 章が「一覧の取りこぼし」を静的に見るのに対して、
 * こちらは実際にブラウザを落として動かす。Chrome だけ手元にあればよい。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, normalizeBase } from './serve.mjs';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('Chrome か Edge が見つかりません。環境変数 CHROME で場所を指定してください。');
  process.exit(2);
}

function dumpDom(profile, url) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=20000', // JS が動き終わるのを待つ（これが無いと空の DOM が出る）
    '--dump-dom',
    url,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (out ? resolve(out) : reject(new Error(`Chrome が何も出力しませんでした (code=${code})`))));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cells = (dom) => (dom.match(/class="cell (?:white|black)/g) || []).length;

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`OK  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    fail++;
    console.log(`NG  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const base = normalizeBase(process.argv[2]);
const port = 8127;
const url = `http://127.0.0.1:${port}${base}/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-offline-'));

const server = createServer({ base });
await new Promise((r) => server.listen(port, '127.0.0.1', r));
console.log(`検査する場所: ${url}\n`);

try {
  // 1回目 — Service Worker が入る。ここでファイルが保存される。
  const first = await dumpDom(profile, url);
  check('1回目: 盤面が描かれる', cells(first) > 0, `${cells(first)} マス`);

  // 2回目 — 保存済みの版が使われ、状態表示が「遊べます」になる。
  //
  // 保存はページを閉じた後も続くことがあり、機械の混み具合で何秒かかるか
  // 読めない。固定の待ち時間を置くと「混んでいる日だけ落ちる」検査になるので、
  // 表示が変わるまで開き直して待つ（最大 5 回）。
  let second = '';
  for (let i = 0; i < 5; i++) {
    second = await dumpDom(profile, url);
    if (/オフラインで遊べます|オフラインで動いています/.test(second)) break;
    await sleep(1000);
  }
  check('2回目: 盤面が描かれる', cells(second) > 0, `${cells(second)} マス`);
  check('2回目: オフライン保存が済んだ表示になる', /オフラインで遊べます|オフラインで動いています/.test(second));

  // 3回目 — サーバを止める。ここから先は通信が一切できない。
  await new Promise((r) => server.close(r));
  const third = await dumpDom(profile, url);
  check('サーバを止めても盤面が描かれる', cells(third) > 0, `${cells(third)} マス`);
  check('止めた後も日付が出る', /id="seedline"[^>]*>[^<]+</.test(third));
  check('止めた後も難易度が選べる', /class="chip"/.test(third));
  // 表示は navigator.onLine を見ているので、「サーバだけ止めた」この検査では
  // 回線がある側の文言が出る。ここで確かめたいのは「失敗表示になっていない」こと。
  check('止めた後も保存済みの表示のまま', /オフラインで遊べます|オフラインで動いています/.test(third));
  check('止めた後に失敗表示が出ない', !/オフライン保存に失敗/.test(third));
} finally {
  if (server.listening) await new Promise((r) => server.close(r));
  fs.rmSync(profile, { recursive: true, force: true });
}

console.log(`\n結果: ${pass} 件 OK / ${fail} 件 NG`);
process.exit(fail > 0 ? 1 : 0);
