/**
 * ============================================================
 * routing.ts — 目的地までの「徒歩の」道順を取得する
 * ============================================================
 *
 * ■ このファイルは何？
 *   出発地と目的地を渡すと、道なりの経路（線）と距離を返す。
 *
 * ■ なぜ経路サービスを Valhalla にしたのか（実測にもとづく判断）
 *   最初は仕様書§5どおり OSRM の公開デモサーバーを使ったが、
 *   経路が明らかに遠回りになった。調べた結果、
 *   公開デモサーバーは profile に foot を指定しても無視し、
 *   自動車用の経路しか返していないことが分かった
 *   （foot / walking / driving で結果が完全に一致した）。
 *
 *   自動車の経路は、一方通行・進入禁止・歩行者専用道の制約を受けるため、
 *   歩けば通れる道を避けて遠回りになる。実測での比較:
 *
 *     直線距離                1.17 km
 *     徒歩ルート（Valhalla）   1.35 km  ← これが正しい
 *     OSRMデモ（実質は自動車） 1.60 km  ← 250m の遠回り
 *     自動車ルート（Valhalla） 1.89 km
 *
 *   Valhalla（FOSSGISが公開している無料サーバー）は
 *   pedestrian（歩行者）に正しく対応していたので、こちらを使う。
 *
 * ■ OSRMも残してある理由
 *   Valhallaも無料の公共サーバーで、止まることがある。
 *   その場合はOSRM（自動車の経路）で代替する。
 *   遠回りではあっても、道順が何も出ないよりは案内になるため。
 *   どちらを使ったかは戻り値の profile で分かるようにしてある。
 */

/** 経路の1点。[経度, 緯度] の順（MapLibreに合わせてある） */
export type RouteCoordinate = [number, number];

/** 取得した経路 */
export type WalkingRoute = {
  /** 道なりの距離（メートル） */
  distanceM: number;
  /** 経路を構成する点の並び。そのまま線として描ける */
  coordinates: RouteCoordinate[];
  /**
   * どの経路を使ったか。
   *   "pedestrian" … 歩行者用の経路（本来の姿）
   *   "car"        … 代替で使った自動車用の経路（遠回りの可能性あり）
   * 画面で注意書きを出し分けるために返している。
   */
  profile: "pedestrian" | "car";
};

/** 歩行者に対応した経路サービス（FOSSGISの公開サーバー） */
const VALHALLA_ENDPOINT = "https://valhalla1.openstreetmap.de/route";

/** 代替で使う経路サービス（自動車の経路しか返らない） */
const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";

/**
 * 名乗り。無料の公共サービスを使わせてもらうので、
 * どのアプリからの通信か分かるようにしておく（Overpassと同じ理由）。
 */
const USER_AGENT = "arquest-app/0.1 (personal portfolio project)";

/**
 * Valhallaが返す経路の形式（encoded polyline）を、座標の配列に戻す。
 *
 * ■ encoded polyline とは
 *   何百個もの座標をそのままJSONで送ると通信量が大きくなるため、
 *   座標の「前の点との差分」を文字列に圧縮して送る仕組み。
 *   "kgafaAedfhaGi@~C..." のような文字列が経路そのもの。
 *
 * ■ precision（精度）に注意
 *   Googleなどが使う一般的な形式は精度5（小数第5位まで）だが、
 *   Valhallaは精度6を使う。ここを間違えると座標が10分の1になり、
 *   経路がアフリカ沖あたりに飛ぶ。
 *
 * ■ 中身の仕組み（覚える必要はない）
 *   1文字ずつ数値に直し、5ビットずつ繋げて1つの数値を作る。
 *   最下位ビットが1なら負の数、という決まりで符号を表している。
 */
function decodePolyline(
  encoded: string,
  precision = 6,
): RouteCoordinate[] {
  const factor = 10 ** precision;
  const coordinates: RouteCoordinate[] = [];

  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // --- 緯度の差分を読む ---
    let result = 1;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f); // 0x1f = 31。続きがあるかどうかの目印
    // 最下位ビットが1なら負の数（~ はビット反転）
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // --- 経度の差分を読む（やり方は緯度と同じ） ---
    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    // ★ [経度, 緯度] の順で入れる（MapLibreに渡すため）
    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

/** Valhallaに歩行者の経路を問い合わせる */
async function fetchFromValhalla(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<WalkingRoute> {
  const response = await fetch(VALHALLA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      // Valhallaは lat / lon という名前で、経度が lon（lng ではない）
      locations: [
        { lat: fromLat, lon: fromLng },
        { lat: toLat, lon: toLng },
      ],
      // ★これが「歩行者として計算して」という指定★
      // 歩行者専用道や公園内の小道が使われ、一方通行の制約を受けなくなる。
      costing: "pedestrian",
      units: "kilometers",
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Valhallaが ${response.status} を返しました`);
  }

  const json: {
    trip?: { legs?: { shape: string }[]; summary?: { length: number } };
  } = await response.json();

  const shape = json.trip?.legs?.[0]?.shape;
  const lengthKm = json.trip?.summary?.length;

  if (!shape || lengthKm === undefined) {
    throw new Error("Valhallaの応答に経路が含まれていませんでした");
  }

  return {
    // Valhallaはキロメートルで返すので、メートルに直す
    distanceM: lengthKm * 1000,
    coordinates: decodePolyline(shape),
    profile: "pedestrian",
  };
}

/** OSRMに問い合わせる（代替用。自動車の経路しか返らない） */
async function fetchFromOsrm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<WalkingRoute> {
  // ★座標の順番に注意★ OSRMのURLは [経度,緯度] の順で、地点は「;」で区切る
  const points = `${fromLng},${fromLat};${toLng},${toLat}`;
  const url = `${OSRM_ENDPOINT}/${points}?overview=full&geometries=geojson`;

  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`OSRMが ${response.status} を返しました`);
  }

  const json: {
    code?: string;
    routes?: { distance: number; geometry: { coordinates: RouteCoordinate[] } }[];
  } = await response.json();

  // OSRMは経路が無い場合もHTTP 200で返し、codeに理由を入れてくる
  if (json.code !== "Ok" || !json.routes?.length) {
    throw new Error(`OSRMが経路を返しませんでした（${json.code ?? "不明"}）`);
  }

  return {
    distanceM: json.routes[0].distance,
    coordinates: json.routes[0].geometry.coordinates,
    profile: "car",
  };
}

/**
 * 現在地から目的地までの徒歩の道順を取得する。
 *
 * まず歩行者用（Valhalla）を試し、駄目なら自動車用（OSRM）で代替する。
 */
export async function fetchWalkingRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<WalkingRoute> {
  try {
    return await fetchFromValhalla(fromLat, fromLng, toLat, toLng);
  } catch (valhallaError) {
    console.warn("歩行者用の経路を取得できず、自動車用で代替します:", valhallaError);
    return await fetchFromOsrm(fromLat, fromLng, toLat, toLng);
  }
}
