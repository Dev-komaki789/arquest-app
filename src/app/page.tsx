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
 *   その境目は画面にも書いてある。黙って取り始めないことが、この設計の主張なので。
 *
 * ■ 見た目は 画面イメージ.png に合わせている
 *   ・紺色の背景に、ゴールドの見出し
 *   ・カードは白地・ゴールドの縁。**画面でいちばん明るいのがカード**になる
 *   ・進むボタンはゴールド、迷ったときの選択肢は紺
 *   ・相棒のセリフは明るい吹き出し（紺地に埋もれないように）
 *
 *   まだ入っていないもの（あとの段階）:
 *   下部のタブ（日記・マップ・設定）、通り道のスポット、写真、おかね。
 */

"use client";

import { Companion } from "@/components/Companion";
import { InstallPrompt } from "@/components/InstallPrompt";
import { WalkScene } from "@/components/WalkScene";
import { useQuest } from "@/hooks/useQuest";
import { useQuestTrail } from "@/hooks/useQuestTrail";
import { isWeekend, MAX_REDRAW } from "@/lib/quest";

/** 距離を読みやすく。1km未満はm、それ以上はkm */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

/** 画面の上に出す小さなラベル（「とうちゃく」など） */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-bold text-[var(--navy)]">
      {children}
    </span>
  );
}

/**
 * お告げのカード。画面でいちばん明るく、いちばん大きい要素。
 *
 * 白地にゴールドの縁。ここだけ見れば用が足りるようにしておく
 * （歩きながら片手で、一瞬しか見ないため）。
 */
function Card({
  kind,
  label,
  note,
}: {
  kind: "movement" | "action";
  label: string;
  note?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border-[3px] border-[var(--gold)] bg-white px-5 py-6 shadow-[0_8px_0_rgba(0,0,0,0.25)]">
      <p className="text-xs font-bold tracking-widest text-[var(--gold-deep)]">
        {kind === "movement" ? "移動カード" : "お題"}
      </p>
      <p className="mt-3 text-2xl font-bold leading-relaxed text-[var(--navy)]">
        {label}
      </p>
      {note && (
        <p className="mt-4 text-xs leading-relaxed text-[var(--navy)]/60">{note}</p>
      )}
    </div>
  );
}

