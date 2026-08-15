/**
 * ============================================================
 * 行動カードを引いたあとの、軌跡と距離の記録
 * ============================================================
 *
 * ■ いつ動くのか（仕様書§2.7）
 *   クエストが `acting`（行動カードを引いた後）の間だけ。
 *   移動カードで歩いている間は**動かさない。**
 *   行き先の正解が存在しないので追う対象が無いし、
 *   「使わないことを選べる」がこのアプリの主張だから。
 *
 * ■ 位置情報が使えなくても止まらない
 *   許可されなくても、クエストは最後まで進む（仕様書§5）。
 *   そのときは距離が0のまま記録されるだけで、遊びは成立する。
 *
 * ■ 点はデータベースにも送る（仕様書§2.6）
 *   歩いている最中にアプリが閉じられても軌跡が消えないよう、
 *   採用した点をその都度 quest_trajectories に足していく。
 *   間引き済みなので10mに1点程度、2km歩いて200点ほど。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useGeolocation, type GeoPosition } from "@/hooks/useGeolocation";
import { useWalkTrail } from "@/hooks/useWalkTrail";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { Quest } from "@/lib/quest";

export type QuestTrail = {
  /** 行動カードを引いてから歩いた距離（メートル） */
  distanceM: number;
  /** 最後に分かった位置。クエストを終えるときに完了地点として送る */
  lastPosition: { lat: number; lng: number } | null;
  /** 位置情報が使えないときの説明。使えているなら null */
  notice: string | null;
  /** いま記録しているか */
  recording: boolean;
};

export function useQuestTrail(quest: Quest | null): QuestTrail {
  const acting = quest?.status === "acting";
  const questId = quest?.id ?? null;

  const { trail, totalDistanceM, record, reset } = useWalkTrail();
  const [lastPosition, setLastPosition] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  // 位置がひとつ届くたびに呼ばれる。
  // useWalkTrail が「精度が悪い点・動いていない点」を捨ててくれるので、
  // ここでは受け取ってそのまま渡すだけでよい。
  const onPosition = useCallback(
    (position: GeoPosition) => {
      record(position);
      setLastPosition({ lat: position.lat, lng: position.lng });
    },
    [record],
  );

  const { status, error, start, stop } = useGeolocation({ onPosition });

  // 行動中になったら記録を始め、終わったら止める。
  //
  // 「ついた」ボタンを押した直後に始まるので、
  // 位置情報の許可を求める画面が、利用者の操作の直後に出る
  // （操作と無関係に出すと、端末によっては表示されない）。
  useEffect(() => {
    if (!acting) return;

    reset();
    start();

    return () => {
      stop();
    };
  }, [acting, reset, start, stop]);

  // 採用された点だけをデータベースに送る。
  //
  // 送信済みの数を覚えておき、増えたぶんだけ送る。
  // 失敗しても画面は止めない（距離の表示は手元の値で続く）。
  const sentCountRef = useRef(0);

  useEffect(() => {
    if (!questId || !acting) {
      sentCountRef.current = 0;
      return;
    }

    const fresh = trail.slice(sentCountRef.current);
    if (fresh.length === 0) return;

    sentCountRef.current = trail.length;

    const rows = fresh.map((point) => ({
      quest_id: questId,
      lat: point.lat,
      lng: point.lng,
    }));

    void getBrowserSupabase()
      .from("quest_trajectories")
      .insert(rows)
      .then(({ error: insertError }) => {
        if (insertError) {
          // 送れなかったぶんは、次に届いた点と一緒に送り直す
          sentCountRef.current -= fresh.length;
          console.error("軌跡を保存できませんでした:", insertError.message);
        }
      });
  }, [trail, questId, acting]);

  /**
   * 位置情報が使えないときの案内。
   *
   * 理由の文章は useGeolocation が用意している。
   * 許可されていない場合はOS（Windows / Mac / iPhone / Android）ごとに
   * 案内先を変えてくれるので、ここでは組み立て直さない。
   *
   * 足すのは「それでもクエストは続けられる」という一言だけ。
   * 位置情報が無くても遊びは成立する（仕様書§5）ので、
   * 行き止まりに見えないようにする。
   */
  const notice =
    acting && status === "error" && error
      ? `${error}\nクエストはこのまま続けられます（歩いた距離だけ記録されません）。`
      : null;

  return {
    distanceM: totalDistanceM,
    lastPosition,
    notice,
    recording: acting && status === "tracking",
  };
}
