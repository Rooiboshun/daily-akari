/*
 * 依存なしの静的サーバ。ES モジュールは file:// では読めないので、
 * 手元で遊ぶ・試すときはこれを挟む。GitHub Pages では要らない。
 *
 *   npm run serve                          → http://127.0.0.1:8123/
 *   npm run serve -- 9000                  → ポート指定
 *   npm run serve -- 8123 /daily-akari/    → サブパスの下に置いた状態を再現
 *
 * サブパス配信は rooiboshun.github.io/daily-akari/ のように
 * 「サイトの root ではない場所」へ公開したときを手元で試すためのもの。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** `/daily-akari/` `daily-akari` などを `/daily-akari` に揃える（root なら空文字）。 */
export function normalizeBase(base) {
  const trimmed = String(base || '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** リポジトリの外に出る要求は弾く。base の外に出る要求も弾く。 */
function resolveSafe(urlPath, base) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let rest = decoded;
  if (base) {
    if (rest === base) rest = '/';
    else if (rest.startsWith(base + '/')) rest = rest.slice(base.length);
    else return null; // base の外は配らない（本番と同じ 404 相当）
  }
  const rel = rest === '/' ? 'index.html' : rest.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

export function createServer(opt = {}) {
  const base = normalizeBase(opt.base);
  return http.createServer((req, res) => {
    const full = resolveSafe(req.url || '/', base);
    if (!full) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    fs.readFile(full, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    });
  });
}

/** 直接起動されたときだけ待ち受ける（uitest.mjs からは import して使う）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8123;
  const base = normalizeBase(process.argv[3]);
  createServer({ base }).listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}${base}/  (Ctrl+C で終了)`);
  });
}
