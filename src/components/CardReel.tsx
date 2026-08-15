/**
 * ============================================================
 * カードのルーレット（引く演出）
 * ============================================================
 *
 * ■ 何をするものか
 *   カードの文面が次々と入れ替わり、タップすると止まって1枚に決まる。
 *
 * ■ タップで結果が変わるわけではない（ここが大事）
 *   **どのカードになるかは、押した瞬間にはもう決まっている。**
 *   タップは「めくる」動作であって、狙って止める操作ではない。
 *
 *   タップのタイミングで結果が決まる作りにすると、
 *   狙ったカードを出せてしまい、「移動カードは引き直せない」という
 *   仕様（§2.3）が意味を失う。楽なお題だけを選べる抜け道にもなる。
 *
 *   演出としては、狙えないほうが気持ちよくもある。
 *   止めたのに違うものが出るのではなく、**止めた先に決まっていたものがある**。
 *
 * ■ 通信の待ち時間を隠せる
 *   引くときはサーバーに記録する通信が挟まる。
 *   その間ルーレットが回っているので、待たされている感じにならない。
 *   結果が届くまでは止めるボタンを押せないようにしてある。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 止めたあと、減速しながら見せる間隔（ミリ秒）。だんだん遅くなる */
const SLOWDOWN_STEPS = [70, 90, 120, 160, 210, 280, 360, 460];

/** 回っている間の入れ替え間隔 */
const SPIN_INTERVAL = 70;

export function CardReel({
  kind,
  candidates,
  result,
  onSettled,
}: {
  kind: "movement" | "action";
  /** 流して見せる文面（結果とは関係ない、ただの見せ札） */
  candidates: string[];
  /** 決まった文面。まだ決まっていなければ null */
  result: string | null;
  /** 止まりきったら呼ばれる */
  onSettled: () => void;
}) {
  const [label, setLabel] = useState(candidates[0] ?? "");
  const [phase, setPhase] = useState<"spinning" | "slowing" | "settled">("spinning");

  // 片付けるために、動いている時計を覚えておく
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 回している間、文面を次々に入れ替える
  useEffect(() => {
    if (phase !== "spinning" || candidates.length === 0) return;

    const id = setInterval(() => {
      setLabel(candidates[Math.floor(Math.random() * candidates.length)]);
    }, SPIN_INTERVAL);

    return () => clearInterval(id);
  }, [phase, candidates]);

  // 画面を離れるときに、動いている時計を止める
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    if (!result || phase !== "spinning") return;
    setPhase("slowing");

    // 少しずつ間隔を広げながら見せ札を送り、最後に結果を出す。
    // 一定の速さのまま急に止めると、決まった感じが出ない。
    let step = 0;
    const next = () => {
      if (step < SLOWDOWN_STEPS.length) {
        setLabel(candidates[Math.floor(Math.random() * candidates.length)] ?? "");
        timerRef.current = setTimeout(next, SLOWDOWN_STEPS[step]);
        step += 1;
        return;
      }

      setLabel(result);
      setPhase("settled");
      // 決まった文面をひと呼吸見せてから、次の画面へ渡す
      timerRef.current = setTimeout(onSettled, 900);
    };

    next();
  }, [result, phase, candidates, onSettled]);

  const settled = phase === "settled";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-center text-xs font-bold tracking-widest text-[var(--gold)]">
        {kind === "movement" ? "移動カード" : "行動カード"}
      </p>

      {/* カードの見た目は、決まった後の画面と同じにしておく。
          止まった瞬間から画面が地続きに見える */}
      <div
        className={[
          // 背景は回っている間も白のまま。
          // 半透明にすると後ろの紺が透けて灰色に見え、カードがくすむ
          "flex min-h-[168px] items-center justify-center rounded-2xl border-[3px] bg-white px-5 py-8 text-center transition",
          settled
            ? "border-[var(--gold)] shadow-[0_8px_0_rgba(0,0,0,0.25)]"
            : "border-[var(--gold)]/40",
        ].join(" ")}
      >
        <p
          className={[
            "text-2xl font-bold leading-relaxed text-[var(--navy)]",
            // 回っている間は少しぼかすだけ。薄くすると色がくすむので、濃さは変えない
            settled ? "" : "blur-[1.5px]",
          ].join(" ")}
        >
          {label}
        </p>
      </div>

      {settled ? (
        <p className="text-center text-sm text-[var(--gold)]">きまり！</p>
      ) : (
        <button
          type="button"
          onClick={stop}
          disabled={!result || phase !== "spinning"}
          className="w-full rounded-xl bg-[var(--gold)] px-4 py-4 text-base font-bold text-[var(--navy)] shadow-[0_4px_0_var(--gold-deep)] transition active:translate-y-[3px] active:shadow-none disabled:opacity-50"
        >
          {result ? "タップして とめる" : "ひいています…"}
        </button>
      )}
    </div>
  );
}
