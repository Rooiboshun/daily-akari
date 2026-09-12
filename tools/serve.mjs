/*
 * 依存なしの静的サーバ。ES モジュールは file:// では読めないので、
 * 手元で遊ぶ・試すときはこれを挟む。GitHub Pages では要らない。
 *
 *   npm run serve            → http://127.0.0.1:8123/
 *   npm run serve -- 9000    → ポート指定
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
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** リポジトリの外に出る要求は弾く。 */
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

export function createServer() {
  return http.createServer((req, res) => {
    const full = resolveSafe(req.url || '/');
    if (!full) {
      res.writeHead(403).end('forbidden');
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
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}/  (Ctrl+C で終了)`);
  });
}
