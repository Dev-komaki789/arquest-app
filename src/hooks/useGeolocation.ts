/**
 * ============================================================
 * useGeolocation — 現在地を取得し、移動に追従するカスタムフック
 * ============================================================
 *
 * ■ このファイルは何をするもの？
 *   ブラウザに「今どこにいる？」と聞いて、緯度・経度を教えてもらう処理をまとめたもの。
 *   一度きりの取得ではなく、位置が変わるたびに自動で教えてもらう「追従」を行う。
 *
 * ■ 「カスタムフック」とは？
 *   React で使い回したい処理を、関数として切り出したもの。
 *   名前を必ず「use」で始めるのがルール（例: useState、useGeolocation）。
 *   画面（page.tsx）側は中身を知らなくても、1行呼ぶだけで位置情報が使えるようになる。
 *
 * ■ getCurrentPosition と watchPosition の違い（このファイルの要点）
 *   getCurrentPosition … 今の位置を1回だけ教えてくれる
 *   watchPosition      … 位置が変わるたびに、何度も教えてくれる（追従）
 *
 *   このアプリは歩いた軌跡と距離を記録する必要があるため
 *   （仕様書 2.7。行動カードを引いた後の区間）、watchPosition を使う。
 *
 * ■ 追従には必ず後片付けが要る
 *   watchPosition は、止めるまでずっと位置を測り続ける。
 *   放置すると画面を離れてもGPSが回り続け、利用者の電池を消耗させてしまう。
 *   そのため clearWatch で止める処理を必ず用意する。
 */

// "use client" = このファイルはブラウザ側で動く、という宣言。
// Next.js は何も書かないとサーバー側でコードを動かそうとするが、
// 位置情報はブラウザ（利用者の端末）にしか無い機能なので、この宣言が必須。
"use client";

// React が用意している道具（フック）を読み込む。
//   useState    … 値を記憶して、変わったら画面を描き直してくれる箱
//   useCallback … 関数を毎回作り直さないようにする
//   useEffect   … 後片付けなど「表示の前後で行う処理」を書く場所
//   useRef      … 画面の描き直しとは無関係に値を覚えておく箱
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 取得した位置情報の「型」。
 * TypeScript ではデータの形をあらかじめ決めておける。
 * こうすると position.latitude のような打ち間違いを、
 * 実行する前にエディタが赤線で教えてくれる。
 *
 * `export` を付けているので、他のファイルからも import して使える。
 */
export type GeoPosition = {
  lat: number; // 緯度（latitude）。日本だと 35 くらいの数値
  lng: number; // 経度（longitude）。日本だと 139 くらいの数値
  accuracy: number; // 精度＝誤差の半径（メートル）。50なら「半径50m以内のどこか」という意味
  timestamp: number; // 取得した時刻（1970年から数えたミリ秒。数値のまま持っておく）
};

/**
 * 今どういう状態かを表す型。
 * 「|」は「このうちのどれか1つ」という意味（ユニオン型と呼ぶ）。
 * 文字列を直接書くので、"trackng" のようなタイプミスもエディタが弾いてくれる。
 *
 *   idle       … まだ何もしていない（ボタンを押す前）／停止した後
 *   requesting … 取得中（許可ダイアログが出ている最中など）
 *   tracking   … 追従中（位置が変わるたびに更新されている）
 *   error      … 失敗した
 */
export type GeoStatus = "idle" | "requesting" | "tracking" | "error";

/**
 * エラー番号を、日本語のメッセージに翻訳するための対応表。
 *
 * ブラウザは失敗した理由を「1」「2」「3」という数字で返してくる。
 * 数字のままでは利用者に見せられないので、ここで人間の言葉に置き換える。
 *
 * `Record<number, string>` = 「数字をキーにして、文字列を取り出せる表」という型。
 */
const ERROR_MESSAGES: Record<number, string> = {
  // 1 = PERMISSION_DENIED は、案内先がOSごとに違うので下の関数で組み立てる。
  // 2 = POSITION_UNAVAILABLE（電波やGPSの状態で測位できなかった）
  2: "位置を取得できませんでした。Wi-FiやGPSの状態を確認してください。",
  // 3 = TIMEOUT（時間内に返ってこなかった）
  3: "位置の取得に時間がかかりすぎました。もう一度お試しください。",
};

