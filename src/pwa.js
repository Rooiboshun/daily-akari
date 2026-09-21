/*
 * オフライン対応の登録と、その状態表示。
 *
 * 画面の隅に「オフラインで遊べます」と出るのは飾りではなく、
 * **回線が無くなる前に、保存が終わったことを確かめるため**のもの。
 * 保存が終わる前に閉じると、次に開いたとき何も出ない。
 *
 * 遊ぶ側のコード（ui.js）とは完全に切り離してある。ここが丸ごと失敗しても
 * パズルは今までどおり遊べる。
 */

const el = document.getElementById('offline');

function show(text, kind = '') {
  if (!el) return;
  el.textContent = text;
  el.className = `offline ${kind}`.trim();
  el.hidden = false;
}

function hide() {
  if (el) el.hidden = true;
}

// http:// や file:// では Service Worker が使えない（localhost は例外）。
// 手元でファイルを直接開いたときに嘘の表示を出さないよう、黙って引き下がる。
if (!('serviceWorker' in navigator) || !self.isSecureContext) {
  hide();
} else {
  register();
}

async function register() {
  show('オフライン用に保存しています…', 'busy');
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    if (reg.waiting) offerUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state !== 'installed') return;
        // 既に別の版が動いているなら「更新あり」。初回なら保存完了。
        if (navigator.serviceWorker.controller) offerUpdate(reg);
        else ready();
      });
    });

    if (navigator.serviceWorker.controller) ready();
    await navigator.serviceWorker.ready;
    if (!reg.waiting) ready();
  } catch (err) {
    show('オフライン保存に失敗しました', 'ng');
  }
}

function ready() {
  if (navigator.onLine) show('オフラインで遊べます', 'ok');
  else show('オフラインで動いています', 'ok');
}

function offerUpdate(reg) {
  show('', '');
  if (!el) return;
  el.textContent = '新しい版があります ';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'offline-update';
  btn.textContent = '更新する';
  btn.addEventListener('click', () => {
    reg.waiting?.postMessage('skip-waiting');
    // 入れ替わったら読み直す。二重読み込みを防ぐため1回だけ。
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  });
  el.appendChild(btn);
  el.className = 'offline warn';
  el.hidden = false;
}

window.addEventListener('online', () => {
  if (el && !el.querySelector('button')) ready();
});
window.addEventListener('offline', () => {
  if (el && !el.querySelector('button')) ready();
});
