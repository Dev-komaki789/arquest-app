/**
 * ============================================================
 * 写真に撮影情報（EXIF）が残っていないか調べる
 * ============================================================
 *
 * ■ 何のための道具か
 *   日記の写真は、保存する前にEXIFを消している（src/lib/diary.ts）。
 *   **本当に消えているかを、実際のファイルで確かめる**ための道具。
 *   消し方を変えたときや、別の端末で試したときに、毎回これで確認できる。
 *
 * ■ 使い方
 *   ローカルのファイルを調べる:
 *     node scripts/check-exif.mjs ./photo.jpg
 *
 *   Supabaseに保存された写真を調べる（.env.local の秘密キーを使う）:
 *     node scripts/check-exif.mjs --storage "<利用者ID>/1755300000000.jpg"
 *
 *   保存されている写真を一覧する:
 *     node scripts/check-exif.mjs --list
 *
 * ■ 何を見ているか
 *   撮影日時・カメラの機種・向き・**GPS（撮影場所）**。
 *   このうち危ないのはGPSだが、他も「いつ・どの端末で撮ったか」を語るので、
 *   まとめて消えているのが望ましい。
 *
 * ■ GPSの探し方（一度ここで間違えた）
 *   最初は「EXIFの中に GPS という文字が出てくるか」で調べようとしたが、
 *   **見つからなかった。**EXIFは項目を文字ではなく番号で持っているためで、
 *   GPSの入口は 0x8825 という番号の項目になっている。
 *   文字で探す方法だと「GPSが入っているのに、無い」と判定してしまう。
 *   見落としは「消えている」という誤った安心につながるので、
 *   下では中身を実際にたどって確かめている。
 */

import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "diary";

/**
 * EXIFの中に GPS の区画があるかを、実際にたどって確かめる。
 *
 * EXIFの構造:
 *   "Exif\0\0" → TIFFヘッダ（II=下位から / MM=上位から） → 項目の一覧（IFD0）
 *   一覧は「項目数（2バイト）」＋「1項目12バイト」の並び。
 *   各項目の先頭2バイトが番号で、**0x8825 が GPS の入口**。
 */
function hasGpsSection(exif) {
  if (!exif || exif.length < 16) return false;

  // "Exif\0\0" が付いていることがあるので、その分だけ読み始めをずらす
  const start = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
  const tiff = exif.subarray(start);
  if (tiff.length < 8) return false;

  // バイトの並び順。"II" なら下位から、"MM" なら上位から
  const order = tiff.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return false;
  const little = order === "II";

  const readU16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const readU32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));

  // 最初の項目一覧がどこから始まるか
  const ifd0 = readU32(4);
  if (ifd0 + 2 > tiff.length) return false;

  const count = readU16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    // 0x8825 = GPSInfoIFDPointer（GPSの区画への入口）
    if (readU16(entry) === 0x8825) return true;
  }
  return false;
}

/** 画像1枚を調べて、結果を表示する */
async function inspect(label, buffer) {
  const metadata = await sharp(buffer).metadata();

  // sharp は EXIF を生のかたまりで返す。
  // 中身の判定まではせず、「入っているかどうか」と大きさを見る。
  const hasExif = Boolean(metadata.exif && metadata.exif.length > 0);
  const hasXmp = Boolean(metadata.xmp && metadata.xmp.length > 0);
  const hasIcc = Boolean(metadata.icc && metadata.icc.length > 0);

  const looksLikeGps = hasGpsSection(metadata.exif);

  console.log(`\n■ ${label}`);
  console.log(`   形式: ${metadata.format} / ${metadata.width}x${metadata.height}`);
  console.log(`   EXIF: ${hasExif ? `あり（${metadata.exif.length}バイト）` : "なし"}`);
  console.log(`   XMP : ${hasXmp ? "あり" : "なし"}`);
  console.log(`   ICC : ${hasIcc ? "あり" : "なし"}（色の情報。位置とは無関係）`);

  if (looksLikeGps) {
    console.log("   ❌ GPS（撮影場所）が残っています");
    return false;
  }
  if (hasExif) {
    console.log("   ⚠ GPSは見当たりませんが、EXIF自体は残っています");
    return false;
  }
  console.log("   ✅ 撮影情報は残っていません");
  return true;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL と SUPABASE_SECRET_KEY が要ります（.env.local を読み込んでから実行してください）",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const [flag, value] = process.argv.slice(2);

if (flag === "--list") {
  const supabase = getSupabase();
  const { data: folders, error } = await supabase.storage.from(BUCKET).list();
  if (error) throw new Error(error.message);

  console.log("保存されている写真:");
  for (const folder of folders ?? []) {
    const { data: files } = await supabase.storage.from(BUCKET).list(folder.name);
    for (const file of files ?? []) {
      console.log(`  ${folder.name}/${file.name}`);
    }
  }
} else if (flag === "--storage") {
  if (!value) throw new Error("調べるファイルの場所を指定してください");
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(value);
  if (error) throw new Error(`取り出せませんでした: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const clean = await inspect(value, buffer);
  process.exitCode = clean ? 0 : 1;
} else if (flag) {
  const clean = await inspect(flag, await readFile(flag));
  process.exitCode = clean ? 0 : 1;
} else {
  console.log("使い方: node scripts/check-exif.mjs <ファイル> | --storage <場所> | --list");
}
