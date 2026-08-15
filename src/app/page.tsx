/**
 * ============================================================
 * アルクエスト — 本編の画面
 * ============================================================
 *
 * ■ 画面の並び（screen-images/ のモックアップに準拠）
 *   ホーム → 移動カード（めくる）→ 移動中 → 行動カード（めくる）→ 達成
 *
 * ■ 位置情報を使う区間は限られている
 *   移動カードは座標に紐付かず、到着もGPSではなく自己申告なので、
 *   移動中は位置情報を使わない（仕様書§2.2）。使うのは次の2つだけ。
 *     ・行動カードを引いた後の、軌跡と距離の記録（§2.7）
 *     ・設定でオンにしたときの、通り道のスポット探し（§2.4）
 *   どちらも画面に「いつ始まるか」を書いてある。黙って取り始めない。
 *
 * ■ カードは「引く」ではなく「めくる」
 *   どのカードかは画面に来た時点で決まっていて、タップは開く動作。
 *   狙って止められる作りにすると、引き直せない仕様が意味を失う。
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CardFlip } from "@/components/CardFlip";
import { Companion } from "@/components/Companion";
import { Confetti } from "@/components/Confetti";
import { DetourRoute } from "@/components/DetourRoute";
import { DiaryComposer } from "@/components/DiaryComposer";
import { InstallPrompt } from "@/components/InstallPrompt";
import { TabBar } from "@/components/TabBar";
import { WalkingInfoPanel } from "@/components/WalkingInfoPanel";
import { WalkScene } from "@/components/WalkScene";
import { useDestination } from "@/hooks/useDestination";
import { useQuest } from "@/hooks/useQuest";
import { useQuestTrail } from "@/hooks/useQuestTrail";
import { useWalkingInfo } from "@/hooks/useWalkingInfo";
import { EXP_PER_LEVEL, loadProfile, type Profile } from "@/lib/profile";
import { isWeekend, MAX_REDRAW } from "@/lib/quest";
import { loadSettings, setShowWalkingInfo } from "@/lib/settings";

/** 距離を読みやすく。1km未満はm、それ以上はkm */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** 数字と単位を分ける（単位だけ小さく出すため） */
function splitDistance(meters: number): { value: string; unit: string } {
  return meters < 1000
    ? { value: String(Math.round(meters)), unit: "m" }
    : { value: (meters / 1000).toFixed(1), unit: "km" };
}

/** 相棒のセリフ（白い吹き出し・右下に▼） */
function Speech({ children }: { children: React.ReactNode }) {
  return (
    <div className="aq-window flex-1 text-[15px]">
      <p className="aq-window-name">スラりん</p>
      {children}
    </div>
  );
}

