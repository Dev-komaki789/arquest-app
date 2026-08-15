/**
 * ============================================================
 * ホーム画面に出す、自分の記録
 * ============================================================
 *
 * ■ 何を出すか（モックアップ screen-shot/02-home.png の構成）
 *   レベル・EXP・きょう歩いた距離・達成したクエスト数・次の稼働時間。
 *
 * ■ 「連続◯日」は出さない（仕様書§10）
 *   モックアップには「連続 12日」があるが、不採用にしている。
 *   雨の日など出かけなくて当然の日で途切れ、罰のように働くため。
 *   代わりに、途切れても減らない数（累計の距離・達成数）を置く。
 */

import { ensureSignedIn, getBrowserSupabase } from "@/lib/supabase-browser";

/** レベルが1つ上がるのに必要なEXP（complete_quest と同じ値） */
export const EXP_PER_LEVEL = 500;

export type Profile = {
  level: number;
  exp: number;
  /** いまのレベルの中で、どこまで進んだか（0〜EXP_PER_LEVEL） */
  expInLevel: number;
  totalDistanceM: number;
  /** きょう歩いた距離 */
  todayDistanceM: number;
  /** これまでに終えたクエストの数 */
  questsDone: number;
  /** 次にクエストを受けられる時間帯（設定してあれば） */
  nextWindow: { label: string; start: string } | null;
};

/** "18:00:00" → "18:00" */
function trimSeconds(time: string): string {
  return time.slice(0, 5);
}

export async function loadProfile(): Promise<Profile> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const today = new Date();
  // その日のうちに閉じた記録を見たいので、端末の日付をそのまま使う
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [me, todayStat, doneCount, settings] = await Promise.all([
    supabase
      .from("users")
      .select("companion_level, companion_exp, total_distance_m")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("daily_activity_stats")
      .select("distance_m")
      .eq("user_id", userId)
      .eq("activity_date", todayKey)
      .maybeSingle(),
    // head: true は「中身は要らない、件数だけ数えて」という指定。
    // 結果（できた／まだ）が入っているものだけ数える。
    // 途中でやめたクエストも状態は done になるが、それは数えない
    supabase
      .from("quests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "done")
      .not("action_result", "is", null),
    supabase
      .from("user_settings")
      .select("weekday_start, weekend_start")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const exp = me.data?.companion_exp ?? 0;

  // 平日か休日かで、次に動ける時間帯が変わる（仕様書§2.1）
  const weekend = [0, 6].includes(today.getDay());
  const start = weekend
    ? settings.data?.weekend_start
    : settings.data?.weekday_start;

  return {
    level: me.data?.companion_level ?? 1,
    exp,
    expInLevel: exp % EXP_PER_LEVEL,
    totalDistanceM: me.data?.total_distance_m ?? 0,
    todayDistanceM: todayStat.data?.distance_m ?? 0,
    questsDone: doneCount.count ?? 0,
    nextWindow: start
      ? { label: weekend ? "休日の時間帯" : "平日の時間帯", start: trimSeconds(start) }
      : null,
  };
}
