/**
 * ============================================================
 * 日記（写真＋一言メモ）
 * ============================================================
 *
 * ■ 完全に非公開（仕様書§2.10）
 *   共有・いいね・コメントの機能は作らない。作らなければ漏れようがない。
 *   写真は非公開バケットに置き、見るときだけ期限つきのURLを発行する。
 *
 * ■ 写真からEXIF（撮影情報）を必ず消す
 *   スマホで撮った写真には、**撮影した場所の緯度経度**が埋め込まれている。
 *   非公開バケットに置くとはいえ、写真を誰かに送った瞬間に位置が伝わる。
 *   保存する前に消しておけば、その事故が起きようがない。
 *
 *   消し方は「一度キャンバスに描き直す」。
 *   キャンバスが持っているのは点の色だけで、撮影情報を持たない。
 *   そこから書き出したJPEGには、**EXIFが最初から存在しない**。
 *   専用の部品を入れずに済み、消し忘れも起きない。
 *
 *   ただし向きの情報（縦で撮ったか横で撮ったか）もEXIFにあるため、
 *   読み込むときに `imageOrientation: "from-image"` を指定して、
 *   **見た目どおりの向きで**描き直す。これを忘れると写真が倒れる。
 */

import { ensureSignedIn, getBrowserSupabase } from "@/lib/supabase-browser";

/** 写真を置くバケットの名前（schema.sql で作ってある） */
const BUCKET = "diary";

/**
 * 長辺の上限（ピクセル）。
 *
 * スマホの写真は4000px以上あることも珍しくないが、
 * 見返すのは手のひらの画面なので1600もあれば足りる。
 * 無料の保存容量にも限りがあるため、ここで小さくしておく。
 */
const MAX_SIDE = 1600;

export type DiaryEntry = {
  id: string;
  note: string | null;
  photoPath: string | null;
  createdAt: string;
  /** そのとき引いていたお題（無い場合もある） */
  questLabel: string | null;
};

/**
 * 写真からEXIFを取り除き、小さくして返す。
 *
 * 戻ってくるのは新しく作り直したJPEG。元のファイルには一切触れない。
 */
export async function stripExifAndShrink(file: File): Promise<Blob> {
  // 向きの情報を反映して読み込む。
  // これをしないと、縦で撮った写真が横に倒れて保存される。
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("写真を処理できませんでした（キャンバスを用意できません）");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  // 使い終わった画像は明示的に片付ける。大きな写真だと記憶容量を食うため
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("写真を書き出せませんでした"));
      },
      "image/jpeg",
      // 0.85 は見た目がほぼ落ちない範囲で、容量が半分以下になる目安
      0.85,
    );
  });
}

/**
 * 日記を1件保存する。
 *
 * @param photo 撮った写真。無くてもよい（メモだけの日記も許す）
 * @param note  一言メモ
 * @param questId ひもづけるクエスト。無くてもよい
 */
export async function saveDiaryEntry({
  photo,
  note,
  questId,
}: {
  photo: File | null;
  note: string;
  questId?: string | null;
}): Promise<void> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  let photoPath: string | null = null;

  if (photo) {
    // ★ここでEXIFが消える。保存より前に必ず通す
    const cleaned = await stripExifAndShrink(photo);

    // 置き場所は「自分のID / 時刻.jpg」。
    // フォルダ名が自分のIDなので、他人のフォルダには置けない（schema.sql のポリシー）。
    // 名前に時刻を使うのは、同じ日に何枚撮っても衝突しないようにするため。
    photoPath = `${userId}/${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(photoPath, cleaned, { contentType: "image/jpeg" });

    if (uploadError) {
      throw new Error(`写真を保存できませんでした: ${uploadError.message}`);
    }
  }

  const { error } = await supabase.from("diary_entries").insert({
    user_id: userId,
    quest_id: questId ?? null,
    photo_url: photoPath,
    // 空文字は入れず null にしておく。「書かなかった」と「空で書いた」を区別しない
    note: note.trim() === "" ? null : note.trim(),
  });

  if (error) {
    throw new Error(`日記を保存できませんでした: ${error.message}`);
  }
}

/** データベースから返る行の形 */
type DiaryRow = {
  id: string;
  note: string | null;
  photo_url: string | null;
  created_at: string;
  quests: { action_cards: { label: string } | null } | null;
};

/** 日記を新しい順に読む */
export async function listDiaryEntries(limit = 50): Promise<DiaryEntry[]> {
  const userId = await ensureSignedIn();
  const supabase = getBrowserSupabase();

  const { data, error } = await supabase
    .from("diary_entries")
    .select("id, note, photo_url, created_at, quests(action_cards(label))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`日記を読めませんでした: ${error.message}`);

  return ((data ?? []) as unknown as DiaryRow[]).map((row) => ({
    id: row.id,
    note: row.note,
    photoPath: row.photo_url,
    createdAt: row.created_at,
    questLabel: row.quests?.action_cards?.label ?? null,
  }));
}

/**
 * 写真を見るための、期限つきURLを作る。
 *
 * ■ なぜ普通のURLではないのか
 *   バケットが非公開なので、住所を知っていても中身は取れない。
 *   見るたびに「1時間だけ有効な鍵つきURL」を発行して読む。
 *   万一そのURLが漏れても、時間が経てば使えなくなる。
 */
export async function signPhotoUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const supabase = getBrowserSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, 60 * 60);

  if (error) {
    console.error("写真のURLを作れませんでした:", error.message);
    return urls;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** 日記を1件消す（写真も一緒に消す） */
export async function deleteDiaryEntry(entry: DiaryEntry): Promise<void> {
  const supabase = getBrowserSupabase();

  if (entry.photoPath) {
    // 写真を先に消す。
    // 逆順にすると、行だけ消えて写真が置き去りになったとき、
    // どのファイルが余っているのか追えなくなる。
    const { error } = await supabase.storage.from(BUCKET).remove([entry.photoPath]);
    if (error) throw new Error(`写真を消せませんでした: ${error.message}`);
  }

  const { error } = await supabase.from("diary_entries").delete().eq("id", entry.id);
  if (error) throw new Error(`日記を消せませんでした: ${error.message}`);
}
