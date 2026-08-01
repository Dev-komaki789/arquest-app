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
 * ============================================================
 * ■ キャッシュの仕組み（仕様書§8の④）
 * ============================================================
 *
 * 以前はサーバーのメモリ上に10分だけ置いていたが、
 * 再起動で消える・複数台に増やすと共有されない、という踏み台の作りだった。
 * 現在はSupabaseの pois テーブルに永続化している。
 *
 *   ①この範囲は最近調べたか？   → poi_searches を見る
 *   ②調べてあれば             → pois から取り出して返す（Overpassに行かない）
 *   ③調べていなければ         → Overpassに問い合わせ、結果を保存してから返す
 *
 * ★なぜ「調べた範囲」を別に記録するのか★
 *
 *   「pois に1件でもあればキャッシュ命中」という作りにすると、静かに壊れる。
 *
 *     1回目 尼崎駅で検索  → 30件を保存
 *     2回目 800m東で検索  → 重なった部分の3件だけがヒット
 *                          → 「キャッシュにある」と誤判定してOverpassに行かない
 *                          → 東側の20件が永久に出てこない
 *
 *   エラーは出ず、画面には3件だけ並ぶ。利用者には
 *   「この辺にはスポットが3つしかない」と見える。
 *   しかも pois にデータが溜まるほど悪化する（どこで検索しても数件はヒットするため）。
 *
 *   原因は、pois が「スポットの位置」しか知らず
 *   「どの範囲を調べ終わったか」を知らないこと。
 *   そこで poi_searches に中心と半径を記録し、
 *   「今回の円が過去の円に完全に収まるか」で判定している。
 *
 * ■ Supabaseが使えないときは、Overpassに直接聞く
 *   データベースが落ちていても地図が動くようにしている。
 *   キャッシュは速度と負荷対策のためのもので、
 *   これが無いと機能しない、という作りにはしない。
 */

import { NextRequest } from "next/server";

import { fetchNearbyPois } from "@/lib/overpass";
import type { Poi, PoiCategory } from "@/lib/poi";
import { getSupabase } from "@/lib/supabase";

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
 * 一度調べた範囲を、何分間「調べ済み」として扱うか。
 *
 * 7日にしている理由は2つ。
 *   ・公園やコンビニは頻繁に増減しない。数日単位で見れば十分に新しい
 *   ・Overpassは無料の公共サーバーで回数制限がある（実際に429を食らった）。
 *     問い合わせを減らすことが、そのまま利用者の体験を守ることになる
 */
const SEARCH_MAX_AGE_MINUTES = 7 * 24 * 60;

/**
 * Overpassに問い合わせるときは、要求された半径の何倍まで広げて取っておくか。
 *
 * ★これが無いとキャッシュがほとんど効かない★
 *
 * 判定は「中心間の距離 ＋ 今回の半径 ≦ 記録した半径」で行う。
 * 要求と同じ半径しか保存していないと、
 *
 *     0m移動  … 0 + 800 ≦ 800  → 命中
 *     1m移動  … 1 + 800 > 800  → 外れる
 *
 * となり、1mでも動いた瞬間に必ず取り直しになる。
 * 実測でも、100m・300m・800mのいずれも命中しなかった。
 * このアプリは「歩いて移動しながら周辺を探す」ものなので、
 * それでは立ち止まって再読み込みしたときしか効かないことになる。
 *
 * そこで保存用には広めに取る。800mの要求なら1600mまで取っておけば、
 * そこから800m先まで移動しても、その円は1600mの円の中に収まる。
 *
 * ■ 代償と、それでも広げる理由
 *   円の面積は半径の2乗なので、2倍にすると1回の問い合わせは4倍重くなる。
 *   それでもこうするのは、Overpassが無料の公共サーバーで
 *   回数制限があるため（実際に429を食らっている）。
 *   「重い問い合わせを稀に」のほうが「軽い問い合わせを毎回」より安全で、
 *   利用者から見ても2回目以降が速くなる。
 *
 * ■ 上限を設ける理由
 *   利用者は仕様書§6の search_radius_m を最大2000mまで広げられる。
 *   そのまま2倍にすると4000mになり、Overpassが時間切れになりやすい。
 */
const FETCH_RADIUS_MULTIPLIER = 2;
const MAX_FETCH_RADIUS_M = 3000;

/** Supabaseの pois_within が返してくる1行の形 */
type PoiRow = {
  id: number;
  source_id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  distance_m: number;
};

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
 * データベースの1行を、画面に返す形（Poi）に直す。
 *
 * category はデータベース上ただの文字列なので、
 * ここでアプリの型（PoiCategory）として扱い直している。
 */
function rowToPoi(row: PoiRow): Poi {
  return {
    id: row.source_id,
    poiId: row.id,
    name: row.name,
    category: row.category as PoiCategory,
    lat: row.lat,
    lng: row.lng,
    distanceM: row.distance_m,
  };
}

