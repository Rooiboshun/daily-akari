# 公開のしかた（GitHub Pages）

このリポジトリは「静的ファイルを置くだけ」で動く。ビルドも依存パッケージも
CI も無いので、公開に必要なのは **どこへ置くかを決めること** だけ。
判断材料と手順をここにまとめる。

最終更新: 2026-09-16（**公開済み**。案 A を採った）

## 今どうなっているか

**https://rooiboshun.github.io/daily-akari/ で公開中。**

2026-09-16 に案 A で公開した。やったことは3つだけ。

1. 作業ブランチの先端 `feat/akari-puzzlink-io` を master へ `--no-ff` で合流
   （master はそれまで空の初期コミットだった）
2. `gh repo create Rooiboshun/daily-akari --public --source=. --push`
3. `gh api -X POST repos/Rooiboshun/daily-akari/pages -f "source[branch]=master" -f "source[path]=/"`

以後の更新は **master へ push するだけ**で反映される。ビルドも CI も無い。

公開直後に実測した配信（すべて 200、MIME も正しい）:

| パス | 種別 |
|---|---|
| `/` | `text/html` |
| `/src/ui.js` | `application/javascript` |
| `/src/akari.js` | `application/javascript` |
| `/src/puzzlink.js` | `application/javascript` |
| `/src/style.css` | `text/css` |

`.js` が `application/javascript` で返ることは確認しておく価値がある。ES
モジュールは MIME が違うとブラウザが読み込みを拒む。

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

## 置き場所は2択（採ったのは A）

### A. このリポジトリをそのまま Pages にする ← これにした

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
  `src/ui.js`、`ui.js` の import は `./akari.js` と `./puzzlink.js` で、
  すべて相対パス。絶対パス（`/src/...`）は1つも無い。`npm run uitest` は
  root 配信と `/daily-akari` 配信の両方で同じ32項目を回していて、
  2026-09-14 時点で 64/64 通過（`npm run serve -- 8123 /daily-akari/` で
  目でも確かめられる）
- **localStorage が他の作品とぶつからない** — `rooiboshun.github.io` は
  作品どうしで localStorage を共有する（オリジンが同じ）。保存キーは
  `akari:v1:<日付>:<難易度>`（読み込んだ問題は `akari:v1:link:<大きさ>:<本文>`）と
  接頭辞付きなので衝突しない
- **外部への通信が無い** — 読み込むのは同じ場所の4ファイルだけ。
  フォント・CDN・解析の類は一切読んでいないので、https でも混在コンテンツにならず、
  オフラインでも一度開けば動く（Service Worker は入れていないので初回は要通信）。
  puzz.link との行き来も**通信ではなく URL 文字列の変換**で、向こうへ実際に
  出て行くのは利用者が `今の問題を puzz.link で開く` を押したときだけ
  （`target="_blank"` + `rel="noreferrer noopener"`）
- **Jekyll に邪魔されない** — `_` で始まるファイル・ディレクトリが無いので
  `.nojekyll` は要らない
- **問題はその場で作る** — サーバも DB もアーカイブも要らない。生成は
  最悪でも 45ms 程度（`npm run soak` の実測）なので、開いた瞬間に出る

## まだ決めていないこと

- puzz.link へ実際に貼って盤面が一致するかの目視確認。**未実施**
  （`npm run peek` が最後の行に URL を出すので、開いて見比べるだけ）
- 独自ドメイン。`dailyakari.com` は元ネタの本家なので使えない
- 作品一覧への導線（B なら一覧ページに1行足す）
- OGP 画像。SNS に貼っても今は絵が出ない（機能には影響しない）
