/**
 * ============================================================
 * カードをめくる
 * ============================================================
 *
 * ■ 何をするものか
 *   裏向きのカード（？マーク）をタップすると、表に返って文面が見える。
 *
 * ■ タップで結果は変わらない
 *   どのカードかは、この画面に来た時点ですでに決まっている。
 *   タップは**めくる動作**であって、選ぶ操作ではない。
 *   狙って止められる作りにすると「移動カードは引き直せない」
 *   という仕様（§2.3）が意味を失う。
 *
 * ■ めくり方
 *   カードを横に回して（rotateY）、半分回ったところで中身を入れ替える。
 *   裏と表を2枚重ねる作りにすると、端末によっては裏側が透けるので、
 *   1枚を回して途中で差し替えるほうが確実。
 *
 * ■ 裏は縦長、表は横長にする
 *   裏は「カードらしさ」が要るので縦長で、ゆっくり揺らして押せると伝える。
 *   表は**画面いっぱいの横長**にする。縦長のままだと幅が狭く、
 *   「行ったことない公園まで歩こう」のような一文がすぐ折り返して読みにくい。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 回っている時間（ミリ秒）。CSSの .aq-flip と合わせること */
const FLIP_MS = 460;

export function CardFlip({
  kind,
  label,
  ready,
  flipped,
  onFlipped,
}: {
  kind: "movement" | "action";
  /** 表に出す文面 */
  label: string | null;
  /** めくれる状態か（抽選が終わっているか） */
  ready: boolean;
  /** すでにめくった状態で見せるか（途中から戻ってきたとき） */
  flipped: boolean;
  onFlipped: () => void;
}) {
  const [turning, setTurning] = useState(false);
  const [showFront, setShowFront] = useState(flipped);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach(clearTimeout);
  }, []);

  const flip = useCallback(() => {
    if (!ready || showFront || turning) return;
    setTurning(true);

    // 半分回ったところで中身を差し替える
    timers.current.push(
      setTimeout(() => setShowFront(true), FLIP_MS / 2),
      setTimeout(() => {
        setTurning(false);
        onFlipped();
      }, FLIP_MS),
    );
  }, [ready, showFront, turning, onFlipped]);

  return (
    <button
      type="button"
      onClick={flip}
      disabled={showFront || !ready}
      aria-label={showFront ? undefined : "カードをめくる"}
      className={[
        "aq-hero mx-auto flex flex-col items-center justify-center text-center",
        "disabled:cursor-default",
        // 裏は縦長・ゆらゆら、表は横長でどっしり
        showFront
          ? "aq-rise w-full px-6 py-8"
          : "aq-wobble w-full max-w-[260px] min-h-[300px] px-6 py-10",
        turning ? "aq-flip" : "",
      ].join(" ")}
    >
      {showFront ? (
        <>
          <span className="aq-label">
            {kind === "movement" ? "移動カード" : "お題"}
          </span>
          <p className="mt-3 text-[26px] font-bold leading-[1.6] tracking-wide">
            {label}
          </p>
        </>
      ) : (
        <>
          {/* 裏面。？を点線の丸で囲むだけの、静かな見た目にする */}
          <span className="flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-dashed border-[var(--grass)]/45 text-4xl font-bold text-[var(--grass)]">
            ?
          </span>
          <p className="mt-5 text-base font-bold tracking-wide">
            {ready ? "タップしてめくる" : "準備中…"}
          </p>
        </>
      )}
    </button>
  );
}
