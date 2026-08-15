/**
 * ============================================================
 * クエストの進行を預かるフック
 * ============================================================
 *
 * ■ 何をする係か
 *   「いまどの段階か（引く前／移動中／行動中／終わった直後）」を持ち、
 *   画面からの操作をデータベースへの読み書きに繋ぐ。
 *   画面（page.tsx）は表示とボタンだけを受け持ち、順序の判断はここに集める。
 *
 * ■ 状態を画面に置かない理由（仕様書§2.6）
 *   30分歩いている間にアプリは平気で閉じられる。
 *   進行状況はデータベースが持ち、開き直したらそこから復帰する。
 *   ここが持つのは「いま画面に出すもの」だけで、記憶ではない。
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  cancelQuest,
  drawActionCard,
  drawMovementCard,
  findActiveQuest,
  finishQuest,
  loadActionCards,
  redrawActionCard,
  type ActionResult,
  type Quest,
  type QuestReward,
} from "@/lib/quest";

/** 例外から画面に出す文章を取り出す */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type UseQuest = {
  /** 進行中のクエスト。無ければ null */
  quest: Quest | null;
  /** 直前に終わったクエスト（達成報告の表示に使う） */
  finished: Quest | null;
  /** 直前にもらったごほうび。達成報告で出す */
  reward: QuestReward | null;
  /** 最初の読み込み中か */
  loading: boolean;
  /** ボタンを押した処理の最中か（二重押し防止に使う） */
  busy: boolean;
  error: string | null;
  draw: () => void;
  arrive: () => void;
  redraw: () => void;
  /** 引いたクエストをやめる（まだ歩き出していないとき） */
  cancel: () => void;
  finish: (
    result: ActionResult,
    walked: { distanceM: number; position: { lat: number; lng: number } | null },
  ) => void;
  closeReport: () => void;
};

export function useQuest(): UseQuest {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [finished, setFinished] = useState<Quest | null>(null);
  const [reward, setReward] = useState<QuestReward | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いたときに、途中のクエストがあるか確かめる。
  //
  // 「片付け」を返しているのは、読み込みの途中で画面を離れたときに
  // すでに消えた画面へ結果を書き込まないようにするため。
  useEffect(() => {
    let alive = true;

    findActiveQuest()
      .then((found) => {
        if (!alive) return;
        setQuest(found);
        // 行動カードは引き直しのために全件を先に持っておく（仕様書§2.3）。
        // 失敗しても遊びは止まらないので、ここでは握りつぶす。
        void loadActionCards().catch(() => {});
      })
      .catch((cause) => {
        if (alive) setError(messageOf(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  /**
   * ボタンの処理をまとめて包む。
   *
   * どのボタンも「二重押しを止める・エラーを拾う・終わったら戻す」が同じなので、
   * ここで1回だけ書いて使い回す。
   */
  const run = useCallback(
    (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      task()
        .catch((cause) => setError(messageOf(cause)))
        .finally(() => setBusy(false));
    },
    [],
  );

  const draw = useCallback(() => {
    run(async () => {
      setFinished(null);
      setQuest(await drawMovementCard());
    });
  }, [run]);

  const arrive = useCallback(() => {
    if (!quest) return;
    run(async () => {
      setQuest(await drawActionCard(quest.id));
    });
  }, [quest, run]);

  const redraw = useCallback(() => {
    if (!quest) return;
    run(async () => {
      setQuest(await redrawActionCard(quest));
    });
  }, [quest, run]);

  const cancel = useCallback(() => {
    if (!quest) return;
    run(async () => {
      await cancelQuest(quest.id);
      setQuest(null);
    });
  }, [quest, run]);

  const finish = useCallback(
    (
      result: ActionResult,
      walked: { distanceM: number; position: { lat: number; lng: number } | null },
    ) => {
      if (!quest) return;
      run(async () => {
        const done = await finishQuest(
          quest.id,
          result,
          walked.distanceM,
          walked.position,
        );
        setFinished(done.quest);
        setReward(done.reward);
        setQuest(null);
      });
    },
    [quest, run],
  );

  const closeReport = useCallback(() => {
    setFinished(null);
    setReward(null);
  }, []);

  return {
    quest,
    finished,
    reward,
    loading,
    busy,
    error,
    draw,
    arrive,
    redraw,
    cancel,
    finish,
    closeReport,
  };
}
