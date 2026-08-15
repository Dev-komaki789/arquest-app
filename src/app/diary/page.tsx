/**
 * ============================================================
 * 日記（/diary）
 * ============================================================
 *
 * ■ 完全に非公開（仕様書§2.10）
 *   共有・いいね・コメントの機能は無い。自分の記録を自分で見返すだけの画面。
 *
 * ■ 写真の見せ方
 *   置き場所が非公開バケットなので、住所を知っていても中身は取れない。
 *   画面を開いたときに、その時点で有効な**期限つきのURL**をまとめて発行する。
 *   1枚ずつ発行すると通信が写真の数だけ増えるので、1回でまとめて頼む。
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DiaryComposer } from "@/components/DiaryComposer";
import {
  deleteDiaryEntry,
  listDiaryEntries,
  signPhotoUrls,
  type DiaryEntry,
} from "@/lib/diary";

/** 「8月15日(金) 21:04」の形にする */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function DiaryPage() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 日記と、写真の期限つきURLをまとめて取ってくる。
   *
   * ここでは画面の状態を触らない。触るのは呼んだ側。
   * こうしておくと、最初の読み込み（useEffect）でも
   * 書いた直後の読み直し（ボタン）でも、同じ関数が使える。
   */
  const fetchEntries = useCallback(async () => {
    const rows = await listDiaryEntries();
    const paths = rows
      .map((row) => row.photoPath)
      .filter((path): path is string => path !== null);
    return { rows, urls: await signPhotoUrls(paths) };
  }, []);

  // 開いたときに読む。
  // 「片付け」を返しているのは、読んでいる途中で画面を離れたときに、
  // すでに消えた画面へ結果を書き込まないようにするため。
  useEffect(() => {
    let alive = true;

    fetchEntries()
      .then(({ rows, urls }) => {
        if (!alive) return;
        setEntries(rows);
        setPhotoUrls(urls);
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
  }, [fetchEntries]);

  /** 書いた後・消した後に読み直す（ボタンから呼ぶ） */
  const reload = useCallback(() => {
    setLoading(true);
    fetchEntries()
      .then(({ rows, urls }) => {
        setEntries(rows);
        setPhotoUrls(urls);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
  }, [fetchEntries]);

  const remove = useCallback(
    (entry: DiaryEntry) => {
      if (!window.confirm("この日記を消しますか。写真も一緒に消えます。")) return;
      deleteDiaryEntry(entry)
        .then(reload)
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    },
    [reload],
  );

  return (
    <main className="min-h-dvh w-full bg-[linear-gradient(180deg,#1B2559_0%,#141C40_100%)] text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 pb-12 pt-7">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest text-[var(--gold)]">
              だれにも見えない記録
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-widest">日記</h1>
          </div>
          <Link href="/" className="text-sm text-white/60 underline">
            もどる
          </Link>
        </header>

        {error && (
          <p className="rounded-xl bg-white px-4 py-3 text-sm text-[var(--navy)]">
            {error}
          </p>
        )}

        {writing ? (
          <DiaryComposer
            onSaved={() => {
              setWriting(false);
              reload();
            }}
            onCancel={() => setWriting(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="rounded-xl bg-[var(--gold)] py-4 text-base font-bold text-[var(--navy)] shadow-[0_4px_0_var(--gold-deep)] active:translate-y-[3px] active:shadow-none"
          >
            あたらしく 書く
          </button>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-white/60">よみこみ中…</p>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm leading-relaxed text-white/50">
            まだ なにもありません。
            <br />
            歩いたときに、見つけたものを のこしてみてください。
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {entries.map((entry) => {
              const url = entry.photoPath ? photoUrls.get(entry.photoPath) : null;
              return (
                <li
                  key={entry.id}
                  className="overflow-hidden rounded-2xl border border-white/15 bg-white/5"
                >
                  {url && (
                    /* 期限つきURLの写真。毎回URLが変わるので最適化は通さない */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt=""
                      className="max-h-72 w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="flex flex-col gap-2 p-4">
                    <p className="text-xs text-white/50">
                      {formatDate(entry.createdAt)}
                    </p>
                    {entry.questLabel && (
                      <p className="text-xs text-[var(--gold)]">
                        {entry.questLabel}
                      </p>
                    )}
                    {entry.note && (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {entry.note}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(entry)}
                      className="self-end text-xs text-white/40 underline"
                    >
                      消す
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
