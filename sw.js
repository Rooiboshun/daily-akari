/*
 * Service Worker — オフラインで遊ぶための入れ物。
 *
 * このアプリは問題を端末の中で作るので（日付が乱数の種）、ファイルさえ
 * 手元にあれば通信は一切要らない。足りなかったのは「ファイルを手元に
 * 置いておく」ことだけで、それをここが受け持つ。
 *
 * 方針は3つ。
 *
 * 1. インストール時に必要なファイルを全部取る（ASSETS）。一部でも取れなければ
 *    インストール自体を失敗させる。中途半端に入って「開いたら真っ白」になるより、
 *    古い版がそのまま生き残るほうが良いため
 * 2. 配るときはキャッシュ優先。オフラインでも即出るし、オンラインでも速い
 * 3. 配ったあと裏でネットから取り直して次回に備える（stale-while-revalidate）
 *
 * 更新は skipWaiting しない。新しい版は「次に開いたとき」に入れ替わる。
 * 遊んでいる最中に JS だけ新しくなる事故を避けるため。
 *
 * VERSION を変えるとキャッシュが作り直される。**公開するファイルを増やしたり
 * 減らしたりしたら、ASSETS と VERSION の両方を直すこと**（tools/verify.mjs の
 * H 章が、ASSETS に並んだファイルが実在するかを検査している）。
 */

const VERSION = 'v3';
const CACHE = `akari-${VERSION}`;

// 相対パスは「この sw.js の置き場所」から解決される。
// サブパス（/daily-akari/）に置いても、そのまま正しい URL になる。
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/akari.js',
  './src/archive.js',
  './src/puzzlink.js',
  './src/ui.js',
  './src/pwa.js',
  './src/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache-control に邪魔されないよう、取り直しを明示する。
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('akari-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

/** 今すぐ入れ替わってよい、と画面から言われたとき（「更新する」ボタン）。 */
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部（puzz.link など）は素通し

  // ページそのものの要求（アドレスバーやホーム画面からの起動）は、
  // 何が来ても手元の index.html を返す。オフラインでも必ず起動する。
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        if (cached) {
          refresh(req); // 裏で取り直す
          return cached;
        }
        return fetch(req);
      })()
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) {
        refresh(req);
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('オフラインです', { status: 504, statusText: 'offline' });
      }
    })()
  );
});

/** 裏でネットから取り直してキャッシュを新しくする。失敗は無視（オフラインなら当然失敗する）。 */
function refresh(req) {
  fetch(req)
    .then(async (res) => {
      if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
    })
    .catch(() => {});
}
