/**
 * ============================================================
 * 日記の詳細（/diary/<id>）
 * ============================================================
 *
 * 一覧で1件を押すとここへ来る。写真を大きく見て、書き直したり消したりできる。
 *
 * ■ 編集はこの画面の中で切り替える
 *   別の画面へ飛ばすと、戻ったときにどこを見ていたか分からなくなる。
 *   同じ場所で入力欄に変わるほうが、書き直してすぐ確かめられる。
 *
 * ■ 消すのは確認してから
 *   写真も一緒に消えて元に戻せないので、必ず一度たずねる。
 */

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDiaryEntry,
  getDiaryEntry,
  signPhotoUrls,
  stripExifAndShrink,
  updateDiaryEntry,
  type DiaryEntry,
} from "@/lib/diary";

/** 「8/15」 */
function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** 「21:04」 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function DiaryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編集中かどうかと、編集中の内容
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [newPhoto, setNewPhoto] = useState<File | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const found = await getDiaryEntry(params.id);
    if (!found) return { found: null, url: null };
    const urls = found.photoPath ? await signPhotoUrls([found.photoPath]) : null;
    return {
      found,
      url: found.photoPath ? (urls?.get(found.photoPath) ?? null) : null,
    };
  }, [params.id]);

  useEffect(() => {
    let alive = true;
    load()
      .then(({ found, url }) => {
        if (!alive) return;
        setEntry(found);
        setPhotoUrl(url);
        setNote(found?.note ?? "");
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const pickPhoto = useCallback((file: File | null) => {
    if (!file) return;
    setError(null);
    setNewPhoto(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    // 扱えない画像なら、保存を押す前に気づけるようにしておく
    void stripExifAndShrink(file).catch(() => {
      setError("この写真は読み込めませんでした。別の写真を試してください。");
      setNewPhoto(null);
      setPreview(null);
    });
  }, []);

  const save = useCallback(() => {
    if (!entry) return;
    setBusy(true);
    setError(null);

    updateDiaryEntry({ entry, note, photo: newPhoto })
      .then(load)
      .then(({ found, url }) => {
        setEntry(found);
        setPhotoUrl(url);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
        setNewPhoto(null);
        setEditing(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  }, [entry, note, newPhoto, load]);

  const remove = useCallback(() => {
    if (!entry) return;
    if (!window.confirm("この日記を消しますか。写真も一緒に消えます。")) return;

    setBusy(true);
    deleteDiaryEntry(entry)
      .then(() => router.push("/diary"))
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
      });
  }, [entry, router]);

  const shownPhoto = preview ?? (newPhoto === "remove" ? null : photoUrl);

  return (
    <main className="min-h-dvh w-full bg-[linear-gradient(180deg,var(--grass-mist)_0%,var(--paper)_40%)] pb-16">
      <header className="rounded-b-[28px] bg-[var(--grass-pale)] px-5 pb-7 pt-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/diary" className="aq-btn-text !w-auto !justify-start !p-0 !text-[var(--grass)]">
            ← 日記帳
          </Link>
          {entry && (
            <>
              <p className="mt-3 text-lg font-bold">
                {formatDay(entry.createdAt)}
                <span className="ml-2 text-sm font-normal text-[var(--ink-muted)]">
                  {formatTime(entry.createdAt)}
                </span>
              </p>
              <h1 className="mt-1 text-[26px] font-bold leading-snug">
                {entry.questLabel ?? "この日の記録"}
              </h1>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-5">
        {error && (
          <p className="aq-card px-4 py-3 text-sm">{error}</p>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-[var(--ink-muted)]">
            読み込み中…
          </p>
        ) : !entry ? (
          <p className="py-16 text-center text-sm text-[var(--ink-muted)]">
            この日記は見つかりませんでした。
          </p>
        ) : (
          <>
            {shownPhoto ? (
              /* 期限つきURLの写真。毎回URLが変わるので最適化は通さない */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={shownPhoto}
                alt=""
                className="w-full rounded-3xl object-cover shadow-[var(--shadow-card)]"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-3xl bg-[var(--grass-mist)] text-3xl">
                📝
              </div>
            )}

            <div className="aq-card px-5 py-5">
              <p className="aq-label">その日のお題</p>
              <p className="mt-2 text-sm font-bold leading-relaxed text-[var(--grass)]">
                {entry.movementLabel ?? "（記録なし）"}
                <span className="mx-2">／</span>
                {entry.questLabel ?? "（記録なし）"}
              </p>

              <hr className="my-4 border-[var(--ink)]/10" />

              {editing ? (
                <>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={5}
                    maxLength={300}
                    placeholder="ひとこと（なくても大丈夫）"
                    className="w-full rounded-xl bg-[var(--grass-mist)] px-3 py-3 text-sm leading-relaxed placeholder:text-[var(--ink-muted)]"
                  />

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="aq-btn-quiet flex-1 !py-3 !text-sm"
                    >
                      写真を選び直す
                    </button>
                    {shownPhoto && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewPhoto("remove");
                          setPreview((old) => {
                            if (old) URL.revokeObjectURL(old);
                            return null;
                          });
                        }}
                        className="aq-btn-quiet flex-1 !py-3 !text-sm"
                      >
                        写真を消す
                      </button>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(event) =>
                      pickPhoto(event.target.files?.[0] ?? null)
                    }
                  />
                </>
              ) : (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {entry.note ?? "（メモなし）"}
                </p>
              )}
            </div>

            {editing ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className="aq-btn"
                >
                  {busy ? "保存中…" : "保存する"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setNote(entry.note ?? "");
                    setNewPhoto(null);
                    setPreview((old) => {
                      if (old) URL.revokeObjectURL(old);
                      return null;
                    });
                  }}
                  disabled={busy}
                  className="aq-btn-quiet"
                >
                  やめる
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="aq-btn-quiet flex-1"
                  >
                    <span aria-hidden="true" className="mr-2">
                      ✏️
                    </span>
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="aq-btn-quiet flex-1 !text-[#C0453A]"
                  >
                    <span aria-hidden="true" className="mr-2">
                      🗑
                    </span>
                    削除
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/diary")}
                  className="aq-btn mt-2"
                >
                  日記帳へ戻る
                </button>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
