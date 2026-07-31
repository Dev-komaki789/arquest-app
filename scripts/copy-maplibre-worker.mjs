/**
 * ============================================================
 * MapLibre のワーカーファイルを public/ にコピーするスクリプト
 * ============================================================
 *
 * ■ なぜこれが必要？
 *   MapLibre は地図タイルの読み込みと解析を「ワーカー」という
 *   裏方のプログラムに任せている（重い処理で画面が固まらないようにするため）。
 *
 *   このワーカーは本来 node_modules の中にあるが、
 *   node_modules はブラウザに配信されない。
 *   MapLibre は自分の位置を頼りにワーカーを探しに行くものの、
 *   Next.js がコードをまとめ直す（バンドルする）と、その場所にファイルが無く、
 *   ワーカーが起動しない → タイルが永久に読み込まれない、という状態になる。
 *
 *   そこで、ワーカーを public/ フォルダにコピーして
 *   ブラウザから取得できる場所に置き、
 *   コード側から場所を直接教える（setWorkerUrl）方式にした。
 *
 * ■ public フォルダとは
 *   Next.js で「そのままの形で配信されるファイル」を置く場所。
 *   public/maplibre/x.mjs は http://localhost:3000/maplibre/x.mjs で取得できる。
 *
 * ■ いつ実行される？
 *   package.json の "postinstall" に登録してあるので、
 *   npm install のたびに自動で実行される。
 *   MapLibreを更新したときにコピーし忘れる事故を防ぐため。
 */

// Node.js の標準機能。ブラウザではなくパソコン上でファイルを操作する。
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// このスクリプト自身の場所から、プロジェクトの root を求める。
// （どこから実行しても正しく動くようにするため）
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..");

// コピー元（node_modules の中）とコピー先（public の中）
const sourceDir = join(projectRoot, "node_modules", "maplibre-gl", "dist");
const targetDir = join(projectRoot, "public", "maplibre");

/**
 * コピーする2ファイル。
 *   maplibre-gl-worker.mjs … ワーカー本体
 *   maplibre-gl-shared.mjs … ワーカー本体が読み込む共通部分
 * ワーカーは同じフォルダにある共通部分を読むため、2つセットで置く必要がある。
 */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

// コピー先のフォルダを作る（すでにあってもエラーにしない指定が recursive）
await mkdir(targetDir, { recursive: true });

for (const file of FILES) {
  await copyFile(join(sourceDir, file), join(targetDir, file));
  console.log(`コピーしました: public/maplibre/${file}`);
}
