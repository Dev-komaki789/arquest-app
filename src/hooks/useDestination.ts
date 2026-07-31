/**
 * ============================================================
 * useDestination — 目的地と、そこまでの道順を管理するカスタムフック
 * ============================================================
 *
 * ■ このファイルは何をするもの？
 *   「どこを目指しているか」を覚えておき、
 *   自分のアプリのAPI（/api/route）から道なりの経路を取ってくる。
 *
 * ■ 2つの距離を持っている理由
 *   直線距離 … 画面に出す「あと◯m」。通信せずその場で計算できる（geo.ts）
 *   道なりの距離 … 実際に歩く距離。経路サービスに聞かないと分からない
 *   前者は位置が動くたびに即座に更新でき、後者は通信が要る。
 *   役割が違うので両方持つ。
 *
 * ■ 経路を取り直す頻度について
 *   歩くたびに取り直すと、無料の公共サーバーを叩き続けることになる。
 *   目的地を決めたときに1回取得し、その後は線を出したままにする。
 *   （現在地マーカーは動くので、どこまで進んだかは見て分かる）
 */

"use client";

import { useCallback, useState } from "react";

import type { RouteCoordinate } from "@/lib/routing";
import type { Poi } from "@/lib/poi";

/** 経路の取得状況 */
export type RouteStatus = "idle" | "loading" | "success" | "error";

export function useDestination() {
  // 目指しているスポット。決めていなければ null
  const [destination, setDestination] = useState<Poi | null>(null);

  // 道なりの経路を構成する点の並び
  const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinate[]>(
    [],
  );

  // 道なりの距離（メートル）。まだ取得していなければ null
  const [routeDistanceM, setRouteDistanceM] = useState<number | null>(null);

  // どの経路で計算されたか。
  //   "pedestrian" … 歩行者用（本来の姿）
  //   "car"        … 歩行者用が使えず自動車用で代替した（遠回りの可能性あり）
  // 利用者に注意書きを出すかどうかの判断に使う。
  const [routeProfile, setRouteProfile] = useState<"pedestrian" | "car" | null>(
    null,
  );

  const [routeStatus, setRouteStatus] = useState<RouteStatus>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);

  /**
   * 目的地を決めて、そこまでの道順を取得する。
   *
   * @param poi 目的地にするスポット
   * @param fromLat 現在地の緯度
   * @param fromLng 現在地の経度
   */
  const selectDestination = useCallback(
    async (poi: Poi, fromLat: number, fromLng: number) => {
      // 先に目的地だけ設定する。
      // 通信の完了を待たずに地図へ目的地マーカーが出るので、
      // 「押したのに何も起きない」時間が生まれない。
      setDestination(poi);
      setRouteStatus("loading");
      setRouteError(null);
      setRouteCoordinates([]);
      setRouteDistanceM(null);
      setRouteProfile(null);

      try {
        const response = await fetch(
          `/api/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${poi.lat}&toLng=${poi.lng}`,
        );
        const json: {
          route?: {
            distanceM: number;
            coordinates: RouteCoordinate[];
            profile: "pedestrian" | "car";
          };
          error?: string;
        } = await response.json();

        if (!response.ok || !json.route) {
          throw new Error(json.error ?? "道順を取得できませんでした");
        }

        setRouteCoordinates(json.route.coordinates);
        setRouteDistanceM(json.route.distanceM);
        setRouteProfile(json.route.profile);
        setRouteStatus("success");
      } catch (err) {
        setRouteError(
          err instanceof Error ? err.message : "道順を取得できませんでした",
        );
        setRouteStatus("error");
        // ★目的地は消さない★
        // 道順が引けなくても「どこを目指しているか」は残す。
        // 直線距離と方角だけでも歩けるようにしておく
        // （仕様書の画面5は、もともと距離と方角だけを見せる設計）。
      }
    },
    [],
  );

  /** 目的地を取り消す */
  const clearDestination = useCallback(() => {
    setDestination(null);
    setRouteCoordinates([]);
    setRouteDistanceM(null);
    setRouteProfile(null);
    setRouteStatus("idle");
    setRouteError(null);
  }, []);

  return {
    destination,
    routeCoordinates,
    routeDistanceM,
    routeProfile,
    routeStatus,
    routeError,
    selectDestination,
    clearDestination,
  };
}
