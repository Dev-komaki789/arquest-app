/**
 * ============================================================
 * アルクエスト — 本編の画面（クエスト1周ぶん）
 * ============================================================
 *
 * ■ この画面で完結すること（仕様書§2.2・§2.3・§2.5）
 *   クエストを 受ける → 移動カード → 「ついた」 → 行動カード → できた／まだ
 *
 * ■ 位置情報を使う区間は1つだけ
 *   移動カードは座標に紐付かず、到着もGPSではなく自己申告なので、
 *   移動中は位置情報を使わない（仕様書§2.2）。
 *   **行動カードを引いた瞬間から**、歩いた距離と軌跡を記録する（§2.7）。
 *
 * ■ 見た目は screen-shot/ のモックアップに合わせている
 *   ・上が濃く下が淡いスカイブルーの背景＋右上の装飾円
 *   ・相棒のセリフは紺地・ゴールド枠のメッセージウィンドウ
 *   ・進むボタンはゴールド、副ボタンは白
 *   ・達成報告だけ紺地（相棒が光る）
 *
 *   ただしモックアップは仕様が変わる前のものなので、
 *   **中身は引き写していない。**連続日数・対人度★・カテゴリ・到達判定は
 *   仕様書§10で不採用になっているため、見た目だけを借りている。
 */

"use client";

import { Companion } from "@/components/Companion";
import { InstallPrompt } from "@/components/InstallPrompt";
import { useQuest } from "@/hooks/useQuest";
import { useQuestTrail } from "@/hooks/useQuestTrail";
import { isWeekend, MAX_REDRAW } from "@/lib/quest";

/** 距離を読みやすく。1km未満はm、それ以上はkm */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

/**
 * 相棒のセリフ枠（RPGのメッセージウィンドウ）。
 * 紺地にゴールドの縁。名前を上に出し、右下に続きの印を置く。
 */
function MessageWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full rounded-2xl border-[3px] border-[var(--gold)] bg-[var(--navy)] px-4 py-3 pb-6 text-[15px] leading-relaxed text-white shadow-[0_6px_0_rgba(30,42,74,0.25)]">
      <p className="mb-1 text-xs font-bold tracking-widest text-[var(--gold)]">
        スラりん
      </p>
      {children}
      <span className="absolute bottom-2 right-3 text-xs text-[var(--gold)]">
        ▼
      </span>
    </div>
  );
}

/**
 * クエストのカード。
 *
 * 移動カードと行動カードで器を変えている。
 * 情報の重さが違うのに形が同じだと、目が行き先を決められないため。
 */
function Card({
  kind,
  label,
  note,
}: {
  kind: "movement" | "action";
  label: string;
  note?: string;
}) {
  const isMovement = kind === "movement";
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
      {/* 左端の帯で種類を示す。文字を読む前に色で分かる */}
      <div className="flex">
        <div
          className={`w-2 shrink-0 ${isMovement ? "bg-[var(--sky)]" : "bg-[var(--gold)]"}`}
        />
        <div className="flex-1 px-5 py-6 text-center">
          <p className="text-xs font-bold tracking-widest text-[var(--navy)]/50">
            {isMovement ? "いどうカード" : "こうどうカード"}
          </p>
          <p className="mt-3 text-xl font-bold leading-relaxed">{label}</p>
          {note && <p className="mt-3 text-xs text-[var(--navy)]/60">{note}</p>}
        </div>
      </div>
    </div>
  );
}

