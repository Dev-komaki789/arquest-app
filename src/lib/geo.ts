/**
 * ============================================================
 * geo.ts — 地理計算のための小さな道具箱
 * ============================================================
 *
 * ■ このファイルは何？
 *   緯度・経度を使った計算をまとめておく場所。
 *   Reactとは無関係な「ただの計算」なので、画面や部品から切り離してある。
 *   こうしておくと、あとでテストを書きたくなったときにも扱いやすい。
 *
 * ■ lib フォルダの意味
 *   決まりごとではないが、React の部品でもフックでもない
 *   「純粋な処理」を置く場所として src/lib/ を使うのが一般的。
 */

/**
 * 地球の半径（メートル）。
 * 地球は完全な球ではないが、数百メートル程度の計算では
 * この値を使った近似で十分な精度が出る。
 */
const EARTH_RADIUS_M = 6_378_137;

/**
 * 円を何本の直線で表現するか。
 * 地図の世界に「円」という図形は無く、点をたくさん繋いだ多角形で円を描く。
 * 64もあれば、見た目は完全な円になる。
 */
const CIRCLE_STEPS = 64;

/**
 * ある地点を中心にした「半径◯メートルの円」を作る。
 *
 * ■ 何のために使う？
 *   位置情報には必ず誤差がある。「±50m」なら、実際にいるのは
 *   その座標を中心とした半径50mのどこか。
 *   ピンだけだと「そこにピッタリいる」と誤解を与えるので、
 *   誤差の範囲を円で見せて、正直な表示にする。
 *
 * ■ 戻り値の GeoJSON とは？
 *   地理データを表すための世界共通のJSON形式。
 *   MapLibreはこの形式をそのまま受け取って描いてくれる。
 *
 * @param lat 中心の緯度
 * @param lng 中心の経度
 * @param radiusM 半径（メートル）
 */
export function createCircle(
  lat: number,
  lng: number,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  // 度とラジアンの変換。三角関数（Math.cos など）はラジアンしか受け取らない。
  const latRad = (lat * Math.PI) / 180;

  // 「半径◯メートル」が「緯度◯度ぶん」に相当するかを求める。
  // 緯度方向（南北）の1度の長さは、地球上どこでもほぼ同じ（約111km）。
  const deltaLat = ((radiusM / EARTH_RADIUS_M) * 180) / Math.PI;

  // 経度方向（東西）は少し厄介。
  // 経線は北極・南極で1点に集まるため、高緯度ほど1度の距離が短くなる。
  // そこで cos(緯度) で割って補正する。
  // （日本の緯度35度では、経度1度の距離は赤道の約82%になる）
  const deltaLng = deltaLat / Math.cos(latRad);

  // 円周上の点を順番に作っていく
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    // 0〜360度を CIRCLE_STEPS 等分した角度（ラジアン）
    const theta = (i / CIRCLE_STEPS) * 2 * Math.PI;
    coordinates.push([
      // ★MapLibreは [経度, 緯度] の順なので、この並びを守る
      lng + deltaLng * Math.cos(theta),
      lat + deltaLat * Math.sin(theta),
    ]);
  }
  // 最後の点は最初の点と同じ位置になる（i = 0 と i = CIRCLE_STEPS が同じ角度）。
  // 多角形（Polygon）は「始点と終点が一致していること」が仕様上の決まりなので、
  // ループを <= にしてあるのはそのため。

  return {
    type: "Feature", // 「ひとつの地物」という意味
    geometry: {
      type: "Polygon", // 塗れる図形
      // 外周・穴（ドーナツ）を表せるよう二重の配列になっている。
      // 穴は不要なので、外周を1つだけ入れる。
      coordinates: [coordinates],
    },
    properties: {}, // 名前や種別などの付加情報。今回は無し
  };
}

/**
 * 2地点間の直線距離をメートルで求める（ハバーサインの公式）。
 *
 * ■ 何のために使う？
 *   仕様書 2.3 の「到達判定」で、クライアント側の概算に使う。
 *   「目的地まであと◯m」の表示や、「近づいたかも」の先行判定はこれで行う。
 *   ただし最終確定は必ずサーバー側（PostGISのST_DWithin）で行う。
 *   ブラウザの数値は利用者が書き換えられるため、単独では信用できない。
 *
 * ■ なぜ単純な引き算では駄目なのか
 *   地球は丸いので、緯度経度の差をそのまま距離に換算できない。
 *   球面上の2点間の距離を求める式が必要で、それがこの公式。
 */
export function distanceInMeters(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // 2点の緯度差・経度差（ラジアン）
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);

  // 公式の中身。丸暗記する必要はなく、「球面上の距離を出す式」と理解すれば十分。
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;

  // Math.atan2 は角度を安全に求める関数（0除算などを気にせず使える）
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * 歩いた軌跡（点の並び）を、地図に描ける線の形に変換する。
 *
 * ■ なぜ Feature ではなく FeatureCollection を返すのか
 *   線（LineString）は最低2点ないと成立しない。
 *   歩き始めの0点・1点の状態でも地図側でエラーにならないよう、
 *   「地物の入れ物」である FeatureCollection を返し、
 *   点が足りないときは中身が空の入れ物を渡す作りにしている。
 *   こうすると地図側は「あるかどうか」を気にせず、いつでも同じ処理で更新できる。
 */
export function createTrailLine(
  points: { lat: number; lng: number }[],
): GeoJSON.FeatureCollection {
  // 2点未満なら、中身が空の入れ物を返す（＝何も描かれない）
  if (points.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString", // 点を順番に繋いだ線
          // ★MapLibreは [経度, 緯度] の順。map() で全点を変換する
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      },
    ],
  };
}

/**
 * メートルの数値を、人が読みやすい文字列にする。
 *
 * 1km未満はメートル、それ以上はキロメートルで表示する。
 * 「1234.5678 m」のような表示は読みにくく、
 * 歩いた実感とも合わないため、桁を丸めて出す。
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    // Math.round で小数を四捨五入。歩行距離に小数点以下は不要
    return `${Math.round(meters)} m`;
  }
  // toFixed(2) で小数第2位まで（例: 1.23 km）
  return `${(meters / 1000).toFixed(2)} km`;
}
