/**
 * ============================================================
 * osrm.ts — 目的地までの道順を取得する
 * ============================================================
 *
 * ■ OSRM とは
 *   OpenStreetMapの道路データを使って「道なりの経路」を計算してくれる
 *   無料のサービス（Open Source Routing Machine）。
 *   直線ではなく、実際に通れる道に沿った線を返してくれる。
 *
 * ■ 直線距離との違い（仕様書§8の⑦との使い分け）
 *   直線距離（geo.ts のハバーサイン） … 「あと何mか」の判断に使う。通信不要で速い
 *   道なりの距離（このファイル）      … 「どう歩くか」を見せるために使う。通信が必要
 *   到達判定は前者で行う。道順は見た目のためのもの。
 *
 * ■ ★重要★ 公開デモサーバーの制約（実際に確認した結果）
 *   仕様書§5では「OSRM（徒歩プロファイル）」を使う想定だが、
 *   公開デモサーバー（router.project-osrm.org）で
 *   foot / walking / driving の3つを試したところ、
 *   距離・所要時間・経路がすべて完全に同じ結果になった。
 *   つまり指定は無視され、実際は自動車用の経路だけが返ってくる。
 *
 *   影響:
 *     ・所要時間は自動車の時間（時速24km相当）。歩行の参考にならない
 *       → 所要時間はこちらで計算する（geo.ts の formatWalkingDuration）
 *     ・歩行者専用道や公園内の小道は経路に使われない
 *       → 表示は「だいたいの道順」として扱う。到達判定には使わない
 *
 *   本格的に徒歩の経路が必要になったら、OSRMを自前で立てるか、
 *   徒歩に対応した別サービスに変える必要がある。
 */

/** 経路の1点。[経度, 緯度] の順（MapLibreに合わせてある） */
export type RouteCoordinate = [number, number];

/** 取得した経路 */
export type WalkingRoute = {
  /** 道なりの距離（メートル） */
  distanceM: number;
  /** 経路を構成する点の並び。そのまま線として描ける */
  coordinates: RouteCoordinate[];
};

/**
 * OSRMの公開デモサーバー。
 * 無料で登録不要だが、動作の保証がない試用サーバーである点に注意。
 */
const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1";

/**
 * プロファイル（移動手段）。
 * 上記のとおりデモサーバーでは無視されるが、
 * 将来サーバーを差し替えたときに効くよう、意図が分かる値を入れておく。
 */
const PROFILE = "foot";

/**
 * 名乗り。Overpassのときと同様、無料の公共サービスを使わせてもらうので、
 * どのアプリからの通信か分かるようにしておく。
 */
const USER_AGENT = "arquest-app/0.1 (personal portfolio project)";

/**
 * 現在地から目的地までの道順を取得する。
 *
 * @param fromLat 出発地の緯度
 * @param fromLng 出発地の経度
 * @param toLat 目的地の緯度
 * @param toLng 目的地の経度
 */
export async function fetchWalkingRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<WalkingRoute> {
  // ★座標の順番に注意★
  // OSRMのURLは [経度,緯度] の順で、地点は「;」で区切る。
  // MapLibreと同じ並びだが、Geolocation APIとは逆。
  const points = `${fromLng},${fromLat};${toLng},${toLat}`;

  // overview=full   … 経路の線を細かい点で返してほしい（simplified だと粗くなる）
  // geometries=geojson … 地図にそのまま渡せる形式で返してほしい
  const url = `${OSRM_ENDPOINT}/${PROFILE}/${points}?overview=full&geometries=geojson`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`OSRMが ${response.status} を返しました`);
  }

  const json: {
    code?: string;
    message?: string;
    routes?: {
      distance: number;
      geometry: { coordinates: RouteCoordinate[] };
    }[];
  } = await response.json();

  // OSRMは、経路が見つからない場合もHTTP 200で返し、
  // code に "NoRoute" などの理由を入れてくる。
  // 「通信は成功したが結果は無い」を見落とさないよう、ここで確認する。
  if (json.code !== "Ok" || !json.routes?.length) {
    throw new Error(
      `経路を計算できませんでした（${json.code ?? "不明"}${
        json.message ? `: ${json.message}` : ""
      }）`,
    );
  }

  const route = json.routes[0];
  return {
    distanceM: route.distance,
    coordinates: route.geometry.coordinates,
  };
}
