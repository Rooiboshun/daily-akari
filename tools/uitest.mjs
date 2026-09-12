/*
 * UI の自動テスト。ヘッドレス Chrome で tools/selftest.html を開き、
 * 本物の index.html + src/ui.js に対して実際に click / 右クリックを投げて、
 * ページが自己申告した結果 (JSON) を読む。
 *
 *   npm run uitest
 *
 * Chrome の場所は環境変数 CHROME で上書きできる。
 * 追加の依存パッケージは要らない（Chrome だけ手元にあればよい）。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from './serve.mjs';

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

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let dom;
try {
  dom = await dumpDom(browser, `http://127.0.0.1:${port}/tools/selftest.html`);
} finally {
  server.close();
}

const m = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error('結果が見つかりませんでした。ページが動いていない可能性があります。');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(unescapeHtml(m[1]));
} catch (e) {
  console.error('結果を読めませんでした:', unescapeHtml(m[1]).slice(0, 400));
  process.exit(1);
}

if (report.fatal) console.error('致命的エラー:', report.fatal);
for (const r of report.results || []) {
  console.log(`${r.ok ? 'OK  ' : 'NG  '}${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const ng = (report.results || []).filter((r) => !r.ok).length;
console.log(`\n結果: ${(report.results || []).length - ng} 件 OK / ${ng} 件 NG`);
process.exit(report.ok ? 0 : 1);
