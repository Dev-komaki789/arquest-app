/**
 * ============================================================
 * ホーム画面（現在地の表示・追従）
 * ============================================================
 *
 * ■ このファイルは何？
 *   Next.js（App Router）では、`src/app/page.tsx` が
 *   トップページ（http://localhost:3000）の中身になる。
 *   ファイルを置いた場所がそのままURLになる仕組み。
 *     src/app/page.tsx        → /
 *     src/app/diary/page.tsx  → /diary
 *
 * ■ この画面の役割
 *   ボタンを押すと現在地を取得し、地図・マーカー・誤差の円・数値を表示する。
 *   移動すると自動で追従し、停止ボタンでGPSを止められる。
 *   仕様書 8章「実装の推奨順序」の ①②⑥⑦ にあたる部分。
 *   （最終的にはここが「ホーム＝相棒が話しかけてくる画面」になる）
 *
 * ■ 役割の分け方（3つのファイルに分かれている理由）
 *   page.tsx（この画面）        … 表示と操作をまとめる係
 *   hooks/useGeolocation.ts     … 位置を取る係
 *   components/CurrentLocationMap.tsx … 地図を描く係
 *   混ぜて書くと、画面が増えたときに同じコードを何度も書くことになる。
 *   仕様書では10画面あるので、最初から分けておく。
 */

// この画面はボタンのクリックに反応し、位置情報（ブラウザの機能）を使うので、
// ブラウザ側で動かす必要がある。そのための宣言。
"use client";

// dynamic … 部品の読み込み方を細かく指定するための Next.js の機能
import dynamic from "next/dynamic";

// 自作のカスタムフックを読み込む。
// `@/` は `src/` を指す近道（tsconfig.json の paths で設定済み）。
// これが無いと `../hooks/useGeolocation` のような相対パスを書く必要がある。
import { useGeolocation } from "@/hooks/useGeolocation";

// 歩いた軌跡と距離を記録するフック。
// 間引きの基準値も読み込んで、画面の説明文に使う
// （数字を直接書くと、基準を変えたときに説明とズレるため）。
import {
  useWalkTrail,
  MAX_ACCEPTABLE_ACCURACY_M,
  MIN_MOVE_M,
} from "@/hooks/useWalkTrail";

// 周辺スポットを検索するフック
import { useNearbyPois } from "@/hooks/useNearbyPois";

// メートルを読みやすい文字列にする関数（例: 1234 → "1.23 km"）
import { formatDistance } from "@/lib/geo";

// カテゴリの名前と色
import { POI_CATEGORY_INFO } from "@/lib/poi";

/**
 * 地図の部品を読み込む。
 *
 * ■ なぜ普通の import ではなく dynamic を使うのか
 *   Next.js は表示を速くするため、画面をいったんサーバー側でも組み立てる。
 *   ところがMapLibreは、ブラウザにしか存在しない機能（window や WebGL）を
 *   読み込んだ瞬間に触ろうとするため、サーバー側で動かすと
 *   「window is not defined」というエラーで止まってしまう。
 *
 *   `ssr: false` は「この部品はサーバー側では読み込まない」という指定。
 *   これで地図はブラウザに届いてから初めて読み込まれる。
 *
 * ■ loading
 *   読み込みが終わるまでの間に表示する仮の見た目。
 *   何も指定しないと一瞬何も無い空白になるので、
 *   地図と同じ大きさの薄い箱を置いて、ガタつきを防いでいる
 *   （animate-pulse でゆっくり点滅させ、読み込み中だと分かるようにしている）。
 */
const CurrentLocationMap = dynamic(
  () => import("@/components/CurrentLocationMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[60vh] w-full animate-pulse rounded-xl bg-[#F2F6FF]" />
    ),
  },
);

/**
 * 画面の本体。
 * `export default` にしておくと、Next.js がこれをページとして表示してくれる。
 * 関数名（Home）は自由だが、React の部品は大文字で始めるのがルール。
 */
