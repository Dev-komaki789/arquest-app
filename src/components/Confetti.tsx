/**
 * ============================================================
 * 紙吹雪（達成の演出）
 * ============================================================
 *
 * ■ どこで舞うか
 *   **相棒のまわり**でひらひら舞う。
 *   画面の隅から打ち上げると視線が散ってしまうので、
 *   見てほしいもの（相棒と「達成」の文字）の近くだけで降らせる。
 *
 * ■ 動き
 *   上から下へゆっくり落ちながら、左右に揺れて回る。
 *   紙ごとに落ちる速さ・揺れ幅・回り方を変えると、
 *   同じ動きが並ばず「舞っている」ように見える。
 *
 * ■ 位置や色を「乱数」で決めていない理由
 *   Math.random() を使うと、サーバーで作った画面とブラウザで作った画面が
 *   食い違って警告が出る。そこで**番号から計算して散らす**。
 *   見た目はばらばらだが、何度描いても同じ結果になる。
 */

const PIECES = 16;

/** 番号から 0〜1 の値を作る（毎回同じ結果になる、ばらばらな数） */
function scatter(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 紙の色。**紺地の上で光るものだけを選ぶ。**
 * 濃い緑や濃い赤を混ぜると、暗い背景に沈んで「舞っている」ように見えない。
 */
const COLORS = ["#F5C23C", "#FCD168", "#FFFFFF", "#8FC7F0", "#F2A0B0", "#FBE9B8"];

export function Confetti() {
  return (
    <div
      aria-hidden="true"
      // 相棒を囲む範囲。はみ出して落ちてよいので、切り取らない
      className="pointer-events-none absolute -inset-x-16 -top-10 bottom-[-40px]"
    >
      {Array.from({ length: PIECES }, (_, i) => {
        const left = scatter(i) * 100;
        const sway = 14 + scatter(i + 30) * 26;
        const fall = 200 + scatter(i + 60) * 140;

        return (
          <span
            key={i}
            className="aq-flake absolute top-0 h-2.5 w-1.5 rounded-[1px]"
            style={
              {
                left: `${left}%`,
                background: COLORS[i % COLORS.length],
                "--sway": `${i % 2 === 0 ? sway : -sway}px`,
                "--fall": `${fall}px`,
                "--spin": `${(i % 2 === 0 ? 1 : -1) * (360 + scatter(i + 9) * 360)}deg`,
                animationDuration: `${2.6 + scatter(i + 12) * 2.2}s`,
                animationDelay: `${scatter(i + 70) * 2.2}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
