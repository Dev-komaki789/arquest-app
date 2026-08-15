/**
 * ============================================================
 * アプリのアイコンを作る
 * ============================================================
 *
 * 相棒の絵（src/assets/slime/normal.png）を、スカイブルーの四角に載せて
 * ホーム画面用のアイコンを書き出す。
 *
 *   npm run icons
 *
 * ■ なぜスクリプトにしてあるのか
 *   スライムを描き直したら、アイコンも作り直す必要がある。
 *   毎回手で切り貼りすると、大きさや余白がそのたびに変わってしまう。
 *
 * ■ maskable とは
 *   Androidはアイコンを丸や四角に切り抜いて表示する。
 *   どう切られるか分からないので、**外周20%は切られる前提**で余白を多めに取る。
 *   これを用意しないと、端末によっては絵の端が切れる。
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src/assets/slime/normal.png");
const outDir = path.join(root, "public/icons");

/** 背景の色。ホームの帯と同じ緑（画面と揃える） */
const BACKGROUND = "#DCE9CD";

/**
 * 1枚作る。
 *
 * @param size   書き出す大きさ（正方形）
 * @param ratio  絵が占める割合。maskable は小さくして余白を確保する
 * @param name   ファイル名
 */
async function build(size, ratio, name) {
  const slime = await sharp(source)
    .resize({
      width: Math.round(size * ratio),
      height: Math.round(size * ratio),
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: slime, gravity: "center" }])
    .png()
    .toFile(path.join(outDir, name));

  console.log(`  ${name} (${size}x${size})`);
}

await mkdir(outDir, { recursive: true });

console.log("アイコンを作ります:");
// ふつうのアイコン。絵は少し大きめに載せる
await build(192, 0.72, "icon-192.png");
await build(512, 0.72, "icon-512.png");
// 切り抜かれる前提のアイコン。外周が削られても絵が残るように小さく載せる
await build(512, 0.52, "icon-maskable-512.png");
// iPhoneのホーム画面用（角丸はOS側が付けるので、こちらは四角のまま）
await build(180, 0.72, "apple-touch-icon.png");
// ブラウザのタブ用
await build(32, 0.82, "favicon-32.png");
console.log("できました。");
