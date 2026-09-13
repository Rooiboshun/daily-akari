# 公開のしかた（GitHub Pages）

このリポジトリは「静的ファイルを置くだけ」で動く。ビルドも依存パッケージも
CI も無いので、公開に必要なのは **どこへ置くかを決めること** だけ。
判断材料と手順をここにまとめる。

最終更新: 2026-09-14（まだ公開していない。push もマージもしていない）

---

## 公開に必要なファイル

公開に要るのは次の5つだけ。

```
index.html
src/akari.js
src/ui.js
src/style.css
```

`tools/` `docs/` `package.json` `README.md` は無くても動く（置いたままでも
害は無い。GitHub Pages は単に配るだけで、`package.json` を見てビルドしたりしない）。

## 置き場所は2択

### A. このリポジトリをそのまま Pages にする

`rooiboshun/daily-akari` を GitHub に作って push し、Settings → Pages で
Source を `master` / `/ (root)` にする。URL は
`https://rooiboshun.github.io/daily-akari/` になる。

- 更新がこのリポジトリへの push だけで済む。履歴も検証も道具も一緒に付いてくる
- リポジトリが1つ増える

### B. 既存の `rooiboshun.github.io` の中に置く

`rooiboshun.github.io` リポジトリに `daily-akari/` を作り、上の4ファイルを
コピーして push する。URL は同じく
`https://rooiboshun.github.io/daily-akari/` で、既存作と同じ並びに入る。

- 既存の作品一覧からそのまま辿れる
- 直すたびに2つのリポジトリへ同じ内容を入れることになる（コピー忘れが起きる）

どちらでも URL は変わらないので、**A で始めて、後から一覧にリンクを足す**のが
戻しやすい。B にするなら `git subtree` などで二重管理を避けたい。

## 確かめてあること

- **サブパスでも壊れない** — `index.html` の参照は `src/style.css` と
  `src/ui.js`、`ui.js` の import は `./akari.js` で、すべて相対パス。
  絶対パス（`/src/...`）は1つも無い。`npm run uitest` は root 配信と
  `/daily-akari` 配信の両方で同じ22項目を回していて、2026-09-14 時点で
  44/44 通過（`npm run serve -- 8123 /daily-akari/` で目でも確かめられる）
- **localStorage が他の作品とぶつからない** — `rooiboshun.github.io` は
  作品どうしで localStorage を共有する（オリジンが同じ）。保存キーは
  `akari:v1:<日付>:<難易度>` と接頭辞付きなので衝突しない
- **外部への通信が無い** — 読み込むのは同じ場所の3ファイルだけ。
  フォント・CDN・解析の類は一切読んでいないので、https でも混在コンテンツにならず、
  オフラインでも一度開けば動く（Service Worker は入れていないので初回は要通信）
- **Jekyll に邪魔されない** — `_` で始まるファイル・ディレクトリが無いので
  `.nojekyll` は要らない
- **問題はその場で作る** — サーバも DB もアーカイブも要らない。生成は
  最悪でも 45ms 程度（`npm run soak` の実測）なので、開いた瞬間に出る

## まだ決めていないこと

- 公開そのもの（push・Pages の有効化）。**未実施**
- 独自ドメイン。`dailyakari.com` は元ネタの本家なので使えない
- 作品一覧への導線（B なら一覧ページに1行足す）
- OGP 画像。SNS に貼っても今は絵が出ない（機能には影響しない）