export default function Home() {
  // フックを呼ぶだけで、位置情報に必要なものが手に入る。
  // { } で囲んで受け取るのは「分割代入」。
  // 返ってきたオブジェクトから、名前を指定して取り出している。
  // 歩いた記録を担当するフック。
  // record は「位置がひとつ届いたときに呼んでほしい処理」。
  const { trail, totalDistanceM, ignoredCount, record, reset } = useWalkTrail();

  // 位置を取得するフック。record を渡しておくと、
  // 位置が届いた瞬間に記録まで済む。
  // 「取得する係」と「記録する係」を、この1行で繋いでいる。
  const { position, error, status, start, stop } = useGeolocation({
    onPosition: record,
  });

  // 周辺スポットの検索。位置とは独立して動く（押したときだけ通信する）。
  const {
    pois,
    status: poiStatus,
    error: poiError,
    fromCache,
    search,
  } = useNearbyPois();

  // 追従中かどうかを、あとで何度も使うので変数にしておく。
  // こうしておくと status の文字列をあちこちに書かずに済み、打ち間違いも防げる。
  const isTracking = status === "tracking";
  const isRequesting = status === "requesting";

  // エラーを「致命的」と「一時的」に分けて扱う。
  //   致命的 … 許可されなかった場合。利用者が設定を変えない限り直らないので、
  //            追従は停止済み（status が "error" になっている）
  //   一時的 … 電波やGPSの一時的な不調。追従は続いているので、
  //            お知らせだけ出して、回復を待てばよい
  // 同じ「エラー」でも利用者が取るべき行動が違うので、見せ方を分ける。
  const hasFatalError = status === "error";
  const hasTemporaryIssue = error !== null && !hasFatalError;

  /**
   * 周辺スポットの検索範囲（メートル）。
   * 仕様書§6の user_settings.search_radius_m の既定値と同じ。
   * 将来は設定画面（画面9）のスライダーで変えられるようにする。
   */
  const SEARCH_RADIUS_M = 800;

  // ここから下（return の中）が、実際に画面に表示される部分。
  // HTMLに見えるがJavaScriptの中に書ける特別な記法で、JSX と呼ぶ。
  return (
    // className に書いているのは Tailwind CSS のクラス。
    // CSSファイルを別に作らず、ここで見た目を指定できる。
    //   mx-auto        … 左右の余白を自動＝中央寄せ
    //   flex flex-col  … 中身を縦に並べる
    //   min-h-screen   … 最低でも画面の高さいっぱい
    //   max-w-md       … 横幅の上限（スマホ想定の幅で止める）
    //   gap-4          … 中身どうしの間隔
    //   p-5            … 内側の余白
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-5">
      {/* ------------------------------------------------------------
          見出し
          ------------------------------------------------------------
          text-[#1E2A4A] は仕様書 4章のデザイン色（紺）を直接指定している */}
      <header>
        <h1 className="text-xl font-bold text-[#1E2A4A]">
          アルクエスト — 現在地
        </h1>
        <p className="mt-1 text-xs text-[#1E2A4A]/70">
          {/* /70 は「その色の70%の濃さ」という指定。補足文を控えめに見せる */}
          仕様書 8章の①②⑥⑦（現在地の取得・地図表示・追従・誤差の可視化）
        </p>
      </header>

      {/* ------------------------------------------------------------
          操作ボタン
          ------------------------------------------------------------
          1つのボタンで「開始」と「停止」を兼ねている。
          追従中かどうかで、押したときの動作・文字・色を切り替える。 */}
      <button
        // ★ onClick には「関数そのもの」を渡す。
        //   stop() や start() のように () を付けると、
        //   画面を開いた瞬間に実行されてしまうので付けない。
        //
        // 動作中（取得中・追従中）はどちらも「止める」ボタンとして働く。
        // ボタンを無効化して待たせない理由:
        //   位置が取れない場所では取得が延々と終わらないことがある。
        //   そのとき押せないボタンだけが残ると、利用者は何もできなくなる。
        //   いつでも自分の操作で止められる状態を保つ。
        onClick={isTracking || isRequesting ? stop : start}
        // テンプレートリテラル（バッククォート）を使うと、
        // 文字列の中に ${ } でJavaScriptの結果を差し込める。
        // ここでは共通のクラスに、状態ごとの色を足している。
        className={`rounded-xl px-4 py-3 font-bold text-white transition-colors ${
          isTracking || isRequesting
            ? "bg-[#1E2A4A] active:bg-[#0F1A33]" // 停止ボタンは紺色
            : "bg-[#5B8DEF] active:bg-[#3E6FD8]" // 開始ボタンはスカイブルー
        }`}
      >
        {/*
          JSXの中で { } を書くと、その中はJavaScriptとして扱われる。
          「条件 ? Aの場合 : Bの場合」は if を1行で書く書き方（三項演算子）。
          3つの状態を出したいので、2段重ねにしている。
        */}
        {isRequesting
          ? "取得を中止する"
          : isTracking
            ? "追従を停止する"
            : "現在地を取得する"}
      </button>

      {/* ------------------------------------------------------------
          取得中の表示
          ------------------------------------------------------------
          最初の位置が届くまでの間。許可ダイアログが出ている最中でもある。 */}
      {isRequesting && (
        <p className="flex items-center gap-2 text-sm text-[#1E2A4A]/70">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#5B8DEF]" />
          位置を取得中…（許可を求められたら「許可」を選んでください）
        </p>
      )}

      {/* ------------------------------------------------------------
          追従中の表示
          ------------------------------------------------------------
          GPSが動いていることを利用者に隠さないための表示。
          電池を使う機能なので、動作中は必ず分かるようにしておく。
          animate-pulse でゆっくり点滅させ、生きていることを示す。 */}
      {isTracking && (
        <p className="flex items-center gap-2 text-sm text-[#4CAF7D]">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4CAF7D]" />
          追従中（移動すると地図が自動で動きます）
        </p>
      )}

      {/* ------------------------------------------------------------
          致命的なエラーの表示（許可されなかった場合）
          ------------------------------------------------------------
          `hasFatalError && (...)` は「左が true のときだけ右側を表示」という書き方。
          false のときは何も表示されない。
          if 文は JSX の中に直接書けないため、この形をよく使う。
          この場合は追従が止まっているので、利用者に対処してもらう必要がある。 */}
      {hasFatalError && error && (
        <p className="rounded-xl bg-[#FFF3DE] p-3 text-sm leading-relaxed text-[#1E2A4A]">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------
          一時的な不調のお知らせ
          ------------------------------------------------------------
          トンネル・地下・ビル影などで測位が一瞬途切れたときの表示。
          追従自体は続いているので、慌てさせない言い方にする。
          位置が取れ次第この表示は自動で消える。 */}
      {hasTemporaryIssue && (
        <p className="rounded-xl border border-[#F5B942] bg-white p-3 text-sm leading-relaxed text-[#1E2A4A]">
          いま位置を取得できていません（電波やGPSの状態によるものです）。
          <br />
          追従は続いているので、そのままお待ちください。
        </p>
      )}

      {/* ------------------------------------------------------------
          まだ位置を取得していないときの案内
          ------------------------------------------------------------
          `!position && !error` は「位置がまだ無く、エラーも無い」＝最初の状態。
          何も表示されない画面は不安を与えるので、説明を置いておく。 */}
      {!position && !error && (
        <p className="rounded-xl bg-[#F2F6FF] p-4 text-sm leading-relaxed text-[#1E2A4A]">
          ボタンを押すと、ブラウザが位置情報の使用許可を尋ねます。
          許可すると地図と現在地が表示されます。
        </p>
      )}

      {/* ------------------------------------------------------------
          地図の表示（位置が取得できたときだけ出す）
          ------------------------------------------------------------
          lat / lng / accuracy を地図の部品に渡している。
          この「親から子へデータを渡す」書き方を props と呼ぶ。
          位置が更新されると、渡された値が変わり、
          地図側のマーカーと誤差の円が自動で動く仕組みになっている。 */}
      {position && (
        <CurrentLocationMap
          lat={position.lat}
          lng={position.lng}
          accuracy={position.accuracy}
          trail={trail}
          pois={pois}
        />
      )}

      {/* ------------------------------------------------------------
          周辺スポットの検索（仕様書§8の③）
          ------------------------------------------------------------
          位置が取れているときだけ操作できる。
          ここで見つかった実在スポットが、将来ミッションの目的地になる。 */}
      {position && (
        <section className="rounded-xl bg-[#F2F6FF] p-4">
          <button
            // 押したときの座標で検索する。
            // 「押した瞬間の位置」を使いたいので、ここで position を読む。
            onClick={() =>
              search(position.lat, position.lng, SEARCH_RADIUS_M)
            }
            disabled={poiStatus === "loading"}
            className="w-full rounded-xl bg-[#3E6FD8] px-4 py-3 font-bold text-white active:bg-[#1E2A4A] disabled:opacity-50"
          >
            {poiStatus === "loading"
              ? "探しています…"
              : `周辺${SEARCH_RADIUS_M}mのスポットを探す`}
          </button>

          {/* 検索中の案内。初回は10秒ほどかかることがあるので、
              待たされている理由を伝えて不安にさせないようにする */}
          {poiStatus === "loading" && (
            <p className="mt-2 text-xs text-[#1E2A4A]/70">
              OpenStreetMapに問い合わせています。初回は10秒ほどかかります。
            </p>
          )}

          {/* 失敗したときの表示。回数制限の場合は待つよう伝える文面が返ってくる */}
          {poiError && (
            <p className="mt-2 rounded-lg bg-white p-3 text-xs leading-relaxed text-[#1E2A4A]">
              {poiError}
            </p>
          )}

          {/* 結果の要約とカテゴリごとの内訳 */}
          {poiStatus === "success" && (
            <div className="mt-3">
              <p className="text-sm font-bold text-[#1E2A4A]">
                {pois.length}件見つかりました
                {/* キャッシュから返った場合は印を出す。
                    2回目が一瞬で返るのが分かり、キャッシュの効果を確認できる */}
                {fromCache && (
                  <span className="ml-2 rounded bg-white px-2 py-0.5 text-xs font-normal text-[#1E2A4A]/70">
                    保存済みの結果
                  </span>
                )}
              </p>

              {/* カテゴリごとの件数。
                  Object.entries でカテゴリ情報を1つずつ取り出して並べる */}
              <ul className="mt-2 flex flex-wrap gap-2">
                {Object.entries(POI_CATEGORY_INFO).map(([key, info]) => {
                  // filter で「そのカテゴリのものだけ」を抜き出して数える
                  const count = pois.filter((p) => p.category === key).length;
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-[#1E2A4A]"
                    >
                      {/* 地図の点と同じ色の丸を置いて、対応が分かるようにする */}
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        // 色は実行時に決まるので、Tailwindのクラスではなく
                        // style で直接指定する（クラス名は事前に決まっている必要があるため）
                        style={{ backgroundColor: info.color }}
                      />
                      {info.label} {count}
                      {/* 対人ありのカテゴリに印を付ける。
                          仕様書§2.2の「静かなモード」で除外する対象 */}
                      {info.social && (
                        <span className="text-[#1E2A4A]/50">（対人あり）</span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* 近い順に5件。地図の点をクリックしても同じ情報が出る */}
              <ol className="mt-3 space-y-1 text-xs text-[#1E2A4A]">
                {pois.slice(0, 5).map((poi) => (
                  <li key={poi.id} className="flex justify-between gap-2">
                    <span className="truncate">{poi.name}</span>
                    <span className="shrink-0 font-mono text-[#1E2A4A]/60">
                      {Math.round(poi.distanceM)} m
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-[#1E2A4A]/60">
                地図の色つきの点をタップすると、名前と距離が出ます。
              </p>
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------
          取得できた位置の数値表示（取得できたときだけ出す）
          ------------------------------------------------------------
          <dl>/<dt>/<dd> は「項目名と値の組」を表すHTMLタグ。
          単なる <div> より意味が伝わるので、こちらを使っている。
            dl … 定義リスト全体
            dt … 項目名（緯度、経度…）
            dd … その値
          font-mono（等幅フォント）にしているのは、
          数字の桁が揃って読みやすくなるため。 */}
      {/* ------------------------------------------------------------
          歩いた記録（累計距離）
          ------------------------------------------------------------
          仕様書§6の users.total_distance_m / daily_activity_stats.distance_m
          にあたる値。いまは画面の中だけで数えていて、まだ保存はしていない。

          ゴールドは仕様書§4で「ごほうび・強調」に割り当てられた色。
          歩いた記録は達成の証なので、この色を使っている
          （地図の軌跡の線とも同じ色で揃えてある）。 */}
      {/* 表示する条件を「記録があるとき」だけにすると、
          全部間引かれている場合にパネルごと消えてしまい、
          なぜ記録されないのかが分からなくなる。
          捨てた点が1件でもあれば表示して、状況が見えるようにする。 */}
      {(trail.length > 0 || ignoredCount > 0) && (
        <div className="rounded-xl bg-[#FFF3DE] p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-[#1E2A4A]/70">歩いた距離</p>
              <p className="font-mono text-2xl font-bold text-[#1E2A4A]">
                {/* 1km未満はm、それ以上はkmで表示される */}
                {formatDistance(totalDistanceM)}
              </p>
            </div>
            {/* 記録をやり直すボタン。動作確認のたびに
                画面を再読み込みしなくて済むように置いている */}
            <button
              onClick={reset}
              className="rounded-lg border border-[#1E2A4A]/20 px-3 py-1.5 text-xs text-[#1E2A4A] active:bg-[#1E2A4A]/10"
            >
              記録をリセット
            </button>
          </div>

          {/* 内訳。間引きが効いていることを目で確認できるようにしておく。
              完成時には消してよい開発用の表示。 */}
          <p className="mt-2 text-xs leading-relaxed text-[#1E2A4A]/70">
            記録した地点 {trail.length} 件／間引いた地点 {ignoredCount} 件
            <br />
            精度±{MAX_ACCEPTABLE_ACCURACY_M}mより粗い点と、前回から
            {MIN_MOVE_M}m未満しか動いていない点は距離に数えていません。
            {/* 開発中は基準を緩めてあるので、それが分かるようにしておく。
                本番（npm run build 後）は ±50m に戻る。 */}
            {MAX_ACCEPTABLE_ACCURACY_M > 50 && (
              <>
                <br />
                （開発中のため精度の基準を緩めています。本番では±50mです）
              </>
            )}
          </p>

          {/* ------------------------------------------------------------
              全部間引かれているときの原因表示
              ------------------------------------------------------------
              1件も記録できていないのに捨てた点だけがある＝
              条件が厳しすぎて全部弾かれている状態。
              黙って何も起きないと原因が分からないので、理由を出す。 */}
          {trail.length === 0 && position && (
            <p className="mt-2 rounded-lg bg-white p-2 text-xs leading-relaxed text-[#1E2A4A]">
              いまの位置の精度は ±{Math.round(position.accuracy)} m です。
              {position.accuracy > MAX_ACCEPTABLE_ACCURACY_M
                ? `基準の ±${MAX_ACCEPTABLE_ACCURACY_M}m より粗いため、すべて記録対象外になっています。`
                : "基準は満たしています。"}
            </p>
          )}
        </div>
      )}

      {position && (
        <dl className="rounded-xl bg-[#1E2A4A] p-4 font-mono text-sm text-white">
          <div className="flex justify-between">
            <dt>緯度</dt>
            {/* toFixed(6) = 小数第6位までにそろえる。
                緯度経度は桁が多いとブレて見えるので固定する。
                小数第6位は現実の距離で約10cmに相当する精度。 */}
            <dd>{position.lat.toFixed(6)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>経度</dt>
            <dd>{position.lng.toFixed(6)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>精度</dt>
            {/* 誤差の半径。Math.round で小数を四捨五入して整数にする。
                「±50m」なら、この座標を中心とした半径50m以内のどこかにいる、という意味。 */}
            <dd>±{Math.round(position.accuracy)} m</dd>
          </div>
          <div className="flex justify-between">
            <dt>更新時刻</dt>
            {/* timestamp は 1970年から数えたミリ秒という数値なので、
                new Date(...) で日付に変換し、
                toLocaleTimeString("ja-JP") で日本向けの時刻表記にする。
                追従中は、位置が変わるたびにこの時刻が更新される。 */}
            <dd>{new Date(position.timestamp).toLocaleTimeString("ja-JP")}</dd>
          </div>
        </dl>
      )}

      {/* ------------------------------------------------------------
          開発中の補足（動作確認の手順を画面に残しておく）
          ------------------------------------------------------------
          実機を持ち歩かずに追従の動作を確認できるようにするためのメモ。
          完成時には消してよい部分。
          <details> は、クリックで開閉できるHTMLの標準機能。 */}
      <details className="mt-auto text-xs text-[#1E2A4A]/60">
        <summary className="cursor-pointer">動作確認のしかた（開発用メモ）</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>DevToolsを開く（Cmd + Option + I）</li>
          <li>Cmd + Shift + P →「sensors」と入力 → Show Sensors</li>
          <li>Location を Tokyo などに変更すると、その座標に地図が動く</li>
          <li>Custom で緯度経度を少しずつ変えると、追従の動きが確認できる</li>
        </ol>
      </details>
    </main>
  );
}