/**
 * Overpassで取れたスポットを pois テーブルに保存し、
 * 「この範囲は調べた」と poi_searches に記録する。
 *
 * ■ 失敗しても例外を投げない
 *   保存に失敗しても、利用者にスポットを返すことはできる。
 *   キャッシュが効かず次回もOverpassに行くだけで、画面は動く。
 *   ここで例外を投げると、取得できていたのに画面がエラーになってしまう。
 *
 * @returns source_id → データベース上の番号 の対応表（保存できなかった場合は空）
 */
async function saveToCache(
  pois: Poi[],
  lat: number,
  lng: number,
  radiusM: number,
): Promise<Map<string, number>> {
  const idBySourceId = new Map<string, number>();

  const db = getSupabase();
  if (!db) return idBySourceId;

  try {
    if (pois.length > 0) {
      // upsert = 「無ければ入れる、あれば更新する」。
      // source_id に unique を付けてあるので、
      // 同じスポットが二重に増えることはない。
      const { data, error } = await db
        .from("pois")
        .upsert(
          pois.map((poi) => ({
            source_id: poi.id,
            name: poi.name,
            category: poi.category,
            // PostGISに座標を渡す書き方。経度が先、緯度が後。
            // SRID=4326 は「地球上の緯度経度」という座標系の番号。
            geom: `SRID=4326;POINT(${poi.lng} ${poi.lat})`,
            // 既にある行を更新したときも「今取り直した」ことを残す
            cached_at: new Date().toISOString(),
          })),
          { onConflict: "source_id" },
        )
        .select("id, source_id");

      if (error) {
        console.error("poisの保存に失敗:", error.message);
      } else {
        for (const row of data ?? []) {
          idBySourceId.set(row.source_id, row.id);
        }
      }
    }

    // 「この中心・この半径で調べた」を記録する。
    // スポットが0件でも記録する。0件だったという事実も立派な検索結果で、
    // 記録しないと「何も無い場所」で毎回Overpassに行くことになる。
    const { error: searchError } = await db.from("poi_searches").insert({
      center: `SRID=4326;POINT(${lng} ${lat})`,
      radius_m: radiusM,
    });

    if (searchError) {
      console.error("poi_searchesの記録に失敗:", searchError.message);
    }
  } catch (error) {
    console.error("キャッシュへの保存に失敗:", error);
  }

  return idBySourceId;
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

  const db = getSupabase();

  // --- ① この範囲は最近調べたか（Supabaseに聞く） ---
  if (db) {
    try {
      const { data: covered, error } = await db.rpc("poi_search_covered", {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: radiusM,
        p_max_age_minutes: SEARCH_MAX_AGE_MINUTES,
      });

      if (error) {
        // データベース側の問題は記録だけして、Overpassに進む。
        console.error("キャッシュ判定に失敗:", error.message);
      } else if (covered === true) {
        // --- ② 調べてあるので、データベースから取り出して返す ---
        const { data, error: readError } = await db.rpc("pois_within", {
          p_lat: lat,
          p_lng: lng,
          p_radius_m: radiusM,
        });

        if (readError) {
          console.error("キャッシュの読み出しに失敗:", readError.message);
        } else {
          const pois = ((data ?? []) as PoiRow[]).map(rowToPoi);
          // cached: true を付けて返すと、
          // 画面側で「今のはキャッシュだった」と分かる（動作確認に便利）
          return Response.json({ pois, cached: true });
        }
      }
    } catch (error) {
      console.error("Supabaseへの問い合わせに失敗:", error);
    }
  }

  // --- ③ 調べていないので、Overpassに問い合わせる ---
  try {
    // 保存用には要求より広く取る（上の FETCH_RADIUS_MULTIPLIER の説明を参照）。
    // Supabaseが使えないときは広く取っても保存先が無いので、要求どおりの範囲だけ取る。
    const fetchRadiusM = db
      ? Math.min(radiusM * FETCH_RADIUS_MULTIPLIER, MAX_FETCH_RADIUS_M)
      : radiusM;

    const fetched = await fetchNearbyPois(lat, lng, fetchRadiusM);

    // 次回のために保存する。失敗しても取得結果は返す。
    // 記録する半径は「実際に取ってきた範囲」でなければならない。
    // ここに要求された半径（800m）を書くと、
    // 保存していない外側まで「調べ済み」と誤って記録することになる。
    const idBySourceId = await saveToCache(fetched, lat, lng, fetchRadiusM);

    // 画面に返すのは、要求された半径の中だけ。
    // 広く取ったのは保存のためであって、表示を変えるためではない。
    const pois = fetched.filter((poi) => poi.distanceM <= radiusM);

    // 保存できていれば、データベース上の番号を添えて返す
    // （仕様書§6の visit_logs から参照するために後で必要になる）。
    const withIds = pois.map((poi) => {
      const poiId = idBySourceId.get(poi.id);
      return poiId === undefined ? poi : { ...poi, poiId };
    });

    return Response.json({ pois: withIds, cached: false });
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
