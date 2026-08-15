/**
 * ============================================================
 * poi.ts — スポット（目的地の候補）の型と共通情報
 * ============================================================
 *
 * ■ なぜ overpass.ts と分けたのか
 *   overpass.ts は「外部のサーバーに問い合わせる」サーバー側専用の処理。
 *   一方、カテゴリの名前や色は画面（ブラウザ側）でも必要になる。
 *
 *   画面から overpass.ts をそのまま読み込むと、
 *   問い合わせ先のURLや検索条件まで、使わないコードが
 *   ブラウザに配信されてしまう（＝読み込みが重くなる）。
 *
 *   そこで「両方で使う情報」だけをこのファイルに分けた。
 *     poi.ts      … 型・カテゴリ情報（サーバーでも画面でも使う）
 *     overpass.ts … 検索の実処理（サーバーでだけ使う）
 */

/**
 * スポットの分類（仕様書§6の `pois.category`）。
 *
 * お題の分類ではない。お題は行動カードが決めるので場所とは無関係で、
 * これは「通り道のスポット」（仕様書§2.4）を地図と一覧で色分けするためだけの値。
 *
 * コードの中では英語のキー（explore など）を使い、
 * 画面に出す日本語は label として持つ。
 * 日本語をそのまま変数名やデータベースの値にすると、
 * URLに使うときなどに扱いづらくなるため。
 */
export type PoiCategory = "explore" | "nature" | "meet" | "errand";

/**
 * カテゴリごとの表示情報。
 *
 * 色は仕様書§4のパレットから選んでいる。
 * 現在地（#5B8DEF）や軌跡（#F5B942）と重ならない色にして、
 * 地図の上で役割が混ざらないようにしている。
 *
 * 以前は「対人度（social）」を持たせて、対人ありのスポットに印を付けていた。
 * 仕様書§10で対人系のお題そのものを不採用にし、「静かなモード」も消えたため削除した。
 */
export const POI_CATEGORY_INFO: Record<
  PoiCategory,
  { label: string; color: string }
> = {
  explore: { label: "たんけん", color: "#3E6FD8" }, // 濃いスカイブルー
  nature: { label: "しぜん", color: "#4CAF7D" }, // グラス
  meet: { label: "であい", color: "#D2691E" }, // 暖色で他と区別
  errand: { label: "ちいさな用事", color: "#1E2A4A" }, // 紺
};

/** 1件のスポット。サーバーと画面の間でやり取りする形 */
export type Poi = {
  id: string; // OSM上のID（例: "node/123456"）。重複除去とキャッシュの目印に使う
  name: string; // 名前（例: "中央公園"）
  category: PoiCategory;
  lat: number;
  lng: number;
  distanceM: number; // 検索した地点からの直線距離（メートル）

  /**
   * Supabaseの pois テーブルでの番号。
   *
   * ■ なぜ id とは別に持つのか
   *   id はOSM側の呼び名（"node/123456"）で、こちらは自分のデータベースの番号。
   *   キャッシュの重複を防いだり、同じスポットを指していることを確かめるのに使う。
   *
   *   確定版では quests がスポットを参照しない（移動カードが座標を持たない）ので、
   *   この番号をクエスト側から使うことは無い。
   *
   * ■ なぜ省略可能（?）なのか
   *   Supabaseが使えないときはOverpassから直接返す道があり、
   *   その場合はまだデータベースに保存されていないので番号が無い。
   */
  poiId?: number;
};

/**
 * スポットの一覧を、地図に描ける形（GeoJSON）に変換する。
 *
 * ■ properties に何を入れるか
 *   地図側で「点をクリックしたら名前を出す」ために、
 *   表示に必要な情報を properties に持たせておく。
 *   ここに入れた値は、クリックしたときに取り出せる。
 */
export function createPoiFeatureCollection(
  pois: Poi[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        // ★MapLibreは [経度, 緯度] の順
        coordinates: [poi.lng, poi.lat],
      },
      properties: {
        id: poi.id,
        name: poi.name,
        category: poi.category,
        // 小数のままだと表示のたびに丸める手間があるので、ここで整数にしておく
        distanceM: Math.round(poi.distanceM),
      },
    })),
  };
}
