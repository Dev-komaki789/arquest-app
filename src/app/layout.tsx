import type { Metadata, Viewport } from "next";
import { DotGothic16 } from "next/font/google";
import "./globals.css";

/**
 * 数字と題名に使うドット書体。
 *
 * ■ 使いどころを一文で決めておく
 *   **「数える数字」と「画面の題名」だけ**に使う。
 *   本文にまで使うと、屋外で読みにくくなるうえ、
 *   どこが強調なのか分からなくなる（前のモックアップの反省点）。
 *
 * next/font はビルドのときに書体を取り込んで自分のサーバーから配る。
 * 外部への読みに行かないので、表示が遅れてガタつくことがない。
 */
const pixel = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: "アルクエスト",
  description: "散歩を遊びに。カードを2枚めくって、今日の冒険を決めるアプリ。",
  icons: {
    icon: "/icons/favicon-32.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    // iPhoneでホーム画面から開いたとき、アドレス欄なしの全画面にする
    capable: true,
    title: "アルクエスト",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Androidの上部（時計や電池が並ぶ帯）の色。画面の地と同じ紺に揃える
  themeColor: "#0F1633",
  // 端末の幅に合わせる。歩きながら片手で使うので、勝手に拡大縮小させない
  width: "device-width",
  initialScale: 1,
  // ただし拡大そのものは禁止しない。
  // 文字を大きくして読みたい人を締め出さないため（禁止するとOSの設定より強く効いてしまう）
  maximumScale: 5,
  // 画面のふちギリギリまで使う（ノッチのある端末で余白が出ないように）
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${pixel.variable} h-full antialiased`}>
      {/* 地の色と文字色は globals.css の body 側で決めている */}
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
