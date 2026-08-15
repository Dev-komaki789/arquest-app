/**
 * ============================================================
 * 寄り道さきへの道順（地図つき）
 * ============================================================
 *
 * ■ これはクエストの行き先ではない（仕様書§2.4④）
 *   移動カードは座標を持たないので、クエストの行き先は存在せず、
 *   そこへの道順は**原理的に出せない。**
 *   ここに出るのは「通りすがりに気になった店」への寄り道の道順で、
 *   クエストとは無関係。見出しにも毎回そう書く。
 *
 *   ここを曖昧にすると「地図の線をたどればいい」という遊びになり、
 *   行き先を教えないから寄り道が生まれる、という根っこが崩れる。
 *
 * ■ 地図は押されてから読み込む
 *   地図の部品（MapLibre）はそれなりに重い。
 *   スポットを押した人にだけ必要なので、押された時点で初めて読み込む。
 *   `ssr: false` は「サーバー側では描かない」という指定で、
 *   地図はブラウザの画面（DOM）を直接触るため、サーバーでは動かせない。
 */

"use client";

import dynamic from "next/dynamic";

import type { Poi } from "@/lib/poi";
import type { RouteCoordinate } from "@/lib/routing";

const CurrentLocationMap = dynamic(
  () => import("@/components/CurrentLocationMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm text-white/50">
        地図を よみこんでいます…
      </div>
    ),
  },
);

export function DetourRoute({
  spot,
  here,
  routeCoordinates,
  routeDistanceM,
  routeProfile,
  routeStatus,
  routeError,
  onClose,
}: {
  spot: Poi;
  here: { lat: number; lng: number; accuracy: number };
  routeCoordinates: RouteCoordinate[];
  routeDistanceM: number | null;
  routeProfile: "pedestrian" | "car" | null;
  routeStatus: string;
  routeError: string | null;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/15 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{spot.name}</p>
          <p className="text-xs text-white/50">
            寄り道さきへの道順。クエストとは 無関係です
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs text-white/60 underline"
        >
          とじる
        </button>
      </div>

      <CurrentLocationMap
        lat={here.lat}
        lng={here.lng}
        accuracy={here.accuracy}
        trail={[]}
        pois={[spot]}
        destination={spot}
        routeCoordinates={routeCoordinates}
        // 地図の中のスポットを押しても、いまと同じ場所なので何もしない
        onSelectDestination={() => {}}
      />

      <p className="text-xs text-white/60">
        {routeStatus === "loading" && "道順を しらべています…"}
        {routeError && `道順を出せませんでした（${routeError}）`}
        {routeDistanceM !== null && (
          <>
            道なりで 約{Math.round(routeDistanceM)}m
            {/* 徒歩の経路が取れず自動車で代替したときは、そう伝える。
                黙って車の道順を見せると、歩けない道を案内してしまう */}
            {routeProfile === "car" && "（徒歩の道順が取れず、車の道順です）"}
          </>
        )}
      </p>
    </div>
  );
}
