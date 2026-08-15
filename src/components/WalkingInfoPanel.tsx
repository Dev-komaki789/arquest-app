/**
 * ============================================================
 * 移動中の表示（経過時間・通り道のスポット）
 * ============================================================
 *
 * ■ 出るのは設定をオンにしたときだけ（仕様書§2.4）
 *   オフのときは、この部品ごと出ない。
 *   「使わないことを選べる」がこのアプリの主張なので、
 *   オフの人の画面に、オンを勧める文言も置かない（切り替えは設定の行だけ）。
 *
 * ■ スポットは「寄り道先」であって行き先ではない
 *   移動カードは座標を持たないので、クエストの行き先は存在しない。
 *   一覧の見出しに毎回そう書いておく。書かないと、
 *   「ここを目指せばいい」と誤解されて、遊びの根っこが崩れる。
 */

"use client";

import type { Poi } from "@/lib/poi";
import { POI_CATEGORY_INFO } from "@/lib/poi";

/** 経過時間を「14分」「1時間5分」の形にする */
function formatElapsed(fromIso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

export function WalkingInfoPanel({
  startedAt,
  now,
  spots,
  pausedReason,
  notice,
  searching,
  onSelectSpot,
  selectedSpotId,
  routeSlot,
}: {
  startedAt: string;
  now: number;
  spots: Poi[];
  pausedReason: string | null;
  notice: string | null;
  searching: boolean;
  /** スポットを押したとき（道順を出す） */
  onSelectSpot: (spot: Poi) => void;
  selectedSpotId: string | null;
  /** 選んだスポットの下に差し込む地図。選んでいなければ null */
  routeSlot: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
          <p className="text-xs text-white/60">けいか時間</p>
          <p className="mt-1 text-2xl font-bold">{formatElapsed(startedAt, now)}</p>
        </div>
        <div className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3">
          <p className="text-xs text-white/60">記録</p>
          <p className="mt-1 text-sm leading-tight text-white/80">
            まだ
            <br />
            始まっていません
          </p>
        </div>
      </div>

      {notice && (
        <p className="whitespace-pre-line rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs leading-relaxed text-white/70">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-white/15 bg-white/5 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-bold">通り道のスポット</p>
          <p className="text-xs text-white/50">
            {searching ? "さがしています…" : `${spots.length}件`}
          </p>
        </div>
        <p className="mt-1 text-xs text-white/50">
          クエストとは 無関係です。寄り道したいときだけ どうぞ。
        </p>

        {/* 探していない理由は必ず出す。
            黙って止まっていると、壊れているのか分からない */}
        {pausedReason && (
          <p className="mt-3 text-xs text-[var(--gold)]">{pausedReason}</p>
        )}

        {spots.length === 0 ? (
          <p className="mt-3 text-xs text-white/50">
            {pausedReason
              ? ""
              : "歩いていると、少しずつ たまっていきます（300mごと）。"}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {spots.slice(0, 5).map((spot) => (
              <li key={spot.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onSelectSpot(spot)}
                  className={[
                    "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition",
                    selectedSpotId === spot.id
                      ? "bg-white/15"
                      : "bg-white/5 active:bg-white/10",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: POI_CATEGORY_INFO[spot.category].color,
                      }}
                    />
                    <span className="truncate text-sm">{spot.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-white/60">
                    約{Math.round(spot.distanceM)}m
                    <span className="text-[var(--gold)]">道順</span>
                  </span>
                </button>

                {selectedSpotId === spot.id && routeSlot}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
