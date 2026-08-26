/**
 * ============================================================
 * 下部のタブ
 * ============================================================
 *
 * ■ 並びはモックアップ（screen-shot/）と同じ6つ
 *   ただし、まだ無い画面（相棒・マップ・設定）は**薄くして押せなくする**。
 *   押しても何も起きないタブがあると壊れていると思われるし、
 *   逆に消してしまうと、全体像が見えず「これで完成なのか」が分からない。
 *   薄く置いておけば「これから増える」ことが伝わる。
 *
 * ■ 画面の一番下に貼り付ける
 *   歩きながら片手で持つので、親指の届く位置に置く。
 *   端末の下端（ホームバーの領域）にかからないよう、余白を足してある。
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "ホーム", icon: "🏠", ready: true },
  { href: "/diary", label: "日記", icon: "📓", ready: true },
  { href: "/companion", label: "相棒", icon: "🐾", ready: false },
  { href: "/map", label: "マップ", icon: "🗺️", ready: false },
  { href: "/settings", label: "設定", icon: "⚙️", ready: false },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      /* ここだけ地が白い（モックアップ①）。
         紺地用の --ink をそのまま使うと白地に白文字になるので、
         この中の文字色は暗いほう（--ink-card）に切り替える */
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--ink-card)]/10 bg-white/95 backdrop-blur"
      // 端末の下端にあるバーの高さぶん、余白を足す
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-md">
        {TABS.map((tab) => {
          const active = pathname === tab.href;

          if (!tab.ready) {
            return (
              <li key={tab.href} className="flex-1">
                <span
                  aria-disabled="true"
                  className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-[var(--ink-card)]/25"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-6 items-center justify-center text-lg leading-none"
                  >
                    {tab.icon}
                  </span>
                  {tab.label}
                </span>
              </li>
            );
          }

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={[
                  "flex flex-col items-center gap-0.5 py-2 text-[11px] transition",
                  // 11pxなので、薄くしすぎると白地で読めなくなる（68%で5.55）
                  active ? "text-[var(--gold-ink)]" : "text-[var(--ink-card)]/68",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 items-center justify-center text-lg leading-none"
                >
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
