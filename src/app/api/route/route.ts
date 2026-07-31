/**
 * ============================================================
 * /api/route — 目的地までの道順を返すAPI（Route Handler）
 * ============================================================
 *
 * ■ 使い方
 *   /api/route?fromLat=34.7186&fromLng=135.4173&toLat=34.7182&toLng=135.4045
 *
 * ■ なぜブラウザから直接OSRMを呼ばないのか
 *   /api/pois と同じ理由。
 *   ・CORS（別ドメインへの通信制限）を避けられる
 *   ・無料の公共サーバーへの通信をこちら側でまとめて管理できる
 *   ・結果をキャッシュして再利用できる
 *
 * ■ ファイル名について
 *   フォルダ名が route、ファイル名も route.ts で紛らわしいが、
 *   「route.ts」というファイル名はNext.jsの決まりで変えられない。
 *   フォルダ名（api/route）がURLになり、ファイル名がAPIであることを表す。
 */

import { NextRequest } from "next/server";

import { fetchWalkingRoute, type WalkingRoute } from "@/lib/routing";

/**
 * キャッシュを保持する時間（ミリ秒）。
 * 道路は数分で変わらないので5分。
 * 追従中に何度も同じ経路を計算し直さないためのもの。
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** 計算結果の一時保存場所（サーバーのメモリ上。再起動で消える） */
const cache = new Map<string, { expiresAt: number; route: WalkingRoute }>();

/**
 * キャッシュのキー。
 *
 * 出発地だけ小数3桁（約100m）に丸めているのが要点。
 * 歩いている間、現在地は1〜2秒ごとに数メートル動く。
 * 丸めないと毎回キーが変わり、キャッシュが効かないうえに
 * OSRMを叩き続けることになる。
 * 目的地は動かないので、そのままの精度で使う。
 */
function makeCacheKey(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): string {
  return `${fromLat.toFixed(3)},${fromLng.toFixed(3)}→${toLat},${toLng}`;
}

/** 文字列を数値に変換する。数値にならなければ null */
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** 緯度経度として成り立つ範囲かどうか */
function isValidCoord(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fromLat = toNumber(params.get("fromLat"));
  const fromLng = toNumber(params.get("fromLng"));
  const toLat = toNumber(params.get("toLat"));
  const toLng = toNumber(params.get("toLng"));

  // --- 入力の検証 ---
  // 4つのうち1つでも欠けたら計算できない
  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    return Response.json(
      { error: "fromLat, fromLng, toLat, toLng がすべて必要です" },
      { status: 400 },
    );
  }
  if (!isValidCoord(fromLat, fromLng) || !isValidCoord(toLat, toLng)) {
    return Response.json({ error: "座標の範囲が不正です" }, { status: 400 });
  }

  // --- キャッシュを確認する ---
  const key = makeCacheKey(fromLat, fromLng, toLat, toLng);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ route: cached.route, cached: true });
  }

  // --- OSRMに問い合わせる ---
  try {
    const route = await fetchWalkingRoute(fromLat, fromLng, toLat, toLng);
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, route });
    return Response.json({ route, cached: false });
  } catch (error) {
    console.error("OSRMの取得に失敗:", error);
    return Response.json(
      {
        error:
          "道順を取得できませんでした。目的地までの道が見つからないか、経路サービスが混雑しています。",
      },
      { status: 502 },
    );
  }
}
