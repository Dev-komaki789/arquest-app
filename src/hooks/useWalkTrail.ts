/**
 * ============================================================
 * useWalkTrail — 歩いた軌跡と移動距離を記録するカスタムフック
 * ============================================================
 *
 * ■ このファイルは何をするもの？
 *   届いた位置を `record()` に渡すと、「本当に歩いた分」だけを選んで、
 *   軌跡（点の並び）と累計距離にまとめる。
 *
 * ■ なぜ「選ぶ」必要があるのか（このファイルの存在理由）
 *   watchPosition は、静止していても1〜2秒ごとに位置を知らせてくる。
 *   しかもGPSには常に誤差があるため、机に置いたままでも
 *   座標は数メートル単位で揺れ続ける。
 *
 *   届いた位置をすべて足し合わせると、
 *   「座っているだけなのに移動距離が増え続ける」ことになる。
 *   歩数計アプリの距離が実際より多く出る、よくある原因がこれ。
 *
 *   そこで2種類の点を捨てる（この処理を「間引き」と呼ぶ）。
 *     ① 精度が悪すぎる点      … ±100mの点で距離を足しても、それは嘘の距離
 *     ② ほとんど動いていない点 … 静止中の誤差の揺れ
 *
 * ■ なぜ useEffect を使わないのか（設計上の注意点）
 *   最初は「position が変わったら useEffect で記録する」と書いたが、
 *   ESLint に止められた。useEffect の中で state を更新すると、
 *   「描画 → 効果 → state更新 → また描画」という連鎖が起きて無駄が出るため。
 *
 *   位置が届くのは「ブラウザが知らせてくれた瞬間」という出来事なので、
 *   その通知を受け取ったその場で記録するのが正しい。
 *   そこで record() という関数を外に渡し、
 *   useGeolocation が位置を受け取った瞬間に呼んでもらう作りにした。
 *
 * ■ 設計の分担
 *   useGeolocation … ブラウザから位置を受け取る（生のデータ）
 *   useWalkTrail    … 受け取った位置を判断して記録する（このファイル）
 *   混ぜないことで、間引きの条件を変えたいときにここだけ直せばよくなる。
 */

"use client";

import { useCallback, useRef, useState } from "react";

// 距離の計算は lib に置いた純粋な関数を使う
import { distanceInMeters } from "@/lib/geo";

// useGeolocation が返す位置の型をそのまま借りる。
// `import type` は「型としてだけ使う」という指定で、
// 実際のコードは読み込まれないため無駄が無い。
import type { GeoPosition } from "@/hooks/useGeolocation";

/** 軌跡を構成する1点。時刻や精度は軌跡には不要なので緯度経度だけ持つ */
export type TrailPoint = { lat: number; lng: number };

/**
 * 開発中かどうか。
 *
 * `npm run dev` で動かしているときは "development"、
 * `npm run build` した本番用のコードでは "production" になる。
 * Next.jsが自動で入れてくれる値なので、こちらで設定する必要はない。
 */
const IS_DEV = process.env.NODE_ENV === "development";

/**
 * これより精度が悪い点は捨てる（メートル）。
 *
 * ■ 本番で50mにした理由
 *   仕様書の到達判定は半径100m。誤差がその半分を超える点を信じて
 *   距離を足すと、記録が実態から離れすぎる。
 *   実機のGPSは屋外なら±5〜20m程度に収まるので、50mは十分に緩い基準。
 *
 * ■ なぜ開発中だけ緩めるのか
 *   ブラウザの開発ツールで位置を偽装すると、精度が粗い固定値
 *   （±100〜150mなど）で返ってくることがある。
 *   本番と同じ50mのままだと、テスト用の位置がすべて捨てられて
 *   軌跡も距離も出ず、動作確認ができない。
 *
 *   かといって本番の基準を緩めるのは本末転倒。
 *   「精度が悪い点を捨てる」のは記録の正しさを守るための仕組みなので、
 *   実機の品質を落としてまでテストの都合に合わせるべきではない。
 *   そこで、開発中だけ実質的に無効にしている。
 *
 *   ※この値は画面にも表示される。開発中に「±1000m」と出ていたら、
 *     それは本番の基準ではないという目印になる。
 */
// `export` を付けて画面側からも読めるようにしている。
// 画面の説明文に数字を直接書くと、ここを変えたときに説明とズレるため。
export const MAX_ACCEPTABLE_ACCURACY_M = IS_DEV ? 1000 : 50;

