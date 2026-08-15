/**
 * ============================================================
 * ホーム画面に追加する案内と、Service Workerの登録
 * ============================================================
 *
 * ■ なぜホーム画面に入れてほしいのか（仕様書§2.1）
 *   ・ブラウザのアドレス欄が消えて、アプリらしく全画面で開く
 *   ・段階6で入れる通知は、**ホーム画面に追加していないと届かない**端末がある
 *   ・歩きながら開くので、アイコンを1回押すだけで始められるほうがよい
 *
 * ■ Androidの場合
 *   条件を満たすと、ブラウザが「入れませんか」という合図（beforeinstallprompt）を送ってくる。
 *   その合図を受け取っておき、**利用者がボタンを押したときに**改めて確認画面を出す。
 *   勝手に出すと邪魔なので、受け取ってから待つ形にしている。
 *
 * ■ iPhoneの場合
 *   Safariはこの合図を送ってこない。共有ボタンから手で追加してもらうしかないので、
 *   その手順を文章で案内する。
 *
 * ■ useSyncExternalStore を使っている理由
 *   「いまホーム画面から開いているか」「iPhoneか」は、Reactの外側にある情報。
 *   useEffect の中で state を更新して持ち込むと、描画が二度手間になるうえ、
 *   このプロジェクトのESLintに止められる。
 *   外部の情報を読むための専用の仕組みがあるので、そちらを使う。
 */

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** ブラウザが送ってくる「入れませんか」の合図。まだ型が標準にないので自分で書く */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** ホーム画面から開いているか（アドレス欄が無い状態か）を見張る */
function subscribeDisplayMode(onChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** 変わることのない情報を読むとき用。見張る必要が無いので何もしない */
function subscribeNothing() {
  return () => {};
}

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [justInstalled, setJustInstalled] = useState(false);

  // サーバー側では画面のことが分からないので、どちらも false として描く。
  // ブラウザで読み直されたときに正しい値になる。
  const standalone = useSyncExternalStore(
    subscribeDisplayMode,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );

  const isIos = useSyncExternalStore(
    subscribeNothing,
    () => /iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false,
  );

  useEffect(() => {
    // Service Workerを登録する（オフライン時の受け皿・将来の通知の土台）
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((cause) => {
        // 登録できなくてもアプリは動く。開発時に気づけるよう記録だけ残す
        console.error("Service Workerを登録できませんでした:", cause);
      });
    }

    // 「入れませんか」の合図を受け取って、とっておく
    const onPrompt = (event: Event) => {
      // 既定の動きを止めないと、ブラウザが自前の小さなバーを出すことがある
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(() => {
    if (!promptEvent) return;
    void promptEvent.prompt().then(() => {
      // 合図は1回しか使えない。断られた場合も、次にブラウザが判断して送り直してくる
      setPromptEvent(null);
    });
  }, [promptEvent]);

  // すでに入っているなら、何も出さない
  if (standalone || justInstalled) return null;

  if (promptEvent) {
    return (
      <button
        type="button"
        onClick={install}
        className="w-full rounded-2xl border-2 border-white/70 bg-white/20 px-4 py-3 text-sm font-bold text-white backdrop-blur active:bg-white/30"
      >
        ホーム画面に追加する
      </button>
    );
  }

  if (isIos) {
    return (
      <p className="rounded-2xl bg-white/20 px-4 py-3 text-xs leading-relaxed text-white backdrop-blur">
        ホーム画面に追加すると、アプリのように開けます。
        <br />
        下の共有ボタン → 「ホーム画面に追加」
      </p>
    );
  }

  // Androidでも、条件が揃うまで合図は来ない（数秒かかることがある）。
  // 出せるものが無いときは、何も出さない。
  return null;
}