/** 数字＋単位。単位を小さくすると数字が読みやすい */
function Amount({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="mt-0.5 text-2xl font-bold tracking-wide">
      {value}
      {unit && <span className="ml-0.5 text-xs font-bold">{unit}</span>}
    </p>
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

  /**
   * 移動カードをめくったあと「出発する」を押したか。
   *
   * データベースには持たせない。移動中かどうかは quests の status で分かるし、
   * 開き直したときはカードの画面から始めたほうが、
   * 「何を持って出たのか」を確かめられる（モックアップの「カードを見なおす」と同じ考え）。
   */
  const [departedFor, setDepartedFor] = useState<string | null>(null);
  const [flippedFor, setFlippedFor] = useState<{
    movement: string | null;
    action: string | null;
  }>({ movement: null, action: null });
  const [writingDiary, setWritingDiary] = useState(false);

  /**
   * めくった・出発したという状態は「どのカードに対してか」で覚える。
   *
   * クエストが変わったときに useEffect で戻す書き方もできるが、
   * 描き直しが二度手間になるうえ、このプロジェクトのESLintに止められる。
   * 「いま画面に出ているカードのIDと一致していれば、めくってある」と読み替えれば、
   * 初期化そのものが要らなくなる。
   */
  const movementFlipped = flippedFor.movement === quest?.movementCard.id;
  const departed = departedFor === quest?.id;
  const actionFlipped =
    quest?.actionCard != null && flippedFor.action === quest.actionCard.id;

  const moving = quest?.status === "moving";
  const onTheRoad = Boolean(moving && departed);

  // 移動中の表示（仕様書§2.4）。既定はオフ
  const [showWalking, setShowWalking] = useState(false);
  const walkingInfo = useWalkingInfo(showWalking && onTheRoad);
  const detour = useDestination();

  // 経過時間を1秒ごとに描き直すための、いまの時刻
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!onTheRoad) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [onTheRoad]);

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((settings) => {
        if (alive) setShowWalking(settings.showWalkingInfo);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const toggleWalking = (value: boolean) => {
    setShowWalking(value);
    void setShowWalkingInfo(value).catch(() => {});
  };

  // 行動カードを引いた後だけ、歩いた距離と軌跡を記録する（仕様書§2.7）
  const trail = useQuestTrail(quest);
  const walked = { distanceM: trail.distanceM, position: trail.lastPosition };

  // ホームに出す記録。1回終えるたびに読み直す
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let alive = true;
    loadProfile()
      .then((loaded) => {
        if (alive) setProfile(loaded);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [finished]);

  const today = splitDistance(profile?.todayDistanceM ?? 0);
  const total = splitDistance(profile?.totalDistanceM ?? 0);

  return (
    <main className="min-h-dvh w-full bg-[linear-gradient(180deg,var(--grass-mist)_0%,var(--paper)_45%)] pb-28">
      {error && (
        <p className="mx-5 mt-4 rounded-2xl bg-white px-4 py-3 text-sm shadow">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-24 text-center text-sm text-[var(--ink-muted)]">
          読み込み中…
        </p>
      ) : finished ? (
        /* ================= 達成 ================= */
        <section className="relative mx-auto flex w-full max-w-md flex-col items-center gap-4 px-5 pt-10">
          <div className="relative">
            {/* できたときだけ紙吹雪を降らせる。相棒のまわりだけで舞わせる。
                「まだ」で終えた日に派手に祝うと、責められている感じになる */}
            {finished.actionResult === "done" && <Confetti />}

            {/* 相棒のうしろから光を放つ */}
            {finished.actionResult === "done" && (
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 -z-10 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,185,66,0.55)_0%,rgba(245,185,66,0)_70%)]"
              />
            )}
            <Companion
              mood={finished.actionResult === "done" ? "happy" : "gentle"}
              glow={finished.actionResult === "done"}
              size={168}
            />
          </div>

          <h1
            className={[
              "aq-rise text-center text-[34px] font-bold tracking-[0.1em] text-[var(--grass)]",
              finished.actionResult === "done" ? "drop-shadow-sm" : "",
            ].join(" ")}
          >
            {finished.actionResult === "done"
              ? "クエスト達成！"
              : "今日もおつかれさま"}
          </h1>

          {/* 何をしたのかを、ラベル付きで大きく出す。
              1行にまとめると「ただの説明文」に見えて読み飛ばされる */}
          <div className="aq-card w-full divide-y divide-[var(--ink)]/8">
            <div className="px-5 py-4">
              <p className="aq-label">移動カード</p>
              <p className="mt-1.5 text-lg font-bold leading-relaxed">
                {finished.movementCard.label}
              </p>
            </div>
            <div className="px-5 py-4">
              <p className="aq-label">行動カード</p>
              <p className="mt-1.5 text-lg font-bold leading-relaxed">
                {finished.actionCard?.label}
              </p>
            </div>
          </div>

          {reward && (
            <div className="aq-card aq-rise mt-2 w-full px-5 py-5">
              <dl className="flex flex-col gap-3">
                {[
                  { label: "EXP", value: `+${reward.expGained}` },
                  {
                    label: "歩いた距離",
                    value: formatDistance(reward.distanceM),
                  },
                  { label: "塗ったマス", value: reward.newCell ? "+1" : "±0" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between"
                  >
                    <dt className="text-sm">{row.label}</dt>
                    <dd className="text-xl font-bold text-[var(--grass)]">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex items-center gap-3 border-t border-[var(--ink)]/10 pt-4">
                <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                  Lv.{reward.companionLevel + 1} まで
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--grass-pale)]">
                  <div
                    className="h-full rounded-full bg-[var(--grass)]"
                    style={{
                      width: `${((reward.companionExp % EXP_PER_LEVEL) / EXP_PER_LEVEL) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {writingDiary ? (
            <DiaryComposer
              questId={finished.id}
              onSaved={() => {
                setWritingDiary(false);
                closeReport();
              }}
              onCancel={() => setWritingDiary(false)}
            />
          ) : (
            <div className="mt-4 flex w-full gap-3">
              <button
                type="button"
                onClick={() => setWritingDiary(true)}
                className="aq-btn-quiet flex-1"
              >
                日記に書く
              </button>
              <button
                type="button"
                onClick={closeReport}
                className="aq-btn flex-1"
              >
                ホームへ
              </button>
            </div>
          )}
        </section>
      ) : !quest ? (
        /* ================= ホーム ================= */
        <>
          <section className="rounded-b-[28px] bg-[var(--grass-pale)] px-5 pb-6 pt-6">
            <div className="mx-auto w-full max-w-md">
              {/* 自分の記録（レベル・EXP） */}
              <div className="aq-card flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--grass-pale)] text-2xl"
                >
                  🚶
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="font-bold">冒険者</span>
                    <span className="rounded-full bg-[var(--grass)] px-2 py-0.5 text-[11px] font-bold text-white">
                      Lv.{profile?.level ?? 1}
                    </span>
                  </p>
                  <p className="mt-1 flex items-baseline justify-between text-[11px] text-[var(--ink-muted)]">
                    <span>
                      EXP {profile?.expInLevel ?? 0} / {EXP_PER_LEVEL}
                    </span>
                    <span>
                      つぎまで {EXP_PER_LEVEL - (profile?.expInLevel ?? 0)}
                    </span>
                  </p>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--grass-pale)]">
                    <div
                      className="h-full rounded-full bg-[var(--grass)]"
                      style={{
                        width: `${((profile?.expInLevel ?? 0) / EXP_PER_LEVEL) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* 相棒のひとこと。相棒は右を向いているので、吹き出しの左に置く */}
              <div className="mt-4 flex items-end gap-2">
                <Companion mood="telling" size={104} />
                <Speech>
                  今日のクエストを受けようか。
                  <br />
                  カードを1枚めくったら、それが今日の冒険。
                </Speech>
              </div>
            </div>
          </section>

          <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pt-6">
            <button
              type="button"
              onClick={draw}
              disabled={busy}
              className="aq-btn !py-5 !text-lg"
            >
              {busy ? "受注中…" : "クエストを受注する"}
            </button>

            <Link href="/diary" className="aq-btn-quiet text-center">
              <span aria-hidden="true" className="mr-2">
                📓
              </span>
              日記を見る
            </Link>

            <div className="mt-2 flex gap-3">
              <div className="aq-tile flex-1">
                <p className="text-[11px] text-[var(--ink-muted)]">今日</p>
                <Amount value={today.value} unit={today.unit} />
              </div>
              <div className="aq-tile flex-1">
                <p className="text-[11px] text-[var(--ink-muted)]">累計</p>
                <Amount value={total.value} unit={total.unit} />
              </div>
              <div className="aq-tile flex-1">
                <p className="text-[11px] text-[var(--ink-muted)]">クエスト</p>
                <Amount value={String(profile?.questsDone ?? 0)} unit="件" />
              </div>
            </div>

            {profile?.nextWindow && (
              <div className="aq-card mt-1 flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-xs text-[var(--ink-muted)]">次の通知予定</p>
                  <p className="mt-0.5 text-2xl font-bold tracking-wide">
                    {profile.nextWindow.start}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--grass-pale)] px-4 py-2 text-xs font-bold text-[var(--grass)]">
                  {profile.nextWindow.label}
                </span>
              </div>
            )}

            <p className="mt-1 text-center text-xs leading-relaxed text-[var(--ink-muted)]">
              {weekend
                ? "休日は、電車やバスを使うクエストも出ます。"
                : "平日は、歩いて行けるクエストだけが出ます。"}
            </p>

            <InstallPrompt />
          </div>
        </>
      ) : moving && !departed ? (
        /* ================= 移動カード（めくる） ================= */
        <section className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pt-8">
          <header className="text-center">
            <p className="text-xs tracking-[0.2em] text-[var(--ink-muted)]">
              今日のお告げ
            </p>
            <h1 className="mt-1 text-[26px] font-bold tracking-[0.14em] text-[var(--grass)]">
              移動カード
            </h1>
          </header>

          <CardFlip
            /* カードが変わったら、部品ごと作り直す。
               key を変えないと「めくった」という中の状態が残り、
               新しいカードなのに表向きで始まってしまう（引き直しで実際に起きた） */
            key={quest.movementCard.id}
            kind="movement"
            label={quest.movementCard.label}
            ready
            flipped={movementFlipped}
            onFlipped={() =>
              setFlippedFor((old) => ({
                ...old,
                movement: quest.movementCard.id,
              }))
            }
          />

          <div className="flex items-end gap-2">
            <Companion mood="telling" size={84} />
            <Speech>
              {movementFlipped
                ? "これが今日のクエスト。着いたら、もう1枚めくろうね。"
                : "今日のお告げが届いたよ。カードをめくってみて。"}
            </Speech>
          </div>

          <div className="mt-2 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setDepartedFor(quest.id)}
              disabled={!movementFlipped}
              className="aq-btn"
            >
              出発する
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="aq-btn-quiet"
            >
              今日はやめておく
            </button>
          </div>
        </section>
      ) : onTheRoad ? (
        /* ================= 移動中 ================= */
        <section className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-6">
          {/* いまのお題。文字だけだと流れてしまうので、カードとして囲む */}
          <div className="aq-card px-5 py-4">
            <span className="inline-block rounded-full bg-[var(--grass)] px-3 py-1 text-[11px] font-bold text-white">
              今の移動カード
            </span>
            <p className="mt-3 text-xl font-bold leading-relaxed">
              {quest.movementCard.label}
            </p>
          </div>

          {/* 歩いている帯。景色が流れ、相棒はその場で跳ねる（位置情報とは無関係） */}
          <WalkScene label="移動中…">
            <Companion mood="telling" size={96} motion="hop" />
          </WalkScene>

          <div className="flex items-end gap-2">
            <Companion mood="waiting" size={72} />
            <Speech>いい天気だね。好きなペースで大丈夫。</Speech>
          </div>

          {/* 切り替えは行ごと押せるようにする。
              小さな四角だけを狙わせると、歩きながらでは押せない */}
          <button
            type="button"
            onClick={() => toggleWalking(!showWalking)}
            className="aq-card flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span className="text-sm font-bold">
              移動中の表示
              <span className="mt-0.5 block text-xs font-normal text-[var(--ink-muted)]">
                {showWalking
                  ? "位置情報を使って、通り道のスポットを探しています"
                  : "オンにすると、時間と通り道のスポットが出ます"}
              </span>
            </span>
            {/* 見た目だけのスイッチ。押すのは行全体 */}
            <span
              aria-hidden="true"
              className={[
                "relative h-8 w-14 shrink-0 rounded-full transition",
                showWalking ? "bg-[var(--grass)]" : "bg-[var(--ink)]/15",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all",
                  showWalking ? "left-7" : "left-1",
                ].join(" ")}
              />
            </span>
          </button>

          {showWalking ? (
            <WalkingInfoPanel
              startedAt={quest.createdAt}
              now={now}
              spots={walkingInfo.spots}
              pausedReason={walkingInfo.pausedReason}
              notice={walkingInfo.notice}
              searching={walkingInfo.searching}
              selectedSpotId={detour.destination?.id ?? null}
              onSelectSpot={(spot) => {
                if (detour.destination?.id === spot.id) {
                  detour.clearDestination();
                  return;
                }
                if (!walkingInfo.here) return;
                void detour.selectDestination(
                  spot,
                  walkingInfo.here.lat,
                  walkingInfo.here.lng,
                );
              }}
              routeSlot={
                detour.destination && walkingInfo.here ? (
                  <DetourRoute
                    spot={detour.destination}
                    here={walkingInfo.here}
                    routeCoordinates={detour.routeCoordinates}
                    routeDistanceM={detour.routeDistanceM}
                    routeProfile={detour.routeProfile}
                    routeStatus={detour.routeStatus}
                    routeError={detour.routeError}
                    onClose={detour.clearDestination}
                  />
                ) : null
              }
            />
          ) : (
            <p className="text-center text-xs leading-relaxed text-[var(--ink-muted)]">
              ここまでは位置情報を使っていません。
              <br />
              着いたと思ったら、自分で押してね。
            </p>
          )}

          <div className="mt-2 flex flex-col gap-3">
            <button
              type="button"
              onClick={arrive}
              disabled={busy}
              className="aq-btn"
            >
              {busy ? "準備中…" : "着いた"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="aq-btn-quiet"
            >
              クエストをやめる
            </button>
          </div>
        </section>
      ) : (
        /* ================= 行動カード ================= */
        <section className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pt-8">
          <header className="flex flex-col gap-4">
            {/* ここまでに何をしてきたのか。
                小さな文字だと読み飛ばされるので、カードにして大きく出す */}
            <div className="aq-card px-5 py-4">
              <p className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--grass)] px-3 py-1 text-[11px] font-bold text-white">
                  到着
                </span>
                <span className="aq-label">ここまでの移動カード</span>
              </p>
              <p className="mt-2 text-lg font-bold leading-relaxed">
                {quest.movementCard.label}
              </p>
            </div>

            <h1 className="text-center text-[26px] font-bold tracking-[0.14em] text-[var(--grass)]">
              行動カード
            </h1>
          </header>

          <CardFlip
            // 引き直すとカードが変わるので、部品ごと作り直す（上と同じ理由）
            key={quest.actionCard?.id ?? "not-yet"}
            kind="action"
            label={quest.actionCard?.label ?? null}
            ready={Boolean(quest.actionCard) && !busy}
            flipped={actionFlipped}
            onFlipped={() =>
              setFlippedFor((old) => ({
                ...old,
                action: quest.actionCard?.id ?? null,
              }))
            }
          />

          {actionFlipped && (
            <>
              {quest.actionCard?.involvesSpending && (
                <p className="text-center text-xs text-[var(--ink-muted)]">
                  お金を使うお題です。無理なら引き直してもいいよ。
                </p>
              )}

              {/* ここが位置情報の境目。黙って始めない */}
              {trail.notice ? (
                <p className="aq-card whitespace-pre-line px-4 py-3 text-xs leading-relaxed text-[var(--ink-muted)]">
                  {trail.notice}
                </p>
              ) : (
                <div className="aq-card flex items-center justify-between px-4 py-3">
                  <span className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full bg-[#E4573D]"
                    />
                    ここから記録が始まりました
                  </span>
                  <span className="text-base font-bold">
                    {formatDistance(trail.distanceM)}
                  </span>
                </div>
              )}

              {quest.redrawCount < MAX_REDRAW ? (
                <button
                  type="button"
                  onClick={redraw}
                  disabled={busy}
                  className="aq-btn-quiet"
                >
                  引き直す（あと {MAX_REDRAW - quest.redrawCount} 回）
                </button>
              ) : (
                <p className="text-center text-xs text-[var(--ink-muted)]">
                  引き直しは使いきりました
                </p>
              )}
            </>
          )}

          <div className="mt-2 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => finish("done", walked)}
              disabled={busy || !actionFlipped}
              className="aq-btn"
            >
              {actionFlipped ? "できた" : "カードをめくってください"}
            </button>

            <button
              type="button"
              onClick={() => finish("not_yet", walked)}
              disabled={busy || !actionFlipped}
              className="aq-btn-quiet"
            >
              今日はここまでにする
            </button>

            <p className="text-center text-xs text-[var(--ink-muted)]">
              できなくても、来たことは記録されます。
            </p>
          </div>
        </section>
      )}

      {/* 歩いている最中は下のタブを出さない（モックアップでも出ていない） */}
      {!quest && !finished && <TabBar />}
    </main>
  );
}