/**
 * 前回の記録点からこれ未満しか動いていない点は捨てる（メートル）。
 *
 * 10mにした理由:
 *   GPSの誤差による揺れは数メートル。それを歩行と誤認しないため。
 *   一方で、歩行速度（秒速1.2mほど）なら10mは10秒足らずで進む距離なので、
 *   本当に歩いていれば記録が途切れることはない。
 */
export const MIN_MOVE_M = 10;

/**
 * 本体。画面側では次のように使う。
 *
 *   const { trail, totalDistanceM, ignoredCount, reset, record } = useWalkTrail();
 *   const { position } = useGeolocation({ onPosition: record });
 */
export function useWalkTrail() {
  // 歩いた軌跡。採用した点だけが順番に溜まっていく
  const [trail, setTrail] = useState<TrailPoint[]>([]);

  // 累計移動距離（メートル）
  const [totalDistanceM, setTotalDistanceM] = useState(0);

  // 間引きで捨てた点の数。
  // 画面に出しておくと「今どれくらい無視されているか」が分かり、
  // 基準値（50m / 10m）が適切かを判断する材料になる。
  const [ignoredCount, setIgnoredCount] = useState(0);

  // 最後に「採用した」点。次の点との距離を測る基準になる。
  // 画面に出す値ではないので useState ではなく useRef を使う
  // （useState にすると値を変えるたびに画面が描き直されて無駄）。
  const lastAcceptedRef = useRef<TrailPoint | null>(null);

  // 最後に処理した位置の時刻。同じ位置を二重に数えないための目印。
  const lastHandledTimeRef = useRef<number | null>(null);

  // ------------------------------------------------------------
  // 位置がひとつ届いたときの処理（採用するか、捨てるか）
  // ------------------------------------------------------------
  // useCallback の条件が [] なので、この関数は作り直されない。
  // useGeolocation に渡しても、渡すたびに中身が変わらず安定する。
  const record = useCallback((position: GeoPosition) => {
    // --- 二重処理を防ぐ ---
    // 同じ位置に対して2回呼ばれても距離が二重に足されないようにする。
    // 位置には取得時刻が付いているので、それを目印に使う。
    if (lastHandledTimeRef.current === position.timestamp) return;
    lastHandledTimeRef.current = position.timestamp;

    // --- 間引き① 精度が悪すぎる点は捨てる ---
    if (position.accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
      // setIgnoredCount(前の値 => 新しい値) の書き方をしているのは、
      // 「今の値」を確実に元にして計算するため。
      // ignoredCount + 1 と書くと、短時間に連続した更新で数え落としが起きうる。
      setIgnoredCount((count) => count + 1);
      return;
    }

    const current: TrailPoint = { lat: position.lat, lng: position.lng };
    const last = lastAcceptedRef.current;

    // --- 最初の1点目は、比べる相手がいないので無条件で採用する ---
    if (!last) {
      lastAcceptedRef.current = current;
      setTrail([current]);
      return; // 1点目なので距離は増えない
    }

    // --- 間引き② ほとんど動いていない点は捨てる ---
    const moved = distanceInMeters(last.lat, last.lng, current.lat, current.lng);
    if (moved < MIN_MOVE_M) {
      setIgnoredCount((count) => count + 1);
      return;
    }

    // --- ここまで残った点だけを「本当に歩いた」として記録する ---
    lastAcceptedRef.current = current;
    // [...prev, current] は「今までの配列の中身をすべて並べて、最後に current を足す」。
    // prev.push(current) と書いてはいけない。
    // 元の配列を直接書き換えると、Reactが変化に気づけず画面が更新されない。
    setTrail((prev) => [...prev, current]);
    setTotalDistanceM((prev) => prev + moved);
  }, []);

  // ------------------------------------------------------------
  // 記録をやり直す
  // ------------------------------------------------------------
  // 動作確認のたびに画面を再読み込みしなくて済むように用意する。
  // 実際のアプリでは「ミッション開始時にリセットする」使い方になる。
  const reset = useCallback(() => {
    setTrail([]);
    setTotalDistanceM(0);
    setIgnoredCount(0);
    lastAcceptedRef.current = null;
    lastHandledTimeRef.current = null;
  }, []);

  return { trail, totalDistanceM, ignoredCount, record, reset };
}
