/**
 * ============================================================
 * CurrentLocationMap — 現在地を地図の上に表示する部品
 * ============================================================
 *
 * ■ このファイルは何？
 *   緯度・経度・精度を受け取って、地図を描き、その場所にマーカー（ピン）と
 *   誤差の範囲を示す円を表示する部品。
 *   位置情報を「取る」処理は一切しない。もらった座標を「見せる」だけ。
 *
 * ■ 使っているライブラリ: MapLibre GL JS
 *   地図を描くための無料ライブラリ。
 *   Googleマップを使わない理由は仕様書 5章のとおり
 *   （Googleの地理APIは「Google以外の地図と組み合わせて使用禁止」という規約があるため）。
 *
 * ■ React と相性が悪い点に注意（このファイルの難所）
 *   Reactは「状態が変わったら画面を作り直す」のが得意。
 *   一方MapLibreは「一度作った地図を自分で管理し続ける」タイプのライブラリ。
 *   素直に書くと、位置が少し動くたびに地図が丸ごと作り直され、
 *   画面がちらつく・通信量が増える・動作が重くなる。
 *   そこで、
 *     ・地図の生成は最初の1回だけ（useEffect その1）
 *     ・位置が変わったときはマーカーと円とカメラだけ動かす（useEffect その2）
 *   という作りにしている。useEffect を2つに分けているのがその理由。
 */

// 地図はブラウザの機能（WebGL）を使って描くので、ブラウザ側で動かす宣言が必要。
"use client";

// useEffect … 画面が表示された後に処理を実行するための道具
// useRef    … 値を「覚えておく」ための箱（後述。useStateとの違いが重要）
// useState  … 変わったら画面を描き直してほしい値を入れる箱
import { useEffect, useRef, useState } from "react";

// MapLibre から必要なものだけ名前を指定して読み込む。
// Map は React の中で使うと紛らわしいので MapLibreMap という別名にしている
// （JavaScript にもともとある Map という機能と名前がぶつかるため）。
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";

// ライブラリ付属のCSS。これを忘れると、
// ズームボタンやマーカーの見た目が崩れる（よくあるミス）。
import "maplibre-gl/dist/maplibre-gl.css";

// 誤差の円・軌跡の線を作る自作の関数（src/lib/geo.ts）
import { createCircle, createTrailLine } from "@/lib/geo";

// 軌跡の点の型（src/hooks/useWalkTrail.ts で定義）
import type { TrailPoint } from "@/hooks/useWalkTrail";

// スポットの型・カテゴリ情報・地図用データへの変換
import {
  createPoiFeatureCollection,
  POI_CATEGORY_INFO,
  type Poi,
  type PoiCategory,
} from "@/lib/poi";

// 経路の点の型
import type { RouteCoordinate } from "@/lib/osrm";

/**
 * 地図の「見た目」の設定ファイルの場所（CARTO社が無料公開しているもの）。
 * APIキーの登録が不要なので、まずはこれで動作確認するのが早い。
 *
 * ■ なぜ voyager（色つき）を選んだか
 *   最初は positron という真っ白なスタイルを使っていたが、
 *   白背景に細い灰色の線だけの極端に淡いデザインのため、
 *   「地図が出ていない」のか「出ているが淡くて見えない」のか区別できなかった。
 *   voyager は道路や公園に色が付くので、描画されているかが一目で分かる。
 *
 * ■ 他の選択肢（差し替えたいときはURLを入れ替えるだけ）
 *   ほぼ白  : https://basemaps.cartocdn.com/gl/positron-gl-style/style.json
 *   夜モード: https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
 */
const STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

/** 地図の初期ズーム。16 は「近所の道が見えるくらい」の寄り具合 */
const INITIAL_ZOOM = 16;

/**
 * 誤差の円を描くための名前（ID）。
 * MapLibreでは「データ（source）」と「描き方（layer）」を名前で紐づけるため、
 * 文字列を直接あちこちに書かず、定数にまとめておくと打ち間違いを防げる。
 */
