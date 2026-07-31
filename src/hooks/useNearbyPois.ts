/**
 * ============================================================
 * useNearbyPois — 周辺のスポットを取ってくるカスタムフック
 * ============================================================
 *
 * ■ このファイルは何をするもの？
 *   自分のアプリのAPI（/api/pois）に問い合わせて、
 *   周辺の実在スポットの一覧を受け取る。
 *
 * ■ 通信の流れ
 *   画面 → /api/pois（自分のサーバー）→ Overpass API（OpenStreetMap）
 *   ブラウザから直接Overpassを呼ばない理由は
 *   src/app/api/pois/route.ts の先頭に書いてある。
 *
 * ■ なぜ自動ではなくボタンで実行するのか
 *   Overpassは無料の公共サーバーで、回数制限がある。
 *   位置が更新されるたびに自動で検索すると、
 *   歩いている間に何十回も叩くことになり、すぐ制限にかかる
 *   （実際、開発中に叩きすぎて429を返された）。
 *   利用者が「探す」と決めたときだけ動かす。
 */

"use client";

import { useCallback, useState } from "react";

import type { Poi } from "@/lib/poi";

/**
 * 検索の状態。
 *   idle    … まだ検索していない
 *   loading … 検索中
 *   success … 取得できた
 *   error   … 失敗した
 */
export type PoiSearchStatus = "idle" | "loading" | "success" | "error";

export function useNearbyPois() {
  const [pois, setPois] = useState<Poi[]>([]);
  const [status, setStatus] = useState<PoiSearchStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // サーバー側のキャッシュから返ってきたかどうか。
  // 動作確認用の表示に使う（同じ場所を二度検索したときに true になる）。
  const [fromCache, setFromCache] = useState(false);

  /**
   * 検索を実行する。
   *
   * `async` が付いた関数は「途中で待つ処理がある」という意味。
   * 通信は結果が返るまで時間がかかるので、`await` で待つ。
   */
  const search = useCallback(
    async (lat: number, lng: number, radiusM: number) => {
      setStatus("loading");
      setError(null);

      try {
        // URLに条件を付けて自分のAPIを呼ぶ
        const response = await fetch(
          `/api/pois?lat=${lat}&lng=${lng}&radius=${radiusM}`,
        );

        // 応答の中身（JSON）を取り出す。
        // 失敗時も error というメッセージが入って返ってくる作りにしてある。
        const json: { pois?: Poi[]; cached?: boolean; error?: string } =
          await response.json();

        // response.ok は「HTTPの状態が200番台か」。
        // 通信自体は成功していても、内容がエラーということがあるので確認する。
        if (!response.ok) {
          throw new Error(json.error ?? "スポットの検索に失敗しました");
        }

        setPois(json.pois ?? []);
        setFromCache(json.cached ?? false);
        setStatus("success");
      } catch (err) {
        // 通信そのものが失敗した場合（オフラインなど）もここに来る
        setError(
          err instanceof Error ? err.message : "スポットの検索に失敗しました",
        );
        setStatus("error");
      }
    },
    [],
  );

  /** 検索結果を消す（地図のピンを片付ける） */
  const clear = useCallback(() => {
    setPois([]);
    setStatus("idle");
    setError(null);
  }, []);

  return { pois, status, error, fromCache, search, clear };
}
