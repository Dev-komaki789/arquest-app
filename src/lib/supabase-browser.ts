/**
 * ============================================================
 * ブラウザ側からSupabaseに繋ぐ（匿名ログインつき）
 * ============================================================
 *
 * ■ サーバー側の supabase.ts と何が違う？
 *   supabase.ts          … サーバー専用。秘密キーを持ち、RLSを素通りする。
 *                          Overpassの結果をキャッシュするなど、裏方の仕事に使う
 *   supabase-browser.ts  … 画面（ブラウザ）専用。公開用のキーしか持たない。
 *                          「自分の行だけ読み書きできる」はRLSが保証する
 *
 *   秘密キーは絶対にこちらへ持ち込まない。ブラウザに配られたキーは誰でも読めるので、
 *   RLSを素通りできる鍵を渡すと、全員のデータが誰にでも触れる状態になる。
 *
 * ■ 匿名ログインについて
 *   このアプリはログイン画面を作らない（仕様書§3の画面1は匿名利用で置き換え）。
 *   代わりに、初めて開いたときに Supabase が利用者IDを自動で発行する。
 *   メールもパスワードも聞かないだけで、利用者は1人ずつ別々に扱われる。
 *
 *   発行された「鍵」はブラウザの中（localStorage）に保存される。
 *   ブラウザのサイトデータを消すと、記録は残っているのに開けなくなるので、
 *   将来メールを紐づけて引き継げるようにする予定（段階4）。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 接続は1つだけ作って使い回す。
 *
 * 画面が切り替わるたびに作り直すと、そのたびにログイン状態の読み込みが走り、
 * 「一瞬ログインしていない状態」が挟まって画面がちらつく。
 */
let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (cached) return cached;

  // NEXT_PUBLIC_ が付いた環境変数だけがブラウザに配られる。
  // 付いていない SUPABASE_SECRET_KEY はここからは見えない（見えては困る）。
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "接続情報がありません。.env.local に NEXT_PUBLIC_SUPABASE_URL と " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を書いて、開発サーバーを再起動してください。",
    );
  }

  cached = createClient(url, key, {
    auth: {
      // 鍵をブラウザに保存して、次に開いたときも同じ利用者として扱う
      persistSession: true,
      // 期限が切れる前に自動で更新する。これが無いと数時間で書き込めなくなる
      autoRefreshToken: true,
    },
  });

  return cached;
}

/**
 * ログイン済みなら何もせず、まだなら匿名でログインして、利用者IDを返す。
 *
 * 画面のどこからでも最初に呼ぶ。2回目以降は保存された鍵を使うので通信は発生しない。
 */
export async function ensureSignedIn(): Promise<string> {
  const supabase = getBrowserSupabase();

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    return sessionData.session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    // よくある原因が1つに絞れるので、名指しで案内する。
    // Supabaseの画面で匿名ログインをONにしていないと、ここで必ず止まる。
    throw new Error(
      `ログインできませんでした（${error.message}）。` +
        "Supabaseの Authentication → Sign In / Providers で " +
        "「Allow anonymous sign-ins」がONになっているか確認してください。",
    );
  }

  if (!data.user) {
    throw new Error("ログインできましたが、利用者の情報が返りませんでした。");
  }

  return data.user.id;
}
