/**
 * ============================================================
 * 相棒（スラりん）— Figmaで描いたスライム
 * ============================================================
 *
 * ■ 元になった絵
 *   slime/ に置いてある3ポーズ（Figmaの書き出し）。
 *   アプリに取り込むぶんは src/assets/slime/ に英数字の名前でコピーしてある。
 *     normal.png    … ふつう（右を向いている）
 *     squashed.png  … つぶれている（右を向いている）
 *     sword.png     … 剣もち（左を向いている）
 *
 *   **元のファイルは slime/ に残してある。**描き直したら、
 *   同じ名前で src/assets/slime/ に上書きすれば差し替わる。
 *
 * ■ ポーズの割り当てかた
 *   相棒がセリフ枠の左に並ぶ画面では、**右を向いている絵**を使う。
 *   左向きの剣もちを置くと、相棒がセリフから顔をそむけて見えるため。
 *   剣もちは中央に大きく出す場面（ホームの誘い・達成報告）で使う。
 *
 * ■ 動き（motion）
 *   breathe … ゆっくり伸び縮みするだけ
 *   hop     … ぴょんと跳ねる
 *   none    … 動かさない
 *
 *   **どれも絵は1枚だけを使う。**潰れも伸びもCSSの変形で作る。
 *
 * ■ 跳ねるときに「つぶれ」の絵へ差し替えるのをやめた理由
 *   以前は着地の一瞬だけ squashed.png に切り替えていた。
 *   速い場面なので目に留まらない想定だったが、実際に見ると
 *   **絵が入れ替わったことがはっきり分かって違和感が出た。**
 *   2枚は縦横の比率が違う（1.28:1 と 1.89:1）ため、
 *   差し替わった瞬間に輪郭が別物になるのが原因。
 *
 *   1枚をCSSで潰し伸ばしするほうが、形が連続して変わるので繋がって見える。
 *   潰す量は控えめにしてある。深く潰すと顔が歪むため（globals.css）。
 *
 * ■ 箱の中では下端で揃える
 *   変形の支点も下端に置いてある。中央を支点にすると、
 *   潰れるたびに足元が浮き沈みして地面が動いて見える。
 */

import Image, { type StaticImageData } from "next/image";

import normal from "@/assets/slime/normal.png";
import squashed from "@/assets/slime/squashed.png";
import sword from "@/assets/slime/sword.png";

export type Mood =
  | "invite" // ホームで誘うとき（剣もち・中央）
  | "telling" // クエストを告げているとき（ふつう）
  | "waiting" // 待っているとき（つぶれ）
  | "happy" // 達成したとき（剣もち・光る）
  | "gentle"; // できなかった日（ふつう）

export type Motion = "breathe" | "hop" | "none";

const POSE: Record<Mood, { src: StaticImageData; alt: string }> = {
  invite: { src: sword, alt: "剣をもった相棒のスライム" },
  telling: { src: normal, alt: "相棒のスライム" },
  waiting: { src: squashed, alt: "くつろいでいる相棒のスライム" },
  happy: { src: sword, alt: "剣をかかげて喜ぶ相棒のスライム" },
  gentle: { src: normal, alt: "相棒のスライム" },
};

/** 箱の中に、下端を合わせて、比率を保ったまま収める */
const FIT = "absolute bottom-0 left-1/2 -translate-x-1/2 max-h-full w-auto h-auto max-w-full object-contain object-bottom";

export function Companion({
  mood = "telling",
  size = 120,
  glow = false,
  motion = "breathe",
}: {
  mood?: Mood;
  size?: number;
  /** 達成報告で、うしろを光らせるか */
  glow?: boolean;
  motion?: Motion;
}) {
  const pose = POSE[mood];
  const hopping = motion === "hop";

  return (
    <div
      className={[
        "relative flex shrink-0 items-end justify-center",
        motion === "breathe" ? "slime-breathe" : "",
        hopping ? "slime-hop" : "",
      ].join(" ")}
      style={{ width: size, height: size }}
    >
      {glow && (
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(245,185,66,0.75) 0%, rgba(245,185,66,0) 70%)",
          }}
        />
      )}

      {/* 跳ねるときも絵は1枚。潰れと伸びは親に掛けたCSSの変形が作る */}
      <Image
        src={pose.src}
        alt={pose.alt}
        className={FIT}
        // 表示するのはせいぜい200px程度なので、その2倍まで用意すれば足りる
        sizes="200px"
        priority
      />
    </div>
  );
}
