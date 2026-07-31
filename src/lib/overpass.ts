/**
 * ============================================================
 * overpass.ts — 周辺の実在スポットを探す（OpenStreetMap）
 * ============================================================
 *
 * ■ このファイルは何？
 *   Overpass API に「この地点から半径◯m以内にある、公園・カフェ・史跡…」を
 *   問い合わせて、アプリで使いやすい形に整えて返す処理。
 *
 * ■ Overpass API とは
 *   OpenStreetMap（世界中の有志が作っている無料の地図データ）に対して
 *   「条件に合う場所を検索する」ための無料API。
 *   コンビニ・公園・神社など、地図に登録されたあらゆる地物を検索できる。
 *
 * ■ なぜGoogle Places APIを使わないのか（仕様書§5・§11の決定）
 *   Googleの地理APIには「Google以外の地図と組み合わせて使用禁止」という規約がある。
 *   このアプリはMapLibre＋OSMで地図を描いているので、規約上使えない。
 *   加えて有料で、キャッシュ保持も30日までという制限がある。
 *
 * ■ このファイルはサーバー側でだけ動く
 *   ブラウザから直接Overpassを呼ぶと、
 *   ・CORS（別ドメインへの通信制限）で弾かれることがある
 *   ・利用者の数だけ公共サーバーを叩くことになる
 *   ・キャッシュを効かせられない
 *   ので、Next.jsのRoute Handler（src/app/api/pois/route.ts）から呼ぶ。
 */

import { distanceInMeters } from "@/lib/geo";

// 型とカテゴリ情報は、画面側とも共有するため poi.ts に置いてある
import type { Poi, PoiCategory } from "@/lib/poi";

/**
 * Overpass の公共サーバー。上から順に試す。
 *
 * 1台目が混雑していても2台目で成功することが多い。
 * 実際、開発中に公式サーバーが混雑で失敗し、ミラーで取得できた。
 * 無料の公共サーバーなので、こちらの都合で常に使える保証は無い。
 * ——これが仕様書§5で「poisテーブルへのキャッシュを必須とする」と
 * 決めている理由そのもの。
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
// ※ overpass.osm.ch は使わないこと。
//    一見同じAPIだが、スイス周辺のデータしか持っていない地域限定のサーバー。
//    日本の座標で検索すると「HTTP 200 で 0件」が返る。
//    エラーではないため気づきにくく、実際にこれで
//    「取得は成功しているのに1件も出ない」という状態になった。

/**
 * 検索するタグの一覧。
 *
 * OpenStreetMapでは、場所に「キー=値」の札（タグ）が付いている。
 * 例: 公園なら leisure=park、コンビニなら shop=convenience。
 * ここでは、アプリのカテゴリごとに拾いたいタグを決めている。
 *
 * ■ 選定の方針（仕様書§2.2・§1）
 *   ・お金を使わせすぎない → 飲食店を広く拾わず、カフェとパン屋程度に留める
 *   ・対人ハードルを上げすぎない → 店員との会話が要る場所は「であい」に隔離し、
 *     静かなモード（将来実装）で除外できるようにする
 */
const TAG_RULES: { key: string; values: string[]; category: PoiCategory }[] = [
  // しぜん：ただ行くだけで完結する。対人ゼロ
  { key: "leisure", values: ["park", "garden"], category: "nature" },
  { key: "natural", values: ["tree", "water", "beach"], category: "nature" },

  // たんけん：見て回るだけ。対人ゼロ
  {
    key: "tourism",
    values: ["attraction", "artwork", "viewpoint", "museum"],
    category: "explore",
  },
  { key: "historic", values: ["monument", "memorial", "ruins"], category: "explore" },
  { key: "amenity", values: ["place_of_worship", "fountain"], category: "explore" },

  // であい：現地で人と接する可能性がある（対人度が高い）
  { key: "amenity", values: ["cafe", "marketplace"], category: "meet" },
  { key: "shop", values: ["bakery", "florist"], category: "meet" },

  // ちいさな用事：短時間で済む実用的な立ち寄り先
  { key: "shop", values: ["convenience"], category: "errand" },
  { key: "amenity", values: ["post_office", "pharmacy", "library"], category: "errand" },
];