/** 進むボタン（ゴールド）と、控えめなボタン（白） */
function Button({
  onClick,
  disabled,
  variant = "primary",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "quiet";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full rounded-2xl px-4 py-4 text-base font-bold transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "border-[3px] border-[var(--navy)] bg-[var(--gold)] text-[var(--navy)] shadow-[0_5px_0_var(--navy)] active:translate-y-[3px] active:shadow-none"
          : "bg-white text-[var(--navy)] shadow-md active:bg-[var(--sky-pale)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function Page() {
  const {
    quest,
    finished,
    reward,
    loading,
    busy,
    error,
    draw,
    arrive,
    redraw,
    finish,
    closeReport,
  } = useQuest();

  const weekend = isWeekend();

  // 行動カードを引いた後だけ、歩いた距離と軌跡を記録する（仕様書§2.7）
  const trail = useQuestTrail(quest);

  // 達成報告だけ紺地。相棒の言葉が特別に見えるように、背景ごと変える
  const onReport = Boolean(finished);

  return (
    <main
      className={[
        "relative min-h-dvh w-full overflow-hidden",
        onReport
          ? "bg-[var(--navy)] text-white"
          : "bg-gradient-to-b from-[var(--sky)] via-[#9DC0F5] to-[var(--sky-pale)]",
      ].join(" ")}
    >
      {/* 右上の装飾円。画面ごとに位置と大きさを変えて、同じ絵に見えないようにする */}
      <div
        aria-hidden="true"
        className={[
          "pointer-events-none absolute rounded-full bg-white/10",
          onReport
            ? "-right-16 top-24 h-56 w-56"
            : quest
              ? "-right-10 -top-16 h-52 w-52"
              : "right-6 -top-24 h-64 w-64",
        ].join(" ")}
      />

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-10 pt-6">
        {!onReport && (
          <header>
            <p className="text-xs font-bold tracking-widest text-white/80">
              {weekend ? "きょうは 休日" : "きょうは 平日"}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-wide text-white drop-shadow">
              アルクエスト
            </h1>
          </header>
        )}

        {error && (
          <p className="rounded-2xl bg-white px-4 py-3 text-sm text-[var(--navy)] shadow-lg">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-20 text-center text-sm text-white/90">よみこみ中…</p>
        ) : finished ? (
          /* ---------- ④ 終わった直後：達成報告 ---------- */
          <section className="flex flex-col items-center gap-5 pt-8">
            <Companion
              mood={finished.actionResult === "done" ? "happy" : "gentle"}
              glow={finished.actionResult === "done"}
              size={160}
            />

            <h2 className="text-2xl font-bold tracking-widest text-[var(--gold)]">
              {finished.actionResult === "done"
                ? "クエスト クリア！"
                : "きょうも おつかれさま"}
            </h2>

            {reward && (
              <div className="w-full rounded-2xl border-[3px] border-[var(--gold)] bg-[#16203A] p-5">
                <dl className="flex flex-col gap-3 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-white/70">EXP</dt>
                    <dd className="text-2xl font-bold text-[var(--gold)]">
                      +{reward.expGained}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-white/70">歩いた距離</dt>
                    <dd className="text-2xl font-bold text-[#9DC0F5]">
                      {formatDistance(reward.distanceM)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-white/70">ぬれたマス</dt>
                    <dd className="text-2xl font-bold text-[#9DC0F5]">
                      {reward.newCell ? "+1" : "±0"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 border-t border-white/15 pt-3">
                  <p className="flex items-center justify-between text-xs text-white/60">
                    <span>Lv.{reward.companionLevel}</span>
                    <span>つぎのレベルまで あと {500 - (reward.companionExp % 500)}</span>
                  </p>
                  {/* レベルは500EXPごとに上がる。いまの進み具合を帯で見せる */}
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-[var(--gold)]"
                      style={{ width: `${((reward.companionExp % 500) / 500) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="w-full rounded-2xl bg-white/5 p-5 text-sm">
              <p className="text-white/60">いどうカード</p>
              <p className="mt-1 font-bold">{finished.movementCard.label}</p>
              <p className="mt-4 text-white/60">こうどうカード</p>
              <p className="mt-1 font-bold">{finished.actionCard?.label}</p>
            </div>

            {/* 相棒のひとこと。達成報告では枠を点線にして、
                指示ではなく感想であることを見た目でも分ける */}
            <div className="w-full rounded-2xl border-2 border-dashed border-[var(--gold)]/70 bg-white/5 p-4 text-sm leading-relaxed">
              <p className="mb-1 text-[var(--gold)]">「スラりん」</p>
              {finished.actionResult === "done"
                ? "おつかれさま。きょうの1歩は、ちゃんと きろくしておいたよ。"
                : "こられただけで じゅうぶんだよ。きょうのことも きろくしておくね。"}
            </div>

            <Button onClick={closeReport} variant="quiet">
              ホームへ
            </Button>
          </section>
        ) : !quest ? (
          /* ---------- ① クエストが無い：相棒が誘う ---------- */
          <section className="flex flex-col items-center gap-5 pt-4">
            <Companion mood="invite" size={150} />
            <MessageWindow>
              きょうの クエストを 受けようか。
              <br />
              きぶんでないときは、また こんどでも だいじょうぶ。
            </MessageWindow>

            <div className="mt-2 w-full">
              <Button onClick={draw} disabled={busy}>
                {busy ? "うけています…" : "クエストを 受ける"}
              </Button>
            </div>

            <p className="text-center text-xs leading-relaxed text-[var(--navy)]/60">
              {weekend
                ? "休日は、電車やバスを使うクエストも出ます。"
                : "平日は、歩いて行けるクエストだけが出ます。"}
            </p>

            {/* ホーム画面に追加する案内。
                すでに追加済みなら何も出ない（仕様書§2.1） */}
            <InstallPrompt />
          </section>
        ) : quest.status === "moving" ? (
          /* ---------- ② 移動中 ---------- */
          <section className="flex flex-col gap-4">
            <div className="flex items-start gap-2">
              {/* 出かける場面なので跳ねさせる。
                  「ふつう」と「つぶれ」の2枚を着地の瞬間に入れ替えている */}
              <Companion mood="telling" size={92} motion="hop" />
              <MessageWindow>きょうの クエストは……</MessageWindow>
            </div>

            <Card
              kind="movement"
              label={quest.movementCard.label}
              note={
                quest.movementCard.transportMode === "transit_ok"
                  ? "電車やバスを使ってもいいクエスト"
                  : "歩いて行くクエスト"
              }
            />

            <p className="text-center text-xs leading-relaxed text-[var(--navy)]/60">
              ついたと おもったら、じぶんで おしてね。
              <br />
              ここまでは 位置情報を つかっていません。
            </p>

            <Button onClick={arrive} disabled={busy}>
              {busy ? "ひいています…" : "ついた"}
            </Button>
          </section>
        ) : (
          /* ---------- ③ 行動中 ---------- */
          <section className="flex flex-col gap-4">
            <div className="flex items-start gap-2">
              <Companion mood="waiting" size={92} />
              <MessageWindow>
                ついたね。ここからは じぶんの番。
                <br />
                むりのない はんいで だいじょうぶ。
              </MessageWindow>
            </div>

            <Card
              kind="action"
              label={quest.actionCard?.label ?? ""}
              note={
                quest.actionCard?.involvesSpending
                  ? "お金をつかうクエスト。むりなら ひきなおしてもいいよ"
                  : undefined
              }
            />

            {quest.redrawCount < MAX_REDRAW ? (
              <button
                type="button"
                onClick={redraw}
                disabled={busy}
                className="mx-auto text-sm font-bold text-[var(--navy)]/70 underline disabled:opacity-50"
              >
                ひきなおす（のこり {MAX_REDRAW - quest.redrawCount} 回）
              </button>
            ) : (
              <p className="text-center text-xs text-[var(--navy)]/50">
                ひきなおしは つかいきりました
              </p>
            )}

            <div className="rounded-2xl bg-white/70 px-4 py-3 text-xs text-[var(--navy)]/70">
              もとの クエスト：{quest.movementCard.label}
            </div>

            {/* ここから歩いた距離。位置情報が使えないときは代わりに理由を出す */}
            {trail.notice ? (
              <p className="whitespace-pre-line rounded-2xl bg-white px-4 py-3 text-xs leading-relaxed text-[var(--navy)]/70 shadow">
                {trail.notice}
              </p>
            ) : (
              <div className="flex items-baseline justify-between rounded-2xl bg-white px-4 py-3 shadow">
                <span className="text-xs text-[var(--navy)]/60">
                  ここから歩いた距離
                </span>
                <span className="text-xl font-bold">
                  {formatDistance(trail.distanceM)}
                </span>
              </div>
            )}

            <div className="mt-2 flex flex-col gap-3">
              <Button
                onClick={() =>
                  finish("done", {
                    distanceM: trail.distanceM,
                    position: trail.lastPosition,
                  })
                }
                disabled={busy}
              >
                できた
              </Button>
              <Button
                onClick={() =>
                  finish("not_yet", {
                    distanceM: trail.distanceM,
                    position: trail.lastPosition,
                  })
                }
                disabled={busy}
                variant="quiet"
              >
                まだ・もうすこし ねばる
              </Button>
              <p className="text-center text-xs text-[var(--navy)]/60">
                できなくても、来たことは記録されます。
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