/**
 * 「許可されなかった」ときの案内文を、使っているOSに合わせて組み立てる。
 *
 * ■ なぜOSごとに分けるのか
 *   位置情報は「ブラウザの許可」と「OS本体の許可」の二段階になっていて、
 *   どちらか一方でも切れていると失敗する。
 *   そしてOS側の設定画面の名前は、OSごとにまったく違う。
 *   「システム設定 → プライバシーとセキュリティ」と案内されても、
 *   Windowsの利用者はその画面を見つけられない。
 *
 * ■ 以前はMac決め打ちだった
 *   開発をMacで始めたため、Macの手順を直接書いていた。
 *   実際にWindowsで動かしたところ、存在しない設定画面を案内してしまった。
 *   このアプリは仕様書§2.1のとおりiPhone・AndroidにPWAとして入れて使うものなので、
 *   利用者のOSはMacとは限らない。
 *
 * ■ 判定に navigator.userAgent を使っている理由
 *   より新しい navigator.userAgentData という手段もあるが、
 *   対応していないブラウザ（Safari・Firefox）がある。
 *   ここは案内文の出し分けなので、外しても実害は「案内が一般的な文になる」だけ。
 *   確実に全ブラウザで読める userAgent で十分。
 */
function permissionDeniedMessage(): string {
  const ua = navigator.userAgent;

  // OSごとの設定画面の場所。分からなければ一般的な言い方にする。
  let osHint: string;
  if (/iPhone|iPad|iPod/.test(ua)) {
    osHint = "iPhoneの「設定 → プライバシーとセキュリティ → 位置情報サービス」";
  } else if (/Android/.test(ua)) {
    osHint = "端末の「設定 → 位置情報」";
  } else if (/Windows/.test(ua)) {
    osHint = "Windowsの「設定 → プライバシーとセキュリティ → 位置情報」";
  } else if (/Mac/.test(ua)) {
    osHint = "Macの「システム設定 → プライバシーとセキュリティ → 位置情報サービス」";
  } else {
    osHint = "お使いのOSの位置情報の設定";
  }

  return `位置情報が許可されませんでした。ブラウザのアドレスバーにある鍵アイコンから位置情報を「許可」にし、${osHint}も有効になっているか確認してください。`;
}

/**
 * 位置情報の取得方法のオプション。
 * 3つとも意味があるので消さないこと。
 */
const GEO_OPTIONS: PositionOptions = {
  // GPSなど高精度な手段を使う。電池は食うが、
  // 歩いた距離を記録に残すので精度が要る（誤差がそのまま距離に化ける）。
  enableHighAccuracy: true,

  // 15秒待って返ってこなければ諦める（`15_000` は 15000 と同じ。読みやすさのための区切り）。
  // 無制限にすると、画面が「取得中…」のまま永久に固まってしまう。
  timeout: 15_000,

  // 保存済みの古い位置を使わせない設定。
  // 古い座標で「到着した」と判定されると困るので 0（＝キャッシュ禁止）にする。
  maximumAge: 0,
};

/**
 * 本体。画面側では次のように使う。
 *
 *   const { position, error, status, start, stop } = useGeolocation();
 *
 * 返ってくるもの:
 *   position … 最新の位置（まだ取得していなければ null）
 *   error    … エラーメッセージ（無ければ null）
 *   status   … 今の状態（ボタンの文字や色を変えるのに使う）
 *   start    … 追従を開始する関数（ボタンの onClick に渡す）
 *   stop     … 追従を停止する関数
 */
/**
 * useGeolocation に渡せる設定。
 * `?` が付いているものは省略できる。
 */
type Options = {
  /**
   * 位置がひとつ届くたびに呼ばれる関数。
   *
   * 「位置が届いた瞬間にやりたいこと」を外から差し込むための仕組み。
   * 今は歩いた軌跡の記録（useWalkTrail の record）を渡している。
   *
   * ■ なぜこの形にするのか
   *   画面側で「position が変わったら記録する」と useEffect で書くこともできるが、
   *   それだと「描画 → 効果 → state更新 → また描画」という連鎖が起きて無駄が出る。
   *   位置が届くのは出来事（イベント）なので、届いたその場で処理するのが素直。
   */
  onPosition?: (position: GeoPosition) => void;
};