/** 一度に返す最大件数。多すぎると地図が埋まって読めなくなる */
const MAX_RESULTS = 60;

/**
 * リクエストに付ける「名乗り」。
 *
 * ■ なぜ必要か（つまずいた点）
 *   これを付けずに送ったところ、
 *     overpass-api.de → HTTP 406（受け付けられない）
 *     kumi.systems    → HTTP 429 ＋「意味のあるUser-Agentを付けてください」
 *   と、両方から拒否された。
 *
 *   OpenStreetMapの利用規約では、
 *   「どのアプリからの通信か分かるように名乗ること」が求められている。
 *   無料の公共サーバーを共有で使わせてもらっている以上、
 *   問題のある使い方をしているアプリを特定できる必要があるため。
 *   名乗らない通信は、正体不明として制限の対象になる。
 *
 * ■ 書き方の慣習
 *   「アプリ名/バージョン (補足情報)」の形にする。
 */
const USER_AGENT = "arquest-app/0.1 (personal portfolio project)";

/**
 * Overpass に投げる問い合わせ文を組み立てる。
 *
 * ■ 書式の意味
 *   [out:json]       … JSON形式で返してほしい
 *   [timeout:25]     … 25秒で諦めてほしい（サーバー側の上限）
 *   nwr[...]         … node（点）・way（線や面）・relation（複合）をまとめて検索
 *   (around:半径,緯度,経度) … その地点から半径◯m以内
 *   out center       … way（面）は中心点の座標を返してほしい
 *                      （公園は「面」で登録されているので、これが無いと座標が取れない）
 */
function buildQuery(lat: number, lng: number, radiusM: number): string {
  // 1行 = 1つの「キー=値」。値ごとに行を分けているのには理由がある。
  //
  // ["leisure"~"^(park|garden)$"] のように正規表現でまとめて書くこともできるが、
  // Overpassは完全一致（=）のときだけ索引を使えるため、正規表現は検索が遅くなる。
  // 実際、混雑しているサーバーでは正規表現版がタイムアウト（504）した。
  // 行数は増えるが、完全一致で並べるほうが速く、失敗しにくい。
  const conditions = TAG_RULES.flatMap((rule) =>
    rule.values.map(
      (value) =>
        // ["name"] を付けて、名前の付いている場所だけに絞る。
        // 名前が無い場所はお題にしても「どこへ行けばいいのか分からない」ため。
        `  nwr["${rule.key}"="${value}"]["name"](around:${radiusM},${lat},${lng});`,
    ),
  ).join("\n");

  return `[out:json][timeout:25];\n(\n${conditions}\n);\nout center ${MAX_RESULTS * 3};`;
}

/** Overpass から返ってくる1件ぶんの形（必要な部分だけ） */
type OverpassElement = {
  type: string;
  id: number;
  lat?: number; // node（点）の場合はここに座標が入る
  lon?: number;
  center?: { lat: number; lon: number }; // way / relation の場合はこちら
  tags?: Record<string, string>;
};

/**
 * タグを見て、どのカテゴリに当てはまるかを判定する。
 * 該当が無ければ null（＝対象外として捨てる）。
 */
function classify(tags: Record<string, string>): PoiCategory | null {
  for (const rule of TAG_RULES) {
    const value = tags[rule.key];
    if (value && rule.values.includes(value)) {
      return rule.category;
    }
  }
  return null;
}

/**
 * 周辺のスポットを検索する。
 *
 * @param lat 中心の緯度
 * @param lng 中心の経度
 * @param radiusM 検索半径（メートル）
 */
