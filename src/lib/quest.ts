/**
 * ============================================================
 * クエスト（1回分の遊び）の読み書き
 * ============================================================
 *
 * ■ 遊びの流れ（仕様書§2.2・§2.3・§2.5）
 *   ① 移動カードを1枚引く   … 出発前。座標には一切紐付かない曖昧な指示
 *   ② 移動する               … 位置情報は使わない。行き先の正解は存在しない
 *   ③「着いた」を自分で押す   … GPSでは判定しない（仕様書§2.5）
 *   ④ 行動カードを1枚引く    … ここで初めてお題が判明する。2回まで引き直せる
 *   ⑤「できた／まだ」を申告   … どちらでも記録は残る
 *
 * ■ なぜ「引く」が2回に分かれているのか
 *   出発前に両方引くと、家を出る時点で全部わかってしまい驚きが消える。
 *   到着後に引けば「着くまで何をするか分からない」が保てる。
 *   伏せているのではなく、**まだ存在しない**ので実装も単純になる。
 *
 * ■ この段階では位置情報を一切使わない
 *   軌跡と距離の記録（仕様書§2.7）は行動カードを引いた後から始まるが、
 *   それは次の段階で足す。ここまでは位置情報なしで最初から最後まで遊べる。
 */

import { ensureSignedIn, getBrowserSupabase } from "@/lib/supabase-browser";

/** 行動カードを引き直せる回数の上限（仕様書§2.3） */
export const MAX_REDRAW = 2;

export type TransportMode = "walk_only" | "transit_ok";
export type QuestStatus = "moving" | "acting" | "done";
export type ActionResult = "done" | "not_yet";

export type MovementCard = {
  id: string;
  label: string;
  transportMode: TransportMode;
};

export type ActionCard = {
  id: string;
  label: string;
  involvesSpending: boolean;
  requiresPhoto: boolean;
};

export type Quest = {
  id: string;
  status: QuestStatus;
  redrawCount: number;
  /** 引いた時刻。移動中の「経過時間」の起点になる */
  createdAt: string;
  movementCard: MovementCard;
  actionCard: ActionCard | null;
  actionResult: ActionResult | null;
};

/**
 * きょうは休日か。
 *
 * 休日だけ、電車・バスを使う移動カードが候補に入る（仕様書§2.2）。
 * 平日は使える時間が短いことが多く、交通機関の指示だと
 * 時間内に終わらない・遅い時間に遠方から帰ることになりかねないため。
 *
 * 端末の時計をそのまま使う。日付が変わる境目を厳密に決めていないので、
 * 深夜に引いたときの扱いは「その時点の曜日」になる（仕様書§9の未決事項）。
 */
export function isWeekend(now: Date = new Date()): boolean {
  const day = now.getDay(); // 0=日曜, 6=土曜
  return day === 0 || day === 6;
}

/** 配列から1つ選ぶ。空なら null */
function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * データベースから返る行の形。
 *
 * 結合したカードは、Supabaseでは入れ子のオブジェクトとして返ってくる。
 * （quests から見て movement_cards は1対1なので、配列ではなく単体になる）
 */
type QuestRow = {
  id: string;
  status: QuestStatus;
  action_redraw_count: number;
  action_result: ActionResult | null;
  created_at: string;
  movement_cards: {
    id: string;
    label: string;
    transport_mode: TransportMode;
  };
  action_cards: {
    id: string;
    label: string;
    involves_spending: boolean;
    requires_photo: boolean;
  } | null;
};

/** 結合つきで取り出すときの列の指定。3か所で同じものを使うのでまとめておく */
const QUEST_SELECT =
  "id, status, action_redraw_count, action_result, created_at, " +
  "movement_cards(id, label, transport_mode), " +
  "action_cards(id, label, involves_spending, requires_photo)";

/** データベースの行を、画面で使う形に直す */
function rowToQuest(row: QuestRow): Quest {
  return {
    id: row.id,
    status: row.status,
    redrawCount: row.action_redraw_count,
    actionResult: row.action_result,
    createdAt: row.created_at,
    movementCard: {
      id: row.movement_cards.id,
      label: row.movement_cards.label,
      transportMode: row.movement_cards.transport_mode,
    },
    actionCard: row.action_cards
      ? {
          id: row.action_cards.id,
          label: row.action_cards.label,
          involvesSpending: row.action_cards.involves_spending,
          requiresPhoto: row.action_cards.requires_photo,
        }
      : null,
  };
}

/**
 * 途中のクエストがあれば取り出す（仕様書§2.6）。
 *
 * アプリを閉じても、移動中・行動中のクエストはデータベースに残っている。
 * 次に開いたときはここから復帰するので、画面の状態をブラウザに覚えさせる必要がない。
 */