const CIRCLE_SOURCE_ID = "accuracy-circle"; // データそのもの
const CIRCLE_FILL_LAYER_ID = "accuracy-circle-fill"; // 内側の塗り
const CIRCLE_LINE_LAYER_ID = "accuracy-circle-line"; // 輪郭の線

/** 歩いた軌跡（線）用の名前 */
const TRAIL_SOURCE_ID = "walk-trail";
const TRAIL_LAYER_ID = "walk-trail-line";

/** 周辺スポット（点）用の名前 */
const POI_SOURCE_ID = "nearby-pois";
const POI_LAYER_ID = "nearby-pois-circle";

/** 目的地までの道順（線）用の名前 */
const ROUTE_SOURCE_ID = "destination-route";
const ROUTE_LAYER_ID = "destination-route-line";

/** 仕様書 4章のスカイブルー。マーカーと円で共通に使う */
const BRAND_BLUE = "#5B8DEF";

/**
 * 仕様書 4章のゴールド。歩いた軌跡に使う。
 * 現在地（青）と役割が違うので、色も分ける。
 * 「歩いた記録＝ごほうび」という仕様書の色の意味づけにも合う。
 */
const BRAND_GOLD = "#F5B942";

/** 仕様書 4章の濃いスカイブルー。目的地までの道順に使う */
const BRAND_DARK_BLUE = "#3E6FD8";

/**
 * スポットの点を、カテゴリごとに色分けするための指定。
 *
 * ■ 「データ駆動スタイル」という考え方
 *   点ひとつずつに色を決めて配るのではなく、
 *   「category が explore なら青、nature なら緑…」という
 *   ルールだけを地図に渡す。あとは地図が各点のデータを見て色を決める。
 *   点が何百件あっても指定は1つで済み、動作も速い。
 *
 * ■ ["match", 見る値, 条件1, 結果1, 条件2, 結果2, …, どれにも当てはまらない場合]
 *   という配列の形で書くのがMapLibreの決まり。
 *   ["get", "category"] は「その点の properties.category を見る」という意味。
 *
 * Object.entries は { explore: {...}, nature: {...} } のような形を
 * [["explore", {...}], ["nature", {...}]] という配列に変換する。
 * flatMap で [キー, 色, キー, 色, …] と平らに並べ直している。
 */
const POI_COLOR_STYLE = [
  "match",
  ["get", "category"],
  ...Object.entries(POI_CATEGORY_INFO).flatMap(([key, info]) => [
    key,
    info.color,
  ]),
  "#888888", // どのカテゴリにも当てはまらなかった場合の色
];

/**
 * MapLibreの「ワーカー」の置き場所（public/maplibre/ にコピーしてある）。
 *
 * ■ ワーカーとは
 *   地図タイルの取得と解析を担当する裏方のプログラム。
 *   重い処理を別で動かすことで、画面の操作が固まらないようにしている。
 *
 * ■ なぜ場所を手で教える必要があるのか（つまずいた原因）
 *   MapLibreは通常、自分のファイルの位置を基準にワーカーを探しに行く。
 *   ところがNext.jsはコードをまとめ直して配信する（バンドルする）ため、
 *   探しに行った場所にワーカーのファイルが存在しない。
 *   結果、ワーカーが起動せず、タイルが永久に読み込まれず、
 *   「地図を読み込み中…」のまま止まる（エラーも出ないので原因が分かりにくい）。
 *
 *   そこで scripts/copy-maplibre-worker.mjs で public/ にコピーし、
 *   その場所を setWorkerUrl で直接教えることで確実に起動させる。
 */
const WORKER_PATH = "/maplibre/maplibre-gl-worker.mjs";

/**
 * この部品が外から受け取るデータの型。
 * React では、親から子に渡すデータを「props（プロパティ）」と呼ぶ。
 */
