/**
 * ============================================================
 * 移動中の表示（経過時間・歩いた距離・通り道のスポット）
 * ============================================================
 *
 * ■ これは任意の機能（仕様書§2.4）
 *   設定でオンにしたときだけ動く。既定はオフ。
 *   オンのあいだは**移動中も位置情報が動く**が、
 *   **軌跡としては記録しない。**位置はスポットを探すのに使い、その場で捨てる。
 *   記録が始まるのは、これまでどおり行動カードを引いた後から（§2.7）。
 *
 * ■ 通り道のスポットは、クエストの行き先ではない
 *   移動カードは座標を持たないので、行き先は存在しない。
 *   ここに出るのは「ついでに寄れるかもしれない場所」であって、
 *   目指す場所ではない。画面にもそう書く。
 *
 * ■ いつ問い合わせるか（3つとも満たしたときだけ）
 *   1. 前回の地点から **300m以上** 離れた
 *        … 更新すべきかを決めるのは距離。立ち止まっている間は問い合わせない
 *   2. **時速10km未満**
 *        … 電車・バス・自転車のときは休む。走っている乗り物から寄り道はできないので、
 *          探しても意味がない。距離だけを条件にすると、時速60kmでは
 *          300mを18秒で通過してしまい、問い合わせが連射になる
 *   3. 前回の問い合わせから **60秒以上**
 *        … 保険。トンネルやビルの谷間でGPSが飛ぶと速さの計算が乱れるので、
 *          最低の間隔だけ決めておく
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useGeolocation, type GeoPosition } from "@/hooks/useGeolocation";
import { useNearbyPois } from "@/hooks/useNearbyPois";
import { distanceInMeters } from "@/lib/geo";
import type { Poi } from "@/lib/poi";

/** 次に問い合わせるまでに離れる距離（メートル） */
const SEARCH_EVERY_M = 300;

/** 探す範囲（メートル）。狭いほど結果が上限で切られず、キャッシュが効く */
const SEARCH_RADIUS_M = 300;

/** これより速ければ乗り物とみなす（メートル毎秒。2.8 ≒ 時速10km） */
const VEHICLE_SPEED_MPS = 2.8;

/** 問い合わせの最低間隔（ミリ秒） */
const MIN_INTERVAL_MS = 60_000;

export type WalkingInfo = {
  /** 通り道のスポット（近い順） */
  spots: Poi[];
  /** いまの位置。道順を出すときの出発地に使う */
  here: { lat: number; lng: number; accuracy: number } | null;
  /** 探していないときの理由。探しているなら null */
  pausedReason: string | null;
  /** 位置情報が使えないときの案内 */
  notice: string | null;
  searching: boolean;
};

export function useWalkingInfo(enabled: boolean): WalkingInfo {
  const { pois, status: searchStatus, search } = useNearbyPois();
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [here, setHere] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);

  // 前回どこで問い合わせたか、いつ問い合わせたか
  const lastSearchRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // 速さを出すための、前回の位置と時刻
  const lastPointRef = useRef<{ lat: number; lng: number; at: number } | null>(null);

  const onPosition = useCallback(
    (position: GeoPosition) => {
      const now = position.timestamp;
      setHere({
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
      });
      const previous = lastPointRef.current;
      lastPointRef.current = { lat: position.lat, lng: position.lng, at: now };

      // --- 乗り物に乗っていないか ---
      if (previous) {
        const seconds = (now - previous.at) / 1000;
        const moved = distanceInMeters(
          previous.lat,
          previous.lng,
          position.lat,
          position.lng,
        );
        // 時間が進んでいないときは計算できないので、判定を飛ばす
        if (seconds > 1 && moved / seconds > VEHICLE_SPEED_MPS) {
          setPausedReason("のりもの で移動中みたいなので、お休みしています");
          return;
        }
      }

      const last = lastSearchRef.current;

      // --- まだ十分に離れていないなら、何もしない ---
      if (last) {
        const moved = distanceInMeters(last.lat, last.lng, position.lat, position.lng);
        if (moved < SEARCH_EVERY_M) {
          setPausedReason(null);
          return;
        }
        // --- 離れていても、前回から間もないなら待つ ---
        if (now - last.at < MIN_INTERVAL_MS) {
          setPausedReason(null);
          return;
        }
      }

      lastSearchRef.current = { lat: position.lat, lng: position.lng, at: now };
      setPausedReason(null);
      void search(position.lat, position.lng, SEARCH_RADIUS_M);
    },
    [search],
  );

  const { status, error, start, stop } = useGeolocation({ onPosition });

  // 設定がオンの間だけ位置を追う。オフにしたら必ず止める
  useEffect(() => {
    if (!enabled) return;

    start();
    return () => {
      stop();
      lastSearchRef.current = null;
      lastPointRef.current = null;
      setHere(null);
    };
  }, [enabled, start, stop]);

  const notice =
    enabled && status === "error" && error
      ? `${error}\n通り道のスポットだけ お休みします（クエストは そのまま続けられます）。`
      : null;

  return {
    spots: pois,
    here,
    pausedReason,
    notice,
    searching: searchStatus === "loading",
  };
}
