/**
 * ============================================================
 * 歩いている帯（移動中の画面）
 * ============================================================
 *
 * ■ 何を見せるものか
 *   相棒がその場で跳ね、うしろの景色が右から左へ流れる。
 *   「進んでいる」ことだけを表す飾りで、**実際の位置とは何の関係もない。**
 *   移動中は位置情報を使わない（仕様書§2.2）ので、
 *   本当の景色を出すことは原理的にできないし、出す必要もない。
 *
 * ■ なぜ動かすのか（仕様書§2.4）
 *   移動中の画面が「何も起きない」状態だと虚無になる。
 *   時間も距離も測っていない区間なので、出せるのは動きだけ。
 *
 * ■ どうやってループさせているか
 *   同じ絵を横に並べて置き、全体を左へ「1枚ぶん」動かす。
 *   動かし終わったら瞬時に元へ戻すが、絵がすべて同じなので戻った瞬間が見えず、
 *   永久に流れているように見える。
 *
 * ■ 何枚並べるかが大事（一度これで途切れた）
 *   最初は2枚だけ並べていたが、**帯の幅が絵1枚より広いと途切れる。**
 *   1枚ぶん流し終わった瞬間、2枚目の右側には何も無いためで、
 *   帯が400px・絵が360pxなら、その差の40pxが空白として一瞬見える。
 *
 *   必要な枚数は「帯の幅 ÷ 絵の幅 + 1」。
 *   帯はいちばん広くても max-w-md（約448px）なので、3枚あれば足りる
 *   （3枚 = 1080px ぶん。1枚ぶん流しても、残り720pxで帯を覆いきれる）。
 *
 * ■ 絵はSVGで描く
 *   画像を用意すると、端がつながるように作るのが難しい。
 *   図形で描けば、左端と右端の高さを揃えるだけで確実に繋がる。
 */

const TILE_WIDTH = 360;
const TILE_HEIGHT = 150;

/** 並べる枚数。「帯の幅 ÷ 絵の幅 + 1」以上にすること（上の説明を参照） */
const TILE_COUNT = 3;

/** 景色1枚。左端と右端が同じ高さになるように描く（繋いだときに段差が出ないように） */
function SceneTile() {
  return (
    <svg
      width={TILE_WIDTH}
      height={TILE_HEIGHT}
      viewBox={`0 0 ${TILE_WIDTH} ${TILE_HEIGHT}`}
      className="block shrink-0"
      aria-hidden="true"
    >
      {/* 空 */}
      <rect width={TILE_WIDTH} height={TILE_HEIGHT} fill="#BFDCF7" />

      {/* 遠くの建物。うすい色にして奥行きを出す */}
      <g fill="#8FB6E4">
        <rect x="10" y="58" width="46" height="62" />
        <rect x="70" y="44" width="34" height="76" />
        <rect x="120" y="66" width="52" height="54" />
        <rect x="190" y="50" width="40" height="70" />
        <rect x="250" y="70" width="44" height="50" />
        <rect x="306" y="54" width="42" height="66" />
      </g>

      {/* 窓。等間隔に並べると建物らしく見える */}
      <g fill="#FFFFFF" opacity="0.5">
        {[20, 80, 130, 200, 260, 316].map((x) =>
          [70, 88, 106].map((y) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="8" height="8" rx="1" />
          )),
        )}
      </g>

      {/* 木 */}
      <g>
        {[52, 178, 296].map((x) => (
          <g key={x}>
            <rect x={x + 6} y="104" width="6" height="18" fill="#8B6A4A" />
            <circle cx={x + 9} cy="100" r="16" fill="#5FC47D" />
            <circle cx={x - 1} cy="106" r="11" fill="#4CAF7D" />
            <circle cx={x + 19} cy="106" r="11" fill="#4CAF7D" />
          </g>
        ))}
      </g>

      {/* 地面 */}
      <rect x="0" y="120" width={TILE_WIDTH} height="30" fill="#8FCF9E" />
      <rect x="0" y="120" width={TILE_WIDTH} height="4" fill="#6FB985" />

      {/* 足元の草。位置をばらけさせて、同じ絵の繰り返しに見えにくくする */}
      <g fill="#6FB985">
        {[30, 96, 150, 214, 268, 330].map((x) => (
          <path key={x} d={`M${x} 138 l4 -8 l4 8 z`} />
        ))}
      </g>
    </svg>
  );
}

export function WalkScene({
  label,
  children,
}: {
  /** 右上に出す状態の文字（「移動中…」など）。点滅する */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/15"
      style={{ height: TILE_HEIGHT }}
    >
      {/* 流れる景色。同じ絵を並べて、1枚ぶんだけ左へ動かす。
          ずらす量は割合ではなくピクセルで渡す。
          割合だと枚数を変えたときに計算し直しになり、端数で継ぎ目も出る */}
      <div
        className="scene-scroll absolute inset-y-0 left-0 flex"
        style={
          {
            width: TILE_WIDTH * TILE_COUNT,
            "--scene-tile": `${TILE_WIDTH}px`,
          } as React.CSSProperties
        }
      >
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <SceneTile key={i} />
        ))}
      </div>

      {/* 相棒。景色のほうが動くので、こちらはその場で跳ねるだけでよい */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2">{children}</div>

      {/* いまの状態。景色の上に重ねるので、後ろを暗くして文字を読めるようにする */}
      {label && (
        <span className="blink-soft absolute right-2 top-2 rounded-full bg-[var(--navy)]/70 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
          {label}
        </span>
      )}
    </div>
  );
}
