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

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { DiaryComposer } from "@/components/DiaryComposer";
import { TabBar } from "@/components/TabBar";
import {
  countDiaryEntries,
  listDiaryEntries,
  signPhotoUrls,
  type DiaryEntry,
} from "@/lib/diary";

/** 「08/15」の形にする（一覧では日付だけ。モックアップに合わせる） */
function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

/** 「21:04」 */
function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function DiaryPage() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [counts, setCounts] = useState({ total: 0, thisMonth: 0 });
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
    const [rows, counted] = await Promise.all([
      listDiaryEntries(),
      countDiaryEntries(),
    ]);
    const paths = rows
      .map((row) => row.photoPath)
      .filter((path): path is string => path !== null);
    return { rows, counted, urls: await signPhotoUrls(paths) };
  }, []);

  // 開いたときに読む。
  // 「片付け」を返しているのは、読んでいる途中で画面を離れたときに、
  // すでに消えた画面へ結果を書き込まないようにするため。
  useEffect(() => {
    let alive = true;

    fetchEntries()
      .then(({ rows, counted, urls }) => {
        if (!alive) return;
        setEntries(rows);
        setCounts(counted);
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
      .then(({ rows, counted, urls }) => {
        setEntries(rows);
        setCounts(counted);
        setPhotoUrls(urls);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
  }, [fetchEntries]);

  return (
    <main className="min-h-dvh w-full bg-[linear-gradient(180deg,var(--grass-mist)_0%,var(--paper)_40%)] pb-28">
      {/* 緑の帯。右上に大きな丸をひとつ置く（モックアップと同じ） */}
      <header className="relative overflow-hidden rounded-b-[28px] bg-[var(--grass-pale)] px-5 pb-7 pt-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/40"
        />
        {/* 中央寄せ。左上に置くと、片手で持ったとき視線の外になりやすい。
            「ホームへ戻る」は下のタブにあるので、ここには置かない */}
        <div className="relative mx-auto w-full max-w-md text-center">
          <h1 className="text-[30px] font-bold tracking-[0.12em]">日記帳</h1>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold">
            <span aria-hidden="true">🔒</span>
            非公開・自分だけの記録
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pt-5">

        {/* 記録の数（モックアップと同じく、一覧の上に2つ並べる） */}
        <div className="flex gap-3">
          <div className="flex-1 aq-card px-4 py-3 text-center">
            <p className="text-xs text-[var(--ink)]/60">記録した数</p>
            <p className="aq-num mt-1 text-2xl font-bold">{counts.total}</p>
          </div>
          <div className="flex-1 aq-card px-4 py-3 text-center">
            <p className="text-xs text-[var(--ink)]/60">今月</p>
            <p className="aq-num mt-1 text-2xl font-bold">{counts.thisMonth}</p>
          </div>
        </div>

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
            className="aq-btn"
          >
            新しく書く
          </button>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-[var(--ink)]/60">読み込み中…</p>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm leading-relaxed text-[var(--ink)]/55">
            まだ何もありません。
            <br />
            歩いたときに、見つけたものを残してみてください。
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {entries.map((entry) => {
              const url = entry.photoPath ? photoUrls.get(entry.photoPath) : null;
              return (
                <li key={entry.id}>
                  {/* 行ごと押して詳細へ。編集と削除は詳細の画面で行う。
                      一覧に消すボタンを置くと、指が触れただけで消えかねない */}
                  <Link
                    href={`/diary/${entry.id}`}
                    className="aq-card flex items-center gap-3 p-3 active:bg-[var(--grass-mist)]"
                  >
                    {url ? (
                      /* 期限つきURLの写真。毎回URLが変わるので最適化は通さない */
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={url}
                        alt=""
                        className="h-[88px] w-[88px] shrink-0 rounded-2xl object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-2xl bg-[var(--grass-mist)] text-2xl"
                      >
                        📝
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[var(--grass)]">
                        {formatDay(entry.createdAt)}
                        <span className="ml-2 font-normal text-[var(--ink-muted)]">
                          {formatTime(entry.createdAt)}
                        </span>
                      </p>
                      {entry.questLabel && (
                        <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug">
                          {entry.questLabel}
                        </p>
                      )}
                      <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                        {entry.note ?? "（メモなし）"}
                      </p>
                    </div>

                    <span
                      aria-hidden="true"
                      className="shrink-0 pr-1 text-xl text-[var(--ink-muted)]"
                    >
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TabBar />
    </main>
  );
}
