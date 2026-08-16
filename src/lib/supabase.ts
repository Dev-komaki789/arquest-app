/**
 * ============================================================
 * supabase.ts — Supabase（データベース）への接続口
 * ============================================================
 *
 * ■ このファイルはサーバー専用
 *   ここで使う SUPABASE_SECRET_KEY は、RLS（行レベルセキュリティ）を
 *   素通りしてデータベースを全操作できる鍵。
 *   ブラウザに渡ると誰でもデータを読み書きできる状態になる。
 *
 *   画面（"use client" の付いたファイル）からこのファイルを読み込まないこと。
 *   読み込むのは Route Handler（src/app/api/.../route.ts）だけにする。
 *
 * ■ なぜ環境変数に NEXT_PUBLIC_ を付けないのか
 *   Next.js は NEXT_PUBLIC_ で始まる環境変数だけを、ブラウザ側にも配信する。
 *   逆に言えば、付けなければサーバーの中から出ない。
 *   このリポジトリは公開設定なので、鍵が出る経路は塞いでおく。
 *
 * ■ なぜ「使うときに作る」形にしているのか
 *   ファイルを読み込んだ瞬間に接続を作ると、
 *   環境変数が無い環境（例：鍵を登録し忘れた本番）でビルドが落ちる。
 *   使うときに初めて作れば、失敗する場所が「実際に使った1回」に限定され、
 *   原因も分かりやすい。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 作った接続を覚えておく場所。
 *
 * リクエストのたびに作り直すと、そのたびに接続の準備が走って無駄になる。
 * 一度作ったら使い回す。
 */
let client: SupabaseClient | null = null;

/**
 * Supabaseへの接続を返す。
 *
 * 環境変数が設定されていなければ null を返す。
 * 「例外を投げる」ではなく「null を返す」にしているのは、
 * 呼び出し側に代替の道へ進ませたいため（データベースが落ちてもアプリは動く）。
 *
 * ■ いまこの関数を呼んでいる場所は無い
 *   唯一の利用者だったスポット検索のキャッシュ（/api/pois）を、
 *   位置情報の廃止にあわせて削除したため。
 *   秘密キーを使う処理が要るとき（段階6の通知など）のために残してある。
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) return null;

  client = createClient(url, key, {
    auth: {
      // サーバー側で使うので、ログイン状態を保存する仕組みは不要。
      // 有効なままだと、利用者ごとの状態が混ざる原因になる。
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}
