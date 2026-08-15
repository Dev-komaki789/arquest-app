import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "アルクエスト",
  description: "散歩を遊びに。カードを2枚引いて、きょうのぼうけんを決めるアプリ。",
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
  // Androidの上部（時計や電池が並ぶ帯）の色。画面の空色に揃える
  themeColor: "#5B8DEF",
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
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