export function useGeolocation(options: Options = {}) {
  // ------------------------------------------------------------
  // useState で「状態」を3つ用意する
  // ------------------------------------------------------------
  // useState の書き方: const [今の値, 値を変える関数] = useState(最初の値)
  //
  // ポイント: ただの変数（let position = null）ではダメ。
  // useState で作った値を変えたときだけ、React が画面を描き直してくれる。

  // 最新の位置。最初はまだ無いので null。
  // <GeoPosition | null> は「GeoPosition か null のどちらかが入る」という指定。
  const [position, setPosition] = useState<GeoPosition | null>(null);

  // エラーメッセージ。問題が無いときは null。
  const [error, setError] = useState<string | null>(null);

  // 今の状態。最初は「まだ何もしていない」。
  const [status, setStatus] = useState<GeoStatus>("idle");

  // ------------------------------------------------------------
  // 追従を止めるための「番号」を覚えておく箱
  // ------------------------------------------------------------
  // watchPosition を呼ぶと、見張りごとに番号（ID）が返ってくる。
  // 止めるときは clearWatch(その番号) と指定する必要があるため、覚えておく。
  //
  // useState ではなく useRef を使う理由:
  //   この番号は画面に表示するものではない。
  //   useState に入れると値を変えるたびに画面が描き直されて無駄になる。
  //   useRef は「変えても画面が描き直されない箱」なので、こちらが適切。
  //   中身の読み書きには `.current` を付ける。
  const watchIdRef = useRef<number | null>(null);

  // ------------------------------------------------------------
  // 「位置が届いたときに呼ぶ関数」を箱に入れておく
  // ------------------------------------------------------------
  // なぜ箱（useRef）に入れるのか:
  //   下の start は useCallback で「作り直さない」ようにしてある。
  //   その中から options.onPosition を直接読むと、
  //   最初に渡された古い関数を掴んだままになってしまう。
  //   箱を経由して常に最新を読むことで、この食い違いを防ぐ。
  //
  // 箱の中身を入れ替えるのは useEffect の中で行う。
  // 画面を組み立てている最中（描画中）に箱を書き換えると、
  // Reactが変化を追えなくなるため禁止されている。
  const onPositionRef = useRef(options.onPosition);
  useEffect(() => {
    onPositionRef.current = options.onPosition;
  }, [options.onPosition]);

  // ------------------------------------------------------------
  // 追従を停止する
  // ------------------------------------------------------------
  const stop = useCallback(() => {
    // まだ見張っていなければ何もしない
    if (watchIdRef.current === null) return;

    // 見張りを解除する（これでGPSが止まり、電池の消耗も止まる）
    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;

    // 状態を「何もしていない」に戻す。
    // ここで position は消さない。直前まで居た場所を画面に残したままにして、
    // 「止めたら地図が消えた」という分かりにくい挙動を避ける。
    setStatus("idle");
  }, []);

  // ------------------------------------------------------------
  // 追従を開始する
  // ------------------------------------------------------------
  // useCallback で包む理由:
  //   React は状態が変わるたびに、この useGeolocation を丸ごと再実行する。
  //   普通に書くと start 関数が毎回「別物」として作り直されてしまう。
  //   useCallback で包むと同じ関数を使い回してくれるので、無駄な再描画が減る。
  //
  // ★重要★ この関数は必ずボタンのクリックなど「利用者の操作」から呼ぶこと。
  //   画面を開いた瞬間に自動で呼ぶと、iPhone の Safari では
  //   許可ダイアログが表示されないことがある（仕様書 5章の注意点）。
  const start = useCallback(() => {
    // --- 事前チェック：そもそも位置情報が使える環境か？ ---
    // 古いブラウザや特殊な環境では navigator.geolocation が存在しない。
    // 無いのに呼ぶとアプリが落ちるので、先に確認して丁寧に終わらせる。
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError("このブラウザは位置情報に対応していません。");
      return; // ここで処理を打ち切る
    }

    // すでに追従中なら、二重に見張らないよう一度止める。
    // （見張りが二重になると電池を無駄に食い、更新も乱れる）
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // --- 取得開始。画面を「取得中…」の見た目にする ---
    setStatus("requesting");
    setError(null); // 前回のエラーが残っていたら消す

    /**
     * 位置が変わるたびに教えてもらうよう、ブラウザに見張りを頼む。
     *
     * 注意: この関数は「答えを待たずにすぐ次へ進む」（非同期処理という）。
     *       だから「成功したら実行してほしい処理」と「失敗したら実行してほしい処理」を
     *       あらかじめ関数の形で渡しておく。これをコールバックと呼ぶ。
     *
     * 引数は3つ:
     *   第1引数: 位置が分かるたびに呼ばれる関数（何度も呼ばれる）
     *   第2引数: 失敗したときに呼ばれる関数
     *   第3引数: 取得方法のオプション
     *
     * 戻り値は見張りの番号。停止に必要なので箱にしまう。
     */
    watchIdRef.current = navigator.geolocation.watchPosition(
      // --- 位置が分かったとき。pos にブラウザからの答えが入ってくる ---
      (pos) => {
        // ブラウザ側の名前は latitude / longitude と長いので、
        // アプリ内では lat / lng という短い名前に詰め替えておく。
        const next: GeoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };

        setPosition(next);
        setStatus("tracking");
        setError(null);

        // 位置が届いたその場で、外から渡された処理を実行する。
        // `?.` は「渡されていなければ何もしない」という書き方。
        onPositionRef.current?.(next);
      },

      /**
       * --- 失敗したとき。err.code に 1 / 2 / 3 のどれかが入る ---
       *
       * ★重要な設計判断★ エラーの種類で扱いを変える。
       *
       * watchPosition は「1回失敗しても見張りは続く」仕様。
       * ここで毎回 clearWatch すると、実際の利用でひどいことになる。
       *   ・トンネルや地下に入った
       *   ・ビルの谷間で一瞬GPSを見失った
       *   ・DevToolsで座標を切り替えた
       * こうした一時的な失敗は歩いていれば普通に起きるもので、
       * そのたびに追従が止まったら、ミッション中に現在地を見失ってしまう。
       *
       * そこで、
       *   許可されていない（code 1） … 利用者が設定を変えない限り絶対に成功しない
       *                                 → 見張りを止めて、状態も error にする
       *   一時的な失敗（code 2 / 3） … 待てば直る可能性が高い
       *                                 → 見張りは続けたまま、お知らせだけ出す
       * と分けている。次に位置が取れた時点で、お知らせは自動的に消える
       * （成功時に setError(null) しているため）。
       */
      (err) => {
        // 許可されなかった場合だけ、案内先がOSごとに違うので専用の関数で組み立てる。
        // `??` は「左が null や undefined なら右を使う」という意味。
        // 表に無い番号が来ても画面が空白にならないよう、保険として元のメッセージを出す。
        setError(
          err.code === err.PERMISSION_DENIED
            ? permissionDeniedMessage()
            : (ERROR_MESSAGES[err.code] ?? err.message),
        );

        // 許可されなかった場合だけ、見張りを止めて「エラー」状態にする。
        // err.PERMISSION_DENIED は 1 のこと。数字を直接書くより意味が伝わる。
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("error");
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        }
        // code 2（測位できない）・code 3（時間切れ）のときは、ここで何もしない。
        // status は "requesting" や "tracking" のままなので追従は継続し、
        // 電波が回復すれば自動的に位置の更新が再開される。
      },

      GEO_OPTIONS,
    );
  }, []);

  // ------------------------------------------------------------
  // 後片付け（このフックを使っている画面が閉じられたとき）
  // ------------------------------------------------------------
  // useEffect の中で return した関数は「後片付け」として実行される。
  // 条件が [] なので、実行されるのは画面が閉じられる（部品が消える）ときだけ。
  //
  // これを書かないと、別の画面へ移動した後もGPSが回り続けてしまう。
  // 「止め忘れ」は位置情報を扱うアプリで最も多いバグのひとつ。
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // ------------------------------------------------------------
  // 画面側に渡すものをまとめて返す
  // ------------------------------------------------------------
  // オブジェクト（{ }）で返しておくと、受け取る側が
  // 必要なものだけ名前を指定して取り出せる。
  return { position, error, status, start, stop };
}