/** 相棒のセリフ。紺地に埋もれないよう、明るい吹き出しにする */
function Speech({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex-1 rounded-2xl border-2 border-[var(--gold)] bg-[#F2F6FF] px-4 py-3 pb-5 text-sm leading-relaxed text-[var(--navy)]">
      <p className="mb-1 text-xs font-bold tracking-widest text-[var(--gold-deep)]">
        スラりん
      </p>
      {children}
      <span className="absolute bottom-1.5 right-3 text-xs text-[var(--gold-deep)]">
        ▼
      </span>
    </div>
  );
}

/**
 * ボタン3種。
 *   primary … 進む（ゴールド）
 *   dark    … 迷ったときの選択肢
 *   link    … やめる・見なおす（文字だけ）
 */
function Button({
  onClick,
  disabled,
  variant = "primary",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "dark" | "link";
  children: React.ReactNode;
}) {
  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mx-auto text-sm text-white/60 underline disabled:opacity-40"
      >
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full rounded-xl px-4 py-4 text-base font-bold transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-[var(--gold)] text-[var(--navy)] shadow-[0_4px_0_var(--gold-deep)] active:translate-y-[3px] active:shadow-none"
          : "border border-white/20 bg-white/10 text-white active:bg-white/20",
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
    cancel,
    finish,
    closeReport,
  } = useQuest();

  const weekend = isWeekend();

  // 行動カードを引いた後だけ、歩いた距離と軌跡を記録する（仕様書§2.7）
  const trail = useQuestTrail(quest);
  const walked = { distanceM: trail.distanceM, position: trail.lastPosition };

  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-[linear-gradient(180deg,#1B2559_0%,#141C40_100%)] text-white">
      {/* 装飾の光。画面ごとに位置を変えて、同じ絵に見えないようにする */}
      <div
        aria-hidden="true"
        className={[
          "pointer-events-none absolute rounded-full bg-[var(--sky)]/15 blur-3xl",
          finished
            ? "-top-20 left-1/2 h-72 w-72 -translate-x-1/2"
            : quest
              ? "-right-16 top-40 h-56 w-56"
              : "-left-16 -top-16 h-64 w-64",
        ].join(" ")}
      />

      <div className="relative mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-12 pt-7">
        {error && (
          <p className="rounded-xl border border-[var(--gold)]/50 bg-white px-4 py-3 text-sm text-[var(--navy)]">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-24 text-center text-sm text-white/60">よみこみ中…</p>
        ) : finished ? (
          /* ---------- ④ クエスト たっせい ---------- */
          <section className="flex flex-col items-center gap-4 pt-6">
            <Companion
              mood={finished.actionResult === "done" ? "happy" : "gentle"}
              glow={finished.actionResult === "done"}
              size={170}
            />

            <h1 className="text-3xl font-bold tracking-widest text-[var(--gold)]">
              {finished.actionResult === "done"
                ? "クエスト たっせい"
                : "きょうも おつかれさま"}
            </h1>

            <p className="text-center text-xs leading-relaxed text-white/60">
              {finished.movementCard.label}
              <br />
              {finished.actionCard?.label}
            </p>

            {reward && (
              <div className="mt-2 w-full rounded-2xl border border-white/15 bg-white/5 p-5">
                <dl className="flex flex-col gap-3">
                  {[
                    { label: "EXP", value: `+${reward.expGained}`, gold: true },
                    {
                      label: "歩いた きょり",
                      value: formatDistance(reward.distanceM),
                    },
                    { label: "ぬれたマス", value: reward.newCell ? "+1" : "±0" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-baseline justify-between">
                      <dt className="text-sm text-white/70">{row.label}</dt>
                      <dd
                        className={`text-xl font-bold ${
                          row.gold ? "text-[var(--gold)]" : "text-white"
                        }`}
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
                  <span className="shrink-0 text-xs text-white/60">
                    Lv.{reward.companionLevel + 1} まで
                  </span>
                  {/* レベルは500EXPごとに上がる。いまの進み具合を帯で見せる */}
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-[var(--gold)]"
                      style={{
                        width: `${((reward.companionExp % 500) / 500) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-2 w-full">
              <Button onClick={closeReport}>ホームへ</Button>
            </div>
          </section>
        ) : !quest ? (
          /* ---------- ① クエストが無い：相棒が誘う ---------- */
          <section className="flex flex-col gap-5">
            <header className="text-center">
              <p className="text-xs font-bold tracking-widest text-[var(--gold)]">
                {weekend ? "きょうは 休日" : "きょうは 平日"}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-widest text-white">
                アルクエスト
              </h1>
            </header>

            <div className="flex items-end gap-2 pt-4">
              <Companion mood="invite" size={130} />
              <Speech>
                きょうの クエストを 受けようか。
                <br />
                きぶんでないときは、また こんどでも だいじょうぶ。
              </Speech>
            </div>

            <div className="mt-4">
              <Button onClick={draw} disabled={busy}>
                {busy ? "うけています…" : "クエストを 受ける"}
              </Button>
            </div>

            <p className="text-center text-xs leading-relaxed text-white/50">
              {weekend
                ? "休日は、電車やバスを使うクエストも出ます。"
                : "平日は、歩いて行けるクエストだけが出ます。"}
            </p>

            {/* ホーム画面に追加する案内。すでに追加済みなら何も出ない（仕様書§2.1） */}
            <InstallPrompt />
          </section>
        ) : quest.status === "moving" ? (
          /* ---------- ② 移動カード（移動中） ---------- */
          <section className="flex flex-col gap-5">
            <header className="text-center">
              <p className="text-xs font-bold tracking-widest text-[var(--gold)]">
                {quest.movementCard.transportMode === "transit_ok"
                  ? "電車やバスを 使ってもいい"
                  : "歩いて 行く"}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-widest text-white">
                移動カード
              </h1>
            </header>

            <Card
              kind="movement"
              label={quest.movementCard.label}
              note={
                <>
                  行き先は 決まっていません。
                  <br />
                  この一文だけを 持って 出かけます。
                </>
              }
            />

            {/* 歩いている帯。景色が流れ、相棒はその場で跳ねる。
                位置情報とは無関係の飾りで、進んでいる気分だけを出す */}
            <WalkScene label="移動中…">
              <Companion mood="telling" size={96} motion="hop" />
            </WalkScene>

            <div className="flex items-end gap-2">
              <Speech>
                これが きょうの クエスト。
                <br />
                着いたら、もう1枚 めくろうね。
              </Speech>
            </div>

            <p className="text-center text-xs leading-relaxed text-white/50">
              ついたと おもったら、じぶんで おしてね。
              <br />
              ここまでは 位置情報を つかっていません。
            </p>

            <Button onClick={arrive} disabled={busy}>
              {busy ? "めくっています…" : "ついた"}
            </Button>

            <Button onClick={cancel} disabled={busy} variant="link">
              きょうは やめておく
            </Button>
          </section>
        ) : (
          /* ---------- ③ 行動カード ---------- */
          <section className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Pill>とうちゃく</Pill>
              <span className="text-xs text-white/60">{quest.movementCard.label}</span>
            </div>

            <h1 className="text-center text-2xl font-bold tracking-widest text-white">
              行動カード
            </h1>

            <Card
              kind="action"
              label={quest.actionCard?.label ?? ""}
              note={
                quest.actionCard?.involvesSpending
                  ? "お金をつかうお題です。むりなら 引き直してもいいよ。"
                  : undefined
              }
            />

            {/* ここが位置情報の境目。黙って始めない */}
            {trail.notice ? (
              <p className="whitespace-pre-line rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/70">
                {trail.notice}
              </p>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3">
                <span className="flex items-center gap-2 text-xs text-white/70">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full bg-[#E4573D]"
                  />
                  ここから 軌跡と距離の 記録が はじまりました
                </span>
                <span className="text-sm font-bold">
                  {formatDistance(trail.distanceM)}
                </span>
              </div>
            )}

            {quest.redrawCount < MAX_REDRAW ? (
              <Button onClick={redraw} disabled={busy} variant="dark">
                再抽選（あと {MAX_REDRAW - quest.redrawCount} 回）
              </Button>
            ) : (
              <p className="text-center text-xs text-white/40">
                引き直しは つかいきりました
              </p>
            )}

            <div className="mt-2 flex flex-col gap-3">
              <Button onClick={() => finish("done", walked)} disabled={busy}>
                できた
              </Button>
              <Button
                onClick={() => finish("not_yet", walked)}
                disabled={busy}
                variant="dark"
              >
                まだ・もうすこし ねばる
              </Button>
              <p className="text-center text-xs text-white/50">
                できなくても、来たことは記録されます。
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