export async function findActiveQuest(): Promise<Quest | null> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const { data, error } = await supabase
    .from("quests")
    .select(QUEST_SELECT)
    .eq("user_id", userId)
    .in("status", ["moving", "acting"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`途中のクエストを読めませんでした: ${error.message}`);
  if (!data) return null;

  return rowToQuest(data as unknown as QuestRow);
}

/**
 * 移動カードを1枚引いて、クエストを始める。
 *
 * ■ 引いた瞬間にデータベースへ書く理由（仕様書§2.6）
 *   画面の中だけに置くと、アプリを閉じた時点で「何を引いたか」が消える。
 *   30分歩いている間にブラウザが裏で終了させられることは普通にあるので、
 *   引いた瞬間に記録して、開き直したら続きから戻れるようにする。
 */
export async function drawMovementCard(): Promise<Quest> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const cards = await loadMovementCards();

  // 抽選は画面側で行う。
  // ここで不正をしても損をするのは自分だけなので、サーバーに任せる理由がない
  // （一人用のアプリなので、仕様書§2.3の「引き直しの制限」も同じ考え方）。
  const picked = pickRandom(cards ?? []);
  if (!picked) {
    throw new Error(
      "引ける移動カードがありませんでした。schema.sql のカード投入が終わっているか確認してください。",
    );
  }

  const { data, error } = await supabase
    .from("quests")
    .insert({ user_id: userId, movement_card_id: picked.id })
    .select(QUEST_SELECT)
    .single();

  if (error) {
    // 進行中のクエストは1人1件までにしてある（schema.sql の部分ユニーク索引）。
    // 23505 は「重複」を表す番号。二重に引こうとしたときここに来る。
    if (error.code === "23505") {
      throw new Error("すでに進行中のクエストがあります。画面を開き直してください。");
    }
    throw new Error(`クエストを始められませんでした: ${error.message}`);
  }

  return rowToQuest(data as unknown as QuestRow);
}

/**
 * きょう引ける移動カードを読む。
 *
 * 平日は徒歩のみ、休日は交通機関ありも候補に入る（仕様書§2.2）。
 * 抽選に使うほか、**ルーレットに流す文面**としても使う。
 */
let cachedMovementCards: MovementCard[] | null = null;

export async function loadMovementCards(): Promise<MovementCard[]> {
  if (cachedMovementCards) return cachedMovementCards;

  const modes: TransportMode[] = isWeekend()
    ? ["walk_only", "transit_ok"]
    : ["walk_only"];

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("movement_cards")
    .select("id, label, transport_mode")
    .eq("is_active", true)
    .in("transport_mode", modes);

  if (error) throw new Error(`移動カードを読めませんでした: ${error.message}`);

  cachedMovementCards = (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    transportMode: row.transport_mode as TransportMode,
  }));

  return cachedMovementCards;
}

/**
 * 行動カードを全件読む。
 *
 * 引き直しのたびに問い合わせると、歩いている最中に通信が増える。
 * 60枚で数KBしかないので、最初に全部持っておいて画面側で選ぶ（仕様書§2.3）。
 */
let cachedActionCards: ActionCard[] | null = null;

export async function loadActionCards(): Promise<ActionCard[]> {
  if (cachedActionCards) return cachedActionCards;

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("action_cards")
    .select("id, label, involves_spending, requires_photo")
    .eq("is_active", true);

  if (error) throw new Error(`行動カードを読めませんでした: ${error.message}`);

  cachedActionCards = (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    involvesSpending: row.involves_spending,
    requiresPhoto: row.requires_photo,
  }));

  return cachedActionCards;
}

/**
 * 「着いた」を押したときの処理。行動カードを1枚引く。
 *
 * ここから先が仕様書§2.7の記録区間になる（軌跡は次の段階で足す）。
 */
export async function drawActionCard(questId: string): Promise<Quest> {
  const cards = await loadActionCards();
  const picked = pickRandom(cards);
  if (!picked) throw new Error("引ける行動カードがありませんでした。");

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("quests")
    .update({
      action_card_id: picked.id,
      status: "acting",
      action_started_at: new Date().toISOString(),
    })
    .eq("id", questId)
    .select(QUEST_SELECT)
    .single();

  if (error) throw new Error(`行動カードを引けませんでした: ${error.message}`);

  return rowToQuest(data as unknown as QuestRow);
}

