/**
 * ============================================================
 * 日記を書く（写真＋一言メモ）
 * ============================================================
 *
 * ■ どこから使うか
 *   クエストを達成した直後の画面と、日記の一覧画面。
 *   歩いた直後に書けることが大事なので、別の画面へ飛ばさず、その場で書けるようにする。
 *
 * ■ 写真は「撮る」を優先する
 *   `capture="environment"` を付けると、スマホでは**カメラが直接開く**
 *   （付けないと、まずアルバムの選択画面が出る）。
 *   歩いている最中に開くので、手数は少ないほどよい。
 *   パソコンではこの指定は無視され、ファイル選択になる。
 *
 * ■ 写真は必須にしない
 *   「川柳を詠もう」のように、写真の要らないお題がある。
 *   撮れなかった日もメモだけ残せるほうが、記録が途切れない。
 */

"use client";

import { useCallback, useRef, useState } from "react";

import { saveDiaryEntry, stripExifAndShrink } from "@/lib/diary";

export function DiaryComposer({
  questId,
  onSaved,
  onCancel,
}: {
  questId?: string | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickPhoto = useCallback((file: File | null) => {
    setError(null);
    setPhoto(file);

    // 選び直したときは、前の見本を片付ける。
    // 放っておくと、写真を選ぶたびに記憶容量を使い続ける
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });

    // 見本の段階でEXIFを消してみて、扱えない画像なら先に気づく。
    // 保存ボタンを押してから失敗すると、書いたメモが宙に浮く
    if (file) {
      void stripExifAndShrink(file).catch(() => {
        setError("この写真は読み込めませんでした。別の写真を試してください。");
        setPhoto(null);
      });
    }
  }, []);

  const save = useCallback(() => {
    if (!photo && note.trim() === "") {
      setError("写真か、ひとことメモのどちらかを入れてください。");
      return;
    }

    setBusy(true);
    setError(null);

    saveDiaryEntry({ photo, note, questId })
      .then(() => {
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
        setPhoto(null);
        setNote("");
        onSaved();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  }, [photo, note, questId, onSaved]);

  return (
    <div className="flex w-full flex-col gap-3 aq-card p-4">
      <p className="text-sm font-bold">日記に書く</p>

      {error && (
        <p className="rounded-xl border border-[#D2691E]/40 bg-[var(--gold-pale)] px-3 py-2 text-xs text-[var(--navy)]">
          {error}
        </p>
      )}

      {previewUrl ? (
        <div className="relative">
          {/* 端末の中の写真をそのまま見せるだけなので、
              Next.jsの画像最適化は通さない（通せない）。ここは img でよい */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="選んだ写真"
            className="max-h-64 w-full rounded-xl object-cover"
          />
          <button
            type="button"
            onClick={() => pickPhoto(null)}
            className="absolute right-2 top-2 rounded-full bg-[var(--navy)]/80 px-3 py-1 text-xs text-white"
          >
            消す
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border border-dashed border-[var(--navy)]/25 py-6 text-sm text-[var(--ink)]/70"
        >
          写真を撮る／選ぶ
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => pickPhoto(event.target.files?.[0] ?? null)}
      />

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={300}
        placeholder="ひとこと（なくても大丈夫）"
        className="w-full rounded-xl border border-[var(--navy)]/10 bg-[var(--sky-pale)] px-3 py-2 text-sm text-[var(--navy)] placeholder:text-[var(--ink)]/45"
      />

      <p className="text-xs leading-relaxed text-[var(--ink)]/55">
        誰にも公開されません。
        <br />
        写真にうつっている撮影場所の情報は、保存する前に消しています。
      </p>

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="aq-btn-quiet flex-1 !py-3 !text-sm"
          >
            やめる
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="aq-btn flex-1 !py-3 !text-sm"
        >
          {busy ? "保存中…" : "残す"}
        </button>
      </div>
    </div>
  );
}