export async function fetchNearbyPois(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<Poi[]> {
  const query = buildQuery(lat, lng, radiusM);

  // どのサーバーがどう失敗したかを全部覚えておく。
  //
  // 最初は「最後のエラーだけ」を残していたが、それでは原因が分からなかった。
  // 1台目が時間切れ、2台目が回数制限、という具合に理由が違うことがあり、
  // 最後の1件だけ見ると誤った対処をしてしまう。
  const failures: string[] = [];

  // サーバーを上から順に試す
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // 名乗り。これが無いと拒否される（上の USER_AGENT の説明を参照）
          "User-Agent": USER_AGENT,
          // JSONで返してほしい、という意思表示
          Accept: "application/json",
        },
        // Overpassは "data=問い合わせ文" という形で受け取る。
        // URLに乗せると長すぎて弾かれることがあるのでPOSTで送る。
        body: new URLSearchParams({ data: query }).toString(),
        // 相手が無反応のまま固まるのを防ぐ。30秒で打ち切る
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        // 混雑時はHTMLのエラーページが返ってくる。
        // その場合もここで弾いて次のサーバーへ進む。
        //
        // よく出る番号の意味:
        //   429 … 回数制限。短時間に呼びすぎ。しばらく待つしかない
        //   504 … 時間切れ。検索が重すぎるか、サーバーが混んでいる
        // 429 は「サーバーの故障」ではなく「こちらの使い方の問題」なので、
        // 呼び出し側で区別できるようにメッセージに残す。
        throw new Error(
          `${endpoint} が ${response.status} を返しました` +
            (response.status === 429 ? "（回数制限）" : ""),
        );
      }

      const json: { elements?: OverpassElement[]; remark?: string } =
        await response.json();

      // ★見落としやすい落とし穴★
      // Overpassは、処理が時間切れになっても
      // 「HTTP 200・中身は空・remarkに理由」という形で返してくることがある。
      // 成功として扱うと「0件でした」と嘘の結果を出してしまうので、
      // remark があれば失敗とみなして次のサーバーを試す。
      if (json.remark) {
        throw new Error(`${endpoint} からの警告: ${json.remark}`);
      }

      return normalize(json.elements ?? [], lat, lng);
    } catch (error) {
      failures.push(String(error));
      // このサーバーは駄目だったので、次のサーバーを試す
    }
  }

  // すべて失敗した場合は、呼び出し元（Route Handler）にエラーを伝える。
  // join(" / ") で全サーバーの理由を1行にまとめる。
  throw new Error(
    `Overpassのどのサーバーからも取得できませんでした: ${failures.join(" / ")}`,
  );
}

/**
 * Overpass の生データを、アプリで使う形に整える。
 *   ・座標の位置がnodeとwayで違うのを吸収する
 *   ・カテゴリに当てはまらないものを捨てる
 *   ・同じ場所の重複を除く
 *   ・近い順に並べて、件数を絞る
 */
function normalize(
  elements: OverpassElement[],
  originLat: number,
  originLng: number,
): Poi[] {
  const pois: Poi[] = [];
  // 同じ名前・同じ位置のものが複数登録されていることがあるので、
  // 一度出したものを覚えて重複を防ぐ。
  const seen = new Set<string>();

  for (const element of elements) {
    const tags = element.tags;
    if (!tags?.name) continue; // 名前が無いものは使わない

    // node なら lat/lon、way や relation なら center に座標が入っている
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat === undefined || lng === undefined) continue;

    const category = classify(tags);
    if (!category) continue;

    // 名前と座標（小数4桁＝約10m）が同じものは同一とみなす
    const key = `${tags.name}@${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    pois.push({
      id: `${element.type}/${element.id}`,
      name: tags.name,
      category,
      lat,
      lng,
      distanceM: distanceInMeters(originLat, originLng, lat, lng),
    });
  }

  // 近い順に並べる。
  // sort に渡す関数が負の数を返すと a が前に来る、という決まり。
  pois.sort((a, b) => a.distanceM - b.distanceM);

  // slice(0, N) で先頭N件だけ取り出す
  return pois.slice(0, MAX_RESULTS);
}