/**
 * 行動カードを引き直す（2回まで）。
 *
 * ■ なぜ回数を制限するのか
 *   明らかに実行できないお題（店が無い場所で「買おう」など）が出たときの救済措置。
 *   無制限にすると、簡単なお題だけを選べる抜け道になる。
 *
 * ■ なぜ移動カードは引き直せないのか
 *   行き先からは逃げない、というのがこの遊びの前提だから（仕様書§2.3）。
 */
export async function redrawActionCard(quest: Quest): Promise<Quest> {
  if (quest.redrawCount >= MAX_REDRAW) {
    throw new Error("引き直せる回数を使い切りました。");
  }

  const cards = await loadActionCards();

  // いま出ているカードは候補から外す。
  // 引き直したのに同じ文面が出ると、回数だけ減って何も起きていないように見える。
  const others = cards.filter((card) => card.id !== quest.actionCard?.id);
  const picked = pickRandom(others.length > 0 ? others : cards);
  if (!picked) throw new Error("引ける行動カードがありませんでした。");

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("quests")
    .update({
      action_card_id: picked.id,
      action_redraw_count: quest.redrawCount + 1,
    })
    .eq("id", quest.id)
    .select(QUEST_SELECT)
    .single();

  if (error) throw new Error(`引き直せませんでした: ${error.message}`);

  return rowToQuest(data as unknown as QuestRow);
}

/**
 * 引いたクエストをやめる。
 *
 * ■ なぜ「やめる」を用意するのか（仕様書§1）
 *   気分でないときはパスしてよい、というのがこの遊びの前提。
 *   引いたら最後までやらせる作りにすると、次に開くのが億劫になる。
 *
 * ■ 消さずに「終わり」にする
 *   行を消す作りにしていたが、消すには別の権限が要り、
 *   権限を渡し忘れると「やめられません」で止まる（実際に起きた）。
 *   状態を done にして結果を空のままにすれば、更新の権限だけで足りる。
 *
 *   結果が空の行は「やった／やらなかった」のどちらでもないので、
 *   達成した回数には数えない（profile.ts）。
 *   パスが失敗として記録されることはない。
 */
export async function cancelQuest(questId: string): Promise<void> {
  const supabase = getBrowserSupabase();

  const { error } = await supabase
    .from("quests")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", questId);

  if (error) throw new Error(`やめられませんでした: ${error.message}`);
}

/** 終わったときにもらえるもの */
export type QuestReward = {
  /** 今回もらったEXP */
  expGained: number;
  /** 通算のEXPとレベル */
  companionExp: number;
  companionLevel: number;
};

/**
 * 「できた／まだ」を申告して終わる。
 *
 * ■「まだ」でも終わりにする理由（仕様書§2.5）
 *   できなかったことを咎めない設計なので、「まだ」も立派な結末として記録する。
 *   来たこと自体は残るし、EXPも0にはならない。
 *
 * ■ まとめて1回で頼む理由
 *   終了時にやることが2つある（クエストの更新／EXP）。
 *   画面から2回に分けて頼むと、途中で通信が切れたときに
 *   「終わったのにEXPが増えていない」という半端な状態が残る。
 *   データベース側の complete_quest にまとめてあるので、ここは1回呼ぶだけ。
 *
 * ■ 距離と完了地点は渡さない（位置情報を廃止したため）
 *   complete_quest 側の p_distance_m / p_lat / p_lng には既定値があるので、
 *   渡さなければ距離0・地図を塗らない、として扱われる。
 *   EXPは「できた20／まだ10」の固定になり、距離による加算は無くなった。
 */
export async function finishQuest(
  questId: string,
  result: ActionResult,
): Promise<{ quest: Quest; reward: QuestReward }> {
  const supabase = getBrowserSupabase();

  const { data: rewardRows, error } = await supabase.rpc("complete_quest", {
    p_quest_id: questId,
    p_result: result,
  });

  if (error) throw new Error(`終わりにできませんでした: ${error.message}`);

  // 関数は表の形（1行）で返ってくる
  const row = (rewardRows ?? [])[0];

  const { data: questRow, error: readError } = await supabase
    .from("quests")
    .select(QUEST_SELECT)
    .eq("id", questId)
    .single();

  if (readError) {
    throw new Error(`結果を読めませんでした: ${readError.message}`);
  }

  return {
    quest: rowToQuest(questRow as unknown as QuestRow),
    reward: {
      // 関数の戻り値の名前は、テーブルの列名と重ならないものにしてある
      // （同じにすると「どちらの列か分からない」とデータベースに怒られる）
      expGained: row?.exp_gained ?? 0,
      companionExp: row?.total_exp ?? 0,
      companionLevel: row?.level_now ?? 1,
    },
  };
}