type Props = {
  lat: number; // 緯度
  lng: number; // 経度
  accuracy: number; // 精度（誤差の半径・メートル）
  trail: TrailPoint[]; // 歩いた軌跡（間引き済みの点の並び）
  pois: Poi[]; // 周辺のスポット（未検索なら空の配列）
  destination: Poi | null; // 目指しているスポット（未設定なら null）
  routeCoordinates: RouteCoordinate[]; // 道なりの経路（未取得なら空の配列）
  /**
   * 地図上のスポットで「ここを目的地にする」が押されたときに呼ばれる。
   * 親（page.tsx）から処理を渡してもらう形にして、
   * この部品は「押されたことを伝える」だけに留めている。
   */
  onSelectDestination: (poi: Poi) => void;
};

export default function CurrentLocationMap({
  lat,
  lng,
  accuracy,
  trail,
  pois,
  destination,
  routeCoordinates,
  onSelectDestination,
}: Props) {
  // ------------------------------------------------------------
  // useRef で「箱」を用意する
  // ------------------------------------------------------------
  // useState との違い（ここが重要）:
  //   useState … 中身を変えると画面が描き直される
  //   useRef   … 中身を変えても画面は描き直されない
  //
  // 地図の本体は「画面の描き直しとは無関係に、ずっと同じものを持ち続けたい」もの。
  // useState に入れると変更のたびに再描画が走って無駄なので、useRef を使う。
  //
  // 中身を読み書きするときは、必ず `.current` を付ける。

  // 地図を描き込むための「場所」。下の <div> と結びつける。
  const containerRef = useRef<HTMLDivElement>(null);

  // 生成した地図の本体を覚えておく箱。まだ無いので最初は null。
  const mapRef = useRef<MapLibreMap | null>(null);

  // 現在地のマーカー（ピン）を覚えておく箱。
  const markerRef = useRef<Marker | null>(null);

  // 目的地のマーカーを覚えておく箱。
  // 目的地は決めたり取り消したりするので、付け外しできるよう別に持つ。
  const destinationMarkerRef = useRef<Marker | null>(null);

  // 「ここを目的地にする」が押されたときの処理を覚えておく箱。
  //
  // 地図のクリック処理は最初の1回だけ登録される。
  // その中から props を直接読むと、最初に渡された古い関数を
  // ずっと使い続けてしまうため、箱を経由して常に最新を読む。
  const onSelectDestinationRef = useRef(onSelectDestination);
  useEffect(() => {
    onSelectDestinationRef.current = onSelectDestination;
  }, [onSelectDestination]);

  // 最新の位置を覚えておく箱。
  // 地図の準備完了（load）は少し遅れて起きるため、そのときに
  // 「今の位置」を参照できるようにしておく必要がある。
  const latestRef = useRef({ lat, lng, accuracy, trail, pois });

  // ------------------------------------------------------------
  // useState … 画面に出したい「地図の様子」
  // ------------------------------------------------------------
  // 地図が真っ白なとき、原因が「読み込み中」なのか「失敗」なのか
  // 利用者にも開発者にも分からないと困る。だから画面に出す。
  const [isLoaded, setIsLoaded] = useState(false); // 地図の読み込みが終わったか
  const [loadError, setLoadError] = useState<string | null>(null); // 地図側のエラー

  // ------------------------------------------------------------
  // 最新の位置を箱に控えておく
  // ------------------------------------------------------------
  // props が変わるたびに実行し、いつでも「今の位置」が読めるようにする。
  useEffect(() => {
    latestRef.current = { lat, lng, accuracy, trail, pois };
  }, [lat, lng, accuracy, trail, pois]);

  // ------------------------------------------------------------
  // useEffect その1 … 地図を作る（最初の1回だけ）
  // ------------------------------------------------------------
  // useEffect(実行したい処理, [いつ実行するかの条件])
  //   条件に [] （空）を指定すると「最初の1回だけ実行」になる。
  //
  // なぜ画面の描画中ではなくここで作るのか:
  //   MapLibreは「この<div>に描いて」と実際のHTML要素を渡す必要がある。
  //   その要素は画面が表示された後にしか存在しないため、
  //   「表示された後に動く」useEffect の中で作る必要がある。
  useEffect(() => {
    // 念のための安全確認。
    //   containerRef.current がまだ無い＝<div>の準備ができていない
    //   mapRef.current がすでにある＝地図はもう作ってある（二重生成を防ぐ）
    if (!containerRef.current || mapRef.current) return;

    // ★地図を作る前に、ワーカーの場所を教える★
    // window.location.origin は「http://localhost:3000」のような今のアドレス。
    // 相対パスではなく完全なURLを渡すことで、
    // どこから読み込まれても確実に同じ場所を指すようにしている。
    setWorkerUrl(`${window.location.origin}${WORKER_PATH}`);

    // 地図を生成する
    const map = new MapLibreMap({
      container: containerRef.current, // どこに描くか
      style: STYLE_URL, // どんな見た目にするか
      // ★★★ 最大のハマりどころ ★★★
      // MapLibre の座標は [経度, 緯度] の順番。
      // ブラウザの位置情報は latitude（緯度）が先に来るので、順番が逆になる。
      // 間違えると地図がアフリカ沖の海（緯度0・経度0の付近）に飛ぶ。
      center: [latestRef.current.lng, latestRef.current.lat],
      zoom: INITIAL_ZOOM,
    });

    // ズームや回転のボタンを右上に追加する
    map.addControl(new NavigationControl(), "top-right");

    /**
     * 地図やタイルの読み込みで問題が起きたら、ここに通知が来る。
     *
     * これを付けていないと、通信が失敗しても地図が黙って白いままになり、
     * 原因が分からず時間を無駄にする。開発中は必ず付けておくとよい。
     */
    map.on("error", (event) => {
      // 開発者向け：詳細はブラウザのConsoleに出す
      console.error("MapLibreのエラー:", event.error ?? event);
      // 利用者向け：画面にも短く出す
      setLoadError(
        event.error?.message ?? "地図の読み込みに失敗しました（通信状況をご確認ください）",
      );
    });

    /**
     * 地図の下地（道路や地名）の読み込みが完了したときに一度だけ呼ばれる。
     *
     * ★重要★ 独自のデータ（今回は誤差の円）を足すのは、必ずこの後。
     * 読み込みが終わる前に addSource すると
     * 「style is not done loading」というエラーになる。
     */
    map.on("load", () => {
      setIsLoaded(true);

      const {
        lat: curLat,
        lng: curLng,
        accuracy: curAccuracy,
        trail: curTrail,
        pois: curPois,
      } = latestRef.current;

      // ------------------------------------------------------------
      // 歩いた軌跡（線）
      // ------------------------------------------------------------
      // ★先に登録する理由★
      //   MapLibreでは「あとから足した層が上に描かれる」。
      //   軌跡を先に、現在地の円をあとに登録することで、
      //   円が軌跡の上に重なり、今どこにいるかが見失われないようにしている。
      map.addSource(TRAIL_SOURCE_ID, {
        type: "geojson",
        data: createTrailLine(curTrail),
      });
      map.addLayer({
        id: TRAIL_LAYER_ID,
        type: "line",
        source: TRAIL_SOURCE_ID,
        layout: {
          // 線の端と角を丸くする。曲がり角がとがって見えるのを防ぐ
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": BRAND_GOLD,
          "line-width": 4,
        },
      });

      // ① データを登録する（何を描くか）
      map.addSource(CIRCLE_SOURCE_ID, {
        type: "geojson",
        data: createCircle(curLat, curLng, curAccuracy),
      });

      // ② 描き方を登録する（どう描くか）— まずは内側の塗り
      map.addLayer({
        id: CIRCLE_FILL_LAYER_ID,
        type: "fill",
        source: CIRCLE_SOURCE_ID,
        paint: {
          "fill-color": BRAND_BLUE,
          // 15%だけ色を乗せる。濃くすると下の地図が読めなくなる
          "fill-opacity": 0.15,
        },
      });

      // ③ 輪郭の線。塗りだけだと範囲の境目が分かりにくいので足す
      map.addLayer({
        id: CIRCLE_LINE_LAYER_ID,
        type: "line",
        source: CIRCLE_SOURCE_ID,
        paint: {
          "line-color": BRAND_BLUE,
          "line-width": 1.5,
          "line-opacity": 0.6,
        },
      });

      // ------------------------------------------------------------
      // 目的地までの道順（線）
      // ------------------------------------------------------------
      // 軌跡（歩いた跡）の上、スポットの点の下に描く。
      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: createTrailLine([]), // 最初は空。目的地が決まったら差し替える
      });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": BRAND_DARK_BLUE,
          "line-width": 5,
          "line-opacity": 0.75,
          // 破線にする。金色の実線（歩いた跡＝過去）と見分けるため。
          // 数字は [線の長さ, 空白の長さ] を線の太さ倍で指定する。
          "line-dasharray": [1.5, 1],
        },
      });

      // ------------------------------------------------------------
      // 周辺スポット（点）
      // ------------------------------------------------------------
      // 最後に登録することで、いちばん手前に描かれ、クリックしやすくなる。
      map.addSource(POI_SOURCE_ID, {
        type: "geojson",
        data: createPoiFeatureCollection(curPois),
      });
      map.addLayer({
        id: POI_LAYER_ID,
        type: "circle",
        source: POI_SOURCE_ID,
        paint: {
          // 色はカテゴリごと（上の POI_COLOR_STYLE の説明を参照）。
          // 型の指定が複雑なため、ここだけ型検査を通す書き方をしている。
          "circle-color": POI_COLOR_STYLE as never,
          "circle-radius": 6,
          // 白い縁を付けると、地図の色に埋もれずに見える
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });

      // --- 点をクリックしたら名前を出す ---
      map.on("click", POI_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;

        // properties に入れておいた値を取り出す。
        // 地図から返る値は型が確定していないので、String()/Number()で整えておく。
        const name = String(feature.properties?.name ?? "");
        const category = String(
          feature.properties?.category ?? "",
        ) as PoiCategory;
        const distanceM = Number(feature.properties?.distanceM ?? 0);
        const info = POI_CATEGORY_INFO[category];

        // ★HTMLの文字列を組み立てて渡さない★
        // 名前はOpenStreetMapの投稿データ、つまり他人が書いた文字列。
        // そのままHTMLとして埋め込むと、細工された文字列で
        // 不正なコードを実行されうる（クロスサイトスクリプティング）。
        // 要素を作って textContent に入れれば、文字は必ず文字として扱われる。
        const container = document.createElement("div");
        container.style.font = "13px sans-serif";
        container.style.color = "#1E2A4A";

        const title = document.createElement("strong");
        title.textContent = name;
        container.appendChild(title);

        const detail = document.createElement("div");
        detail.style.marginTop = "2px";
        detail.style.color = info?.color ?? "#666";
        detail.textContent = `${info?.label ?? category}・約${distanceM}m`;
        container.appendChild(detail);

        const popup = new Popup({ closeButton: false, offset: 12 })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setDOMContent(container)
          .addTo(map);

        // --- 「ここを目的地にする」ボタン ---
        const button = document.createElement("button");
        button.textContent = "ここを目的地にする";
        button.style.marginTop = "8px";
        button.style.width = "100%";
        button.style.padding = "6px 10px";
        button.style.borderRadius = "8px";
        button.style.border = "none";
        button.style.background = BRAND_DARK_BLUE;
        button.style.color = "#FFFFFF";
        button.style.fontWeight = "bold";
        button.style.cursor = "pointer";

        button.addEventListener("click", () => {
          // properties は地図用に平らにした値なので、
          // 元のスポット情報を id で探し直して渡す。
          // こうすると、親には欠けのない Poi がそのまま届く。
          const id = String(feature.properties?.id ?? "");
          const poi = latestRef.current.pois.find((p) => p.id === id);
          if (poi) onSelectDestinationRef.current(poi);
          popup.remove(); // 押したら吹き出しは閉じる
        });
        container.appendChild(button);
      });

      // --- 点の上にカーソルを乗せたら指の形にする（押せると分かるように） ---
      map.on("mouseenter", POI_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POI_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    // 現在地のマーカーを立てる。色は仕様書 4章のスカイブルー。
    // .setLngLat(...).addTo(map) のように「.」でつなげて書けるようになっている。
    // マーカーはHTMLの要素として地図に重ねられるので、
    // 下地の読み込みを待たずに追加してよい。
    markerRef.current = new Marker({ color: BRAND_BLUE })
      .setLngLat([latestRef.current.lng, latestRef.current.lat]) // ここも [経度, 緯度] の順
      .addTo(map);

    // 作った地図を箱にしまう。次回以降この地図を使い回す。
    mapRef.current = map;

    // useEffect の中で return した関数は「後片付け」として実行される。
    // 画面を離れるときに地図を破棄しないと、
    // 通信や描画処理が裏で動き続けてメモリを食う（メモリリーク）。
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []); // ← [] なので初回のみ。位置の更新は下の useEffect が担当する

  // ------------------------------------------------------------
  // useEffect その2 … 位置が変わったら中身だけ動かす
  // ------------------------------------------------------------
  // 条件に [lat, lng, accuracy] を指定しているので、
  // 「位置か精度が変わったときだけ」実行される。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return; // 地図がまだ無い間は何もしない

    // ① マーカーだけを新しい位置へ移す
    // `?.` は「中身が null なら何もしない」という書き方（オプショナルチェーン）。
    markerRef.current?.setLngLat([lng, lat]);

    // ② 地図の表示範囲（カメラ）を新しい位置へ滑らかに移動させる。
    // jumpTo だと瞬間移動して分かりにくいので、0.5秒かけて動かす easeTo を使う。
    map.easeTo({ center: [lng, lat], duration: 500 });

    // ③ 誤差の円を描き直す。
    // 円は地図の読み込み完了後に登録されるので、まだ無い場合もある。
    // getSource で取り出せたときだけ更新する。
    const circleSource = map.getSource(CIRCLE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    // setData はデータの差し替え。図形を消して作り直すより軽い。
    circleSource?.setData(createCircle(lat, lng, accuracy));

    // ④ 歩いた軌跡を描き直す。
    // 点が増えるたびに線が伸びていく。
    const trailSource = map.getSource(TRAIL_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    trailSource?.setData(createTrailLine(trail));
  }, [lat, lng, accuracy, trail]);

  // ------------------------------------------------------------
  // useEffect その3 … 周辺スポットが変わったら点を描き直す
  // ------------------------------------------------------------
  // 位置の更新（1〜2秒ごと）とスポットの更新（ボタンを押したときだけ）は
  // 起きる頻度がまったく違う。同じ useEffect にまとめると、
  // 位置が動くたびにスポットの描き直しまで走って無駄になるので分けている。
  useEffect(() => {
    const source = mapRef.current?.getSource(POI_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData(createPoiFeatureCollection(pois));
  }, [pois]);

  // ------------------------------------------------------------
  // useEffect その4 … 目的地のマーカーを付け外しする
  // ------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 目的地が取り消された場合は、マーカーを外して終わり
    if (!destination) {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      return;
    }

    // すでにマーカーがあるなら、位置を変えるだけにする。
    // 作り直すと一瞬消えてから現れて、ちらついて見える。
    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.setLngLat([destination.lng, destination.lat]);
      return;
    }

    // 目的地は「向かう先」なので、現在地（青）とは別の色にする。
    // 仕様書§4でゴールドは「ごほうび・強調」の色。目指す先に合う。
    destinationMarkerRef.current = new Marker({ color: BRAND_GOLD })
      .setLngLat([destination.lng, destination.lat])
      // 名前を吹き出しで添える。地図を見ただけでどこを目指しているか分かる。
      // setText は文字を必ず文字として扱うので、HTMLの細工を心配しなくてよい。
      .setPopup(new Popup({ offset: 24 }).setText(destination.name))
      .addTo(map);
  }, [destination]);

  // ------------------------------------------------------------
  // useEffect その5 … 道順の線を描き直す
  // ------------------------------------------------------------
  useEffect(() => {
    const source = mapRef.current?.getSource(ROUTE_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;

    // createTrailLine は { lat, lng } の並びを受け取る作りなので、
    // OSRMの [経度, 緯度] を詰め替えてから渡す。
    // 線を描く処理を1か所にまとめておけるので、変換のほうを合わせる。
    source.setData(
      createTrailLine(
        routeCoordinates.map(([lngValue, latValue]) => ({
          lat: latValue,
          lng: lngValue,
        })),
      ),
    );
  }, [routeCoordinates]);

  // ------------------------------------------------------------
  // 画面に表示する部分
  // ------------------------------------------------------------
  return (
    // ★注意★ 地図を入れる箱には必ず高さを指定する。
    //   h-[60vh] = 画面の高さの60%。
    //   高さの指定を忘れると高さ0になり、地図が「何も出ない」状態になる。
    //   relative は、中の表示を地図の上に重ねて置くために必要。
    //   overflow-hidden は、角丸からはみ出す地図を切り取るため。
    //   bg-[#F2F6FF]（薄い青）を敷いておくと、地図が描かれていないときに
    //   「白い地図」ではなく「まだ地図が無い」と一目で分かる。
    <div className="relative h-[60vh] w-full overflow-hidden rounded-xl bg-[#F2F6FF]">
      {/*
        この空の<div>が地図の描画先。
        ref={containerRef} と書くことで、
        上の useRef の箱にこのHTML要素が入り、MapLibreに渡せるようになる。
        中身を書かないのは、MapLibreがここに自動で描き込むため。
      */}
      <div ref={containerRef} className="h-full w-full" />

      {/* ------------------------------------------------------------
          読み込み中の表示（読み込みが終わる前・エラーが無いときだけ）
          ------------------------------------------------------------
          `!isLoaded && !loadError && (...)` は
          「まだ読み込めていない、かつエラーも無い場合だけ表示」という意味。 */}
      {!isLoaded && !loadError && (
        <p className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white/90 px-3 py-2 text-sm text-[#1E2A4A] shadow">
          地図を読み込み中…
        </p>
      )}

      {/* ------------------------------------------------------------
          エラーの表示
          ------------------------------------------------------------
          黙って白い地図になるのを防ぐため、原因を画面に出す。
          break-words は、長い英語のエラー文が枠を突き破らないようにする指定。 */}
      {loadError && (
        <p className="absolute left-3 right-3 top-3 z-10 wrap-break-word rounded-lg bg-[#FFF3DE] px-3 py-2 text-xs text-[#1E2A4A] shadow">
          {loadError}
        </p>
      )}

      {/*
        精度の表示。地図の上に重ねる。
          absolute … 親（relative の div）を基準に位置を指定する
          bottom-2 left-2 … 左下から少し内側
          z-10 … 地図より手前に表示する
          bg-white/85 … 白の85%の透明度（地図が少し透けて見える）
      */}
      <p className="absolute bottom-2 left-2 z-10 rounded bg-white/85 px-2 py-1 text-xs text-[#1E2A4A]">
        精度 ±{Math.round(accuracy)} m（青い円の範囲内にいます）
      </p>
    </div>
  );
}
