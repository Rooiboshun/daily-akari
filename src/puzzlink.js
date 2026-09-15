/*
 * puzz.link の URL と盤面を相互変換する。
 *
 * 美術館は puzz.link では pid "lightup"。URL の形は
 *
 *   https://puzz.link/p?lightup/<横>/<縦>/<本文>
 *
 * で、本文は pzprjs の「4セル符号化」(encode4Cell / decode4Cell)。
 * ここはその規則をそのまま移したもので、外部通信もライブラリも要らない。
 *
 * 参照した実装（読み取りのみ・コードは持ち込んでいない）:
 *   pzprjs src/variety-common/Encode.js の decode4Cell / encode4Cell
 *   pzprjs src/pzpr/parser.js の parseURLData（項目の順番）
 *
 * 符号の規則（本文1文字ぶん）:
 *   '0'-'4'  数字つき黒マス。後ろに白マスは続かない
 *   '5'-'9'  数字つき黒マス(値-5)＋白マス1つ
 *   'a'-'e'  数字つき黒マス(値-10)＋白マス2つ
 *   '.'      数字なしの黒マス
 *   'g'-'z'  白マスが 1〜20 個続く（36進で読んで -15）
 */

import { WHITE, BLACK } from './akari.js';

/** puzz.link での美術館の識別子。 */
export const PID = 'lightup';

/** 既定の書き出し先。pzpr.jp でも同じ本文がそのまま通る。 */
export const DEFAULT_BASE = 'https://puzz.link/p?';

/** 読み込みを受け付ける上限。これ以上は解く前に断る。 */
export const MAX_SIDE = 64;
export const MAX_AREA = 1600;

/** 盤面の1マスを pzprjs の qnum（白 -1 / 数字なし黒 -2 / 0..4）に直す。 */
function qnumOf(cells, i, n) {
  if (i < 0 || i >= n) return null; // 盤の外
  const c = cells[i];
  if (c === WHITE) return -1;
  if (c === BLACK) return -2;
  return c;
}

/**
 * 盤面 → puzz.link の本文。
 * @param {{w:number,h:number,cells:Int8Array}} puzzle
 * @returns {string}
 */
export function encodeBody(puzzle) {
  const { w, h, cells } = puzzle;
  const n = w * h;
  let out = '';
  let count = 0; // 溜めている白マスの数

  for (let c = 0; c < n; c++) {
    let pstr = '';
    const qn = qnumOf(cells, c, n);

    if (qn >= 0) {
      // 数字つき黒マス。後ろに続く白マスを最大2つまで同じ文字に畳み込む
      if (qnumOf(cells, c + 1, n) !== null && qnumOf(cells, c + 1, n) !== -1) {
        pstr = qn.toString(16);
      } else if (qnumOf(cells, c + 2, n) !== null && qnumOf(cells, c + 2, n) !== -1) {
        pstr = (5 + qn).toString(16);
        c++;
      } else {
        pstr = (10 + qn).toString(16);
        c += 2;
      }
    } else if (qn === -2) {
      pstr = '.';
    } else {
      count++;
    }

    if (count === 0) {
      out += pstr;
    } else if (pstr || count === 20) {
      // 'g'(1個) 〜 'z'(20個)。20 を超える前に必ず吐き出す
      out += (count + 15).toString(36) + pstr;
      count = 0;
    }
  }
  if (count > 0) out += (count + 15).toString(36);
  return out;
}

/**
 * puzz.link の本文 → 盤面。
 * @param {string} body
 * @param {number} w
 * @param {number} h
 */
export function decodeBody(body, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error('盤面の大きさが読めません');
  }
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) {
    throw new Error(`盤面が大きすぎます（${w}×${h}）`);
  }
  const n = w * h;
  const cells = new Int8Array(n).fill(WHITE);
  let c = 0;

  for (let i = 0; i < body.length && c < n; i++) {
    const ca = body.charAt(i);
    if (ca >= '0' && ca <= '4') {
      cells[c] = parseInt(ca, 16);
    } else if (ca >= '5' && ca <= '9') {
      cells[c] = parseInt(ca, 16) - 5;
      c += 1; // 数字の後ろに白マス1つ
    } else if (ca >= 'a' && ca <= 'e') {
      cells[c] = parseInt(ca, 16) - 10;
      c += 2; // 数字の後ろに白マス2つ
    } else if (ca >= 'g' && ca <= 'z') {
      c += parseInt(ca, 36) - 16; // 白マスが続く
    } else if (ca === '.') {
      cells[c] = BLACK;
    } else {
      throw new Error(`本文に読めない文字があります: ${ca}`);
    }
    c++;
  }
  return { w, h, cells };
}

/** 盤面 → puzz.link の URL。 */
export function toUrl(puzzle, base = DEFAULT_BASE) {
  return `${base}${PID}/${puzzle.w}/${puzzle.h}/${encodeBody(puzzle)}`;
}

/**
 * puzz.link の URL（や、その断片）→ 盤面。
 *
 * 受け付ける形:
 *   https://puzz.link/p?lightup/10/10/xxxx
 *   https://pzpr.jp/p.html?lightup/10/10/xxxx
 *   lightup/10/10/xxxx          （本体だけ）
 *   #p/lightup/10/10/xxxx       （このアプリの URL）
 *
 * @returns {{pid:string,w:number,h:number,body:string,puzzle:object,url:string}}
 */
export function fromUrl(text) {
  let s = String(text == null ? '' : text).trim();
  if (!s) throw new Error('URL が空です');

  // クエリ以降だけを見る（?p= のような包み方はしていないので ? の後ろ全部）
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(q + 1);
  s = s.replace(/^#/, '').replace(/^p\//i, '');
  if (/%[0-9a-fA-F]{2}/.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // 壊れた % 列。そのまま読み進めて、後段の検査で弾かせる
    }
  }

  const parts = s.split('/').filter((t) => t !== '');
  const pid = parts.shift();
  if (!pid) throw new Error('URL の形が違います');
  if (pid !== PID) {
    throw new Error(`美術館(${PID})の URL ではありません: ${pid}`);
  }
  // pzprjs の並び: pid [/v:変種] [/フラグ] /横 /縦 /本文
  if (parts[0] && /^v:/.test(parts[0])) parts.shift();
  if (parts[0] && !/^\d+$/.test(parts[0])) parts.shift();

  const w = Number(parts.shift());
  const h = Number(parts.shift());
  const body = parts.join('/');
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new Error('URL に盤面の大きさがありません');
  }
  if (!body) throw new Error('URL に盤面の中身がありません');

  const puzzle = decodeBody(body, w, h);
  // 本文は書き方に揺れがありうるので、読み直した盤面から作り直して正規化する
  return { pid, w, h, body: encodeBody(puzzle), puzzle, url: toUrl(puzzle) };
}
