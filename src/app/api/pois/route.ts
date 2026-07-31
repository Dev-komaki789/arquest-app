/**
 * ============================================================
 * /api/pois — 周辺スポットを返すAPI（Route Handler）
 * ============================================================
 *
 * ■ Route Handler とは
 *   Next.js で「サーバー側で動く処理」を作る仕組み。
 *   src/app/api/pois/route.ts に置くと、
 *   http://localhost:3000/api/pois というURLでアクセスできるようになる。
 *   （画面用の page.tsx と同じで、置いた場所がそのままURLになる）
 *
 * ■ なぜブラウザから直接Overpassを呼ばないのか（仕様書§5の決定）
 *   1. CORS … ブラウザには「別のドメインへ勝手に通信させない」制限がある。
 *              サーバー側から呼べばこの制限を受けない。
 *   2. 負荷 … 利用者の数だけ無料の公共サーバーを叩くことになる。
 *              サーバー側でまとめて呼べば、結果を使い回せる。
 *   3. キャッシュ … 同じ場所の検索結果を保存して再利用できる。
 *
 * ■ 使い方
 *   /api/pois?lat=34.7186&lng=135.4173&radius=800
 *
 * ■ 注意（Next.js 16）
 *   Route Handler の GET は既定でキャッシュされない。
 *   そのため、キャッシュはこのファイルの中で自前で持っている。
 */

import { NextRequest } from "next/server";

import { fetchNearbyPois } from "@/lib/overpass";
import type { Poi } from "@/lib/poi";

/**
 * 検索半径の下限・上限（メートル）。
 * 仕様書§6の user_settings.search_radius_m は既定800m。
 * 利用者が設定を変えられる想定なので幅を持たせつつ、
 * 極端な値でOverpassに負荷をかけないよう上限を設ける。
 */
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 2000;
const DEFAULT_RADIUS_M = 800;

/**
 * キャッシュを保持する時間（ミリ秒）。
 * 公園やコンビニは頻繁に増減しないので、10分は十分に短い。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 検索結果の一時保存場所。
 *
 * ■ Map とは
 *   「キー → 値」で物を出し入れできる、JavaScriptの標準の入れ物。
 *
 * ■ これは仮の作り
 *   サーバーのメモリ上に置いているだけなので、
 *   サーバーを再起動すると消えるし、複数台に増やすと共有されない。
 *   仕様書§6では pois テーブル（Supabase）に保存する設計になっており、
 *   これはそこへ進む前の踏み台。
 *   ただし「毎回Overpassを叩かない」という目的はこれでも果たせる。
 */
const cache = new Map<string, { expiresAt: number; pois: Poi[] }>();

/**
 * キャッシュのキーを作る。
 *
 * 座標を小数3桁（約100m）に丸めているのがポイント。
 * GPSは1〜2秒ごとに数メートル揺れるため、
 * 丸めないと「ほぼ同じ場所」でもキーが毎回変わり、
 * キャッシュがまったく効かない。
 */
function makeCacheKey(lat: number, lng: number, radiusM: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`;
}

/**
 * 文字列を数値に変換する。数値にならなければ null。
 *
 * URLで渡ってくる値はすべて文字列なので、必ず変換と確認が要る。
 * Number("abc") は NaN（数値ではない）になるため、それも弾く。
 */
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * GET リクエストを処理する関数。
 * 関数名を GET にするのが Next.js の決まり。
 */
export async function GET(request: NextRequest) {
  // URLの「?」以降の値を取り出す
  const params = request.nextUrl.searchParams;
  const lat = toNumber(params.get("lat"));
  const lng = toNumber(params.get("lng"));
  const radiusRaw = toNumber(params.get("radius")) ?? DEFAULT_RADIUS_M;

  // --- 入力の検証 ---
  // 外から渡される値は信用しない、というのがサーバー処理の基本。
  // 緯度は -90〜90、経度は -180〜180 の範囲でなければ地球上の座標ではない。
  if (lat === null || lng === null) {
    return Response.json(
      { error: "lat と lng は必須です" },
      { status: 400 }, // 400 = リクエストが不正
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return Response.json({ error: "座標の範囲が不正です" }, { status: 400 });
  }

  // 範囲外の半径は、エラーにせず上限・下限に丸める。
  // Math.min/max を組み合わせると「◯以上◯以下に収める」が書ける。
  const radiusM = Math.min(Math.max(radiusRaw, MIN_RADIUS_M), MAX_RADIUS_M);

  // --- キャッシュを確認する ---
  const key = makeCacheKey(lat, lng, radiusM);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // cached: true を付けて返すと、
    // 画面側で「今のはキャッシュだった」と分かる（動作確認に便利）
    return Response.json({ pois: cached.pois, cached: true });
  }

  // --- Overpassに問い合わせる ---
  try {
    const pois = await fetchNearbyPois(lat, lng, radiusM);

    // 次回のために保存する
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, pois });

    return Response.json({ pois, cached: false });
  } catch (error) {
    // サーバー側のログには詳細を残す（開発中の原因調査用）
    console.error("Overpassの取得に失敗:", error);

    // 回数制限だけは、利用者への言い方を変える。
    // 「混雑」と言われると何度も押し直してしまい、事態が悪化するため。
    const isRateLimited = String(error).includes("429");

    // 画面側には、原因の詳細ではなく対処できる言葉で返す。
    // 429 = 回数制限、502 = 外部のサーバーから正しい応答が得られなかった
    return Response.json(
      {
        error: isRateLimited
          ? "検索の回数制限にかかりました。地図データの提供元は無料の公共サーバーのため、短時間に何度も検索できません。1〜2分ほど待ってからお試しください。"
          : "スポットの検索に失敗しました。地図データの提供元が混雑している可能性があります。少し待ってからお試しください。",
      },
      { status: isRateLimited ? 429 : 502 },
    );
  }
}
