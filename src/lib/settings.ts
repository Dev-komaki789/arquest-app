/**
 * ============================================================
 * 利用者の設定
 * ============================================================
 *
 * いまのところ持っているのは1つだけ。
 *
 *   show_walking_info … 移動中に、経過時間・歩いた距離・通り道のスポットを出すか
 *
 * ■ 既定はオフ（仕様書§2.4）
 *   オンにすると、**移動中も位置情報が動く**ことになる。
 *   このアプリは「移動中は位置情報を使わない」を主張として持っているので、
 *   賑やかさが欲しい人が自分でオンにする、という形にする。
 *
 *   なお、オンにしても**軌跡の記録は始まらない**。
 *   記録はこれまでどおり行動カードを引いた後から（§2.7）。
 *   位置はスポットを探すためだけに使い、その場で捨てる。
 */

import { ensureSignedIn, getBrowserSupabase } from "@/lib/supabase-browser";

export type UserSettings = {
  showWalkingInfo: boolean;
};

export async function loadSettings(): Promise<UserSettings> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const { data, error } = await supabase
    .from("user_settings")
    .select("show_walking_info")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`設定を読めませんでした: ${error.message}`);

  // 行がまだ無い場合（登録直後など）は、既定のオフとして扱う
  return { showWalkingInfo: data?.show_walking_info ?? false };
}

export async function setShowWalkingInfo(value: boolean): Promise<void> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const { error } = await supabase
    .from("user_settings")
    .update({ show_walking_info: value, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) throw new Error(`設定を保存できませんでした: ${error.message}`);
}
