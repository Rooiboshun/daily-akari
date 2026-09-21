/*
 * アプリアイコンを作る。依存パッケージなしで PNG を直接書き出す。
 *
 *   npm run icons
 *
 * ホーム画面に置いたときの絵が要るのは PWA のためだけなので、道具はここに置き、
 * 出来上がった PNG は icons/ にコミットする（公開時に生成は走らない）。
 *
 * 絵柄は 5x5 の美術館盤面そのもの。中央に照明を1つ置き、そこから見える
 * マスを「照らされた色」で塗っている（盤面ロジックは持ち込まず、絵として
 * 同じ規則を手で書いている。アイコンのためにソルバを読む必要はない）。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');

// style.css と同じ色。見た目を揃えるため、変えるときは両方直す。
const BG = [0x16, 0x17, 0x1b];
const WHITE_CELL = [0xf2, 0xef, 0xe6];
const LIT = [0xff, 0xe9, 0xa8];
const BLACK_CELL = [0x2a, 0x2c, 0x33];
const LAMP = [0xff, 0xd8, 0x70];
const LINE = [0x2c, 0x2f, 0x37];

// 5x5 の盤面。# が黒マス、L が照明の位置。
const BOARD = ['...#.', '.#...', '..L..', '...#.', '.#...'];
const N = 5;

const at = (x, y) => BOARD[y][x];
const isBlack = (x, y) => at(x, y) === '#';

/** 照明から見えるマス（黒マスか端に当たるまで上下左右）。 */
function litCells() {
  let lx = 0;
  let ly = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(x, y) === 'L') [lx, ly] = [x, y];
  const lit = new Set([`${lx},${ly}`]);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    let x = lx + dx;
    let y = ly + dy;
    while (x >= 0 && x < N && y >= 0 && y < N && !isBlack(x, y)) {
      lit.add(`${x},${y}`);
      x += dx;
      y += dy;
    }
  }
  return { lit, lx, ly };
}

// ---------------------------------------------------------------- PNG を書く

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGB のバイト列（size*size*3）を PNG にする。 */
function encodePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // フィルタ種別 0（なし）
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // 色種別 truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 絵を描く

function makeCanvas(size, bg) {
  const buf = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    buf[i * 3] = bg[0];
    buf[i * 3 + 1] = bg[1];
    buf[i * 3 + 2] = bg[2];
  }
  return buf;
}

function put(buf, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 3;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
}

function rect(buf, size, x0, y0, w, h, color) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(buf, size, x, y, color);
}

function disc(buf, size, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) put(buf, size, x, y, color);
    }
  }
}

/**
 * アイコン1枚を作る。
 * `inset` は盤面が画像に占める割合（maskable は端が切られるので小さくする）。
 */
function drawIcon(size, inset) {
  const buf = makeCanvas(size, BG);
  const { lit, lx, ly } = litCells();
  const board = size * inset;
  const origin = (size - board) / 2;
  const cell = board / N;
  const gap = Math.max(1, Math.round(size / 128)); // マスの間の線

  rect(buf, size, origin - gap, origin - gap, board + gap * 2, board + gap * 2, LINE);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = origin + x * cell;
      const py = origin + y * cell;
      const color = isBlack(x, y) ? BLACK_CELL : lit.has(`${x},${y}`) ? LIT : WHITE_CELL;
      rect(buf, size, px, py, cell - gap, cell - gap, color);
    }
  }

  disc(buf, size, origin + (lx + 0.5) * cell - gap / 2, origin + (ly + 0.5) * cell - gap / 2, cell * 0.3, LAMP);
  return encodePng(size, buf);
}

const FILES = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, 0.58], // 端 20% が切られても盤面が欠けない大きさ
  ['apple-touch-icon.png', 180, 0.78],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, inset] of FILES) {
  const png = drawIcon(size, inset);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${png.length} bytes`);
}
console.log(`\n${FILES.length} 枚を ${path.relative(ROOT, OUT)}/ に書き出しました。`);
