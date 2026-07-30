/**
 * ============================================================
 * ホーム画面（現在地テスト用）
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
 *   ボタンを押して現在地を取得し、緯度・経度・精度を数値で表示する。
 *   仕様書 8章「実装の推奨順序」の①にあたる動作確認用の画面。
 *   （最終的にはここが「ホーム＝相棒が話しかけてくる画面」になる）
 *
 * ■ 位置情報の処理はここには書かない
 *   取得処理は useGeolocation.ts に分けてある。
 *   この画面は「表示する係」だけを担当する。
 */

// この画面はボタンのクリックに反応し、位置情報（ブラウザの機能）を使うので、
// ブラウザ側で動かす必要がある。そのための宣言。
"use client";

// 自作のカスタムフックを読み込む。
// `@/` は `src/` を指す近道（tsconfig.json の paths で設定済み）。
// これが無いと `../hooks/useGeolocation` のような相対パスを書く必要がある。
import { useGeolocation } from "@/hooks/useGeolocation";

/**
 * 画面の本体。
 * `export default` にしておくと、Next.js がこれをページとして表示してくれる。
 * 関数名（Home）は自由だが、React の部品は大文字で始めるのがルール。
 */
export default function Home() {
  // フックを呼ぶだけで、位置情報に必要な4つが手に入る。
  // { } で囲んで受け取るのは「分割代入」。
  // 返ってきたオブジェクトから、名前を指定して取り出している。
  const { position, error, status, request } = useGeolocation();

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
      {/* 見出し。text-[#1E2A4A] は仕様書 4章のデザイン色（紺）を直接指定している */}
      <h1 className="text-xl font-bold text-[#1E2A4A]">
        アルクエスト — 現在地テスト
      </h1>

      {/* ------------------------------------------------------------
          現在地を取得するボタン
          ------------------------------------------------------------ */}
      <button
        // クリックされたら、フックから受け取った request を実行する。
        // ★ request() ではなく request と書くこと。
        //   ()を付けると「今すぐ実行」になってしまい、
        //   画面を開いた瞬間に位置情報を要求してしまう。
        //   関数そのものを渡すことで「押されたら実行」になる。
        onClick={request}
        // 取得中は二度押しできないようにする（同じ要求が重なるのを防ぐ）
        disabled={status === "requesting"}
        className="rounded-xl bg-[#5B8DEF] px-4 py-3 font-bold text-white active:bg-[#3E6FD8] disabled:opacity-50"
      >
        {/*
          JSXの中で { } を書くと、その中はJavaScriptとして扱われる。
          「条件 ? Aの場合 : Bの場合」は if を1行で書く書き方（三項演算子）。
          状態に応じてボタンの文字を切り替えている。
        */}
        {status === "requesting" ? "取得中…" : "現在地を取得する"}
      </button>

      {/* ------------------------------------------------------------
          エラー表示（エラーがあるときだけ出す）
          ------------------------------------------------------------
          `error && (...)` は「error が中身のあるときだけ右側を表示」という書き方。
          error が null のときは何も表示されない。
          if 文は JSX の中に直接書けないため、この形をよく使う。 */}
      {error && (
        <p className="rounded-xl bg-[#FFF3DE] p-3 text-sm text-[#1E2A4A]">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------
          取得できた位置の表示（取得できたときだけ出す）
          ------------------------------------------------------------
          <dl>/<dt>/<dd> は「項目名と値の組」を表すHTMLタグ。
          単なる <div> より意味が伝わるので、こちらを使っている。
            dl … 定義リスト全体
            dt … 項目名（緯度、経度…）
            dd … その値
          font-mono（等幅フォント）にしているのは、
          数字の桁が揃って読みやすくなるため。 */}
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
            <dt>取得時刻</dt>
            {/* timestamp は 1970年から数えたミリ秒という数値なので、
                new Date(...) で日付に変換し、
                toLocaleTimeString("ja-JP") で日本向けの時刻表記にする。 */}
            <dd>{new Date(position.timestamp).toLocaleTimeString("ja-JP")}</dd>
          </div>
        </dl>
      )}
    </main>
  );
}
