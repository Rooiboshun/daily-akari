/*
 * UI の自動テスト。ヘッドレス Chrome で tools/selftest.html を開き、
 * 本物の index.html + src/ui.js に対して実際に click / 右クリックを投げて、
 * ページが自己申告した結果 (JSON) を読む。
 *
 *   npm run uitest
 *   npm run uitest -- /daily-akari   → サブパスの下に置いた状態で検査
 *
 * 既定では root 配信と `/daily-akari` 配信の両方で同じ検査を回す。
 * 後者は rooiboshun.github.io/daily-akari/ のように「サイトの root ではない
 * 場所」へ公開したときに、相対パスのまま壊れないことを実測するためのもの。
 *
 * Chrome の場所は環境変数 CHROME で上書きできる。
 * 追加の依存パッケージは要らない（Chrome だけ手元にあればよい）。
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

function findBrowser() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

const unescapeHtml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function dumpDom(browser, url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-uitest-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=20000',
    '--dump-dom',
    url,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      fs.rmSync(profile, { recursive: true, force: true });
      if (!out) reject(new Error(`Chrome が何も出力しませんでした (code=${code})\n${err}`));
      else resolve(out);
    });
  });
}

const browser = findBrowser();
if (!browser) {
  console.error('Chrome か Edge が見つかりません。環境変数 CHROME で場所を指定してください。');
  process.exit(2);
}

/** 1つの配信場所で検査を1周し、結果を返す。 */
async function runAt(base) {
  const server = createServer({ base });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let dom;
  try {
    dom = await dumpDom(browser, `http://127.0.0.1:${port}${base}/tools/selftest.html`);
  } finally {
    server.close();
  }

  const m = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!m) return { ok: false, fatal: '結果が見つかりませんでした（ページが動いていない可能性）', results: [] };
  try {
    return JSON.parse(unescapeHtml(m[1]));
  } catch {
    return { ok: false, fatal: `結果を読めません: ${unescapeHtml(m[1]).slice(0, 200)}`, results: [] };
  }
}

// 引数でサブパスを指定したらそこだけ。無指定なら root と /daily-akari の両方。
const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const bases = arg !== undefined ? [normalizeBase(arg)] : ['', '/daily-akari'];

let okTotal = 0;
let ngTotal = 0;
for (const base of bases) {
  console.log(`\n=== 配信場所: ${base || '/'} ===`);
  const report = await runAt(base);
  if (report.fatal) console.error('致命的エラー:', report.fatal);
  for (const r of report.results || []) {
    console.log(`${r.ok ? 'OK  ' : 'NG  '}${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const list = report.results || [];
  const ng = list.filter((r) => !r.ok).length + (report.fatal ? 1 : 0);
  okTotal += list.length - list.filter((r) => !r.ok).length;
  ngTotal += ng;
}

console.log(`\n結果: ${okTotal} 件 OK / ${ngTotal} 件 NG`);
process.exit(ngTotal === 0 ? 0 : 1);
