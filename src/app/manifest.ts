/**
 * ============================================================
 * PWAの設定（ホーム画面に追加したときの見え方）
 * ============================================================
 *
 * ■ このファイルは何？
 *   Next.js（App Router）では `app/manifest.ts` を置くと、
 *   `/manifest.webmanifest` として配信され、
 *   ブラウザが「このサイトはアプリとして入れられる」と判断する材料になる。
 *
 * ■ アイコンは npm run icons で作る
 *   相棒の絵から書き出している（scripts/make-icons.mjs）。
 *   スライムを描き直したら、作り直すこと。
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "アルクエスト",
    // ホーム画面のアイコンの下に出る名前。長いと省略されるので短く
    short_name: "アルクエスト",
    description: "散歩を遊びに。カードを2枚めくって、今日の冒険を決める。",
    // 開いたときに表示する場所
    start_url: "/",
    // standalone … ブラウザのアドレス欄を出さず、アプリのように全画面で開く
    display: "standalone",
    // 起動直後、画面が描かれるまでの間に見える色。画面の地の色に合わせる
    background_color: "#EEF5E4",
    // Androidの上部（時計や電池が並ぶ帯）の色。ホームの帯と同じ緑
    theme_color: "#DCE9CD",
    // 縦向き固定。歩きながら片手で使うので横向きにする理由がない
    orientation: "portrait",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        // Androidが好きな形に切り抜くためのアイコン（余白を多めに取ってある）
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
