# アルクエスト（旧称：おつかいクエスト）— プロジェクト仕様書

個人開発ポートフォリオ。職業訓練の成果物。ClaudeDesignでプロトタイプ済み、Figma経由でClaude Codeに引き継いで実装する。

## 1. コンセプト

**「外に出る理由」を、アプリが発注する。**

- 対象ユーザー：休日、部屋から一歩も出ない人（自分自身がモデル）。対人が少し苦手な人も想定。
- 課題：「散歩しよう」では人は動けない。目的がないと外出できない／人の視線が気になる／運動が続かない。
- 解決策：決まった時間になると、近所の実在スポットへの小さな「ミッション」が発生する。散歩ではなく"おつかい"というフレーミング。
- お金を使わせすぎない、対人ハードルを上げすぎない、自己肯定感や気分が上がることを優先する（達成主義にしすぎない）。

## 2. コアメカニクス

### 2.1 稼働時間帯と通知
- 利用者は平日／休日それぞれの「動ける時間帯」を事前登録する。
- その時間帯に入ると、Web Pushで通知が届く（複数回に分けて通知する想定）。
- iPhoneでWeb Pushを受け取るには、利用者がホーム画面に追加（PWAインストール）している必要がある。これは**必須の初回導線**にすること（iOS SafariはPWAインストールなしではWeb Pushを受け取れない）。

### 2.2 ミッション一覧・生成
- 1日あたり最大4件まで（多すぎると心理的に萎えるため上限を設ける）。
- カテゴリ例：「たんけん」「しぜん」「であい」「ちいさな用事」。
- 対人度（★1〜5）でお題の対人ハードルを可視化。「静かなモード」設定で対人度の高いお題を除外できる。
- 目的地までの距離が遠いほど、ごほうび（EXP）が大きい。
- **重要な仕様変更**：ミッション一覧の時点ではジャンルと距離感だけがわかる状態にし、具体的なお題（場所名・行動内容）は**目的地に到着するまで伏せる**。到着すると、はっきりお題が判明する。

### 2.3 到達判定（二段構え）
1. クライアント側：Geolocation API + Haversine距離計算で「近づいてきたかも」を先行して画面に表示（UX上の即応性のため）。
2. サーバー側：Supabaseの RPC 関数内で PostGIS の `ST_DWithin` を実行し、最終確定する。クライアントの自己申告だけを信用せず、改ざんに強い設計にする。

### 2.4 行動確認（自己申告）
- 到着しただけで完了する「たんけん」「しぜん」「ちいさな用事」系のお題は、到達判定のみでクリア。
- 現地での行動（例：「店員にお礼を言う」「屋台の人に話しかける」）が必要な「であい」系のお題だけ、到着後に「できた／まだ・もうすこしねばる」の一言確認画面（行動確認画面）を挟む。
- **できなくても訪問自体は記録される**（できなかったことを咎めない設計）。
- 達成の確認は写真や証拠を求めない完全な自己申告制。厳密な不正防止より「お金を使わせない・気分が上がる」ことを優先した意図的な判断。

### 2.5 相棒
- ホーム画面で相棒（プロトタイプでは「ソラ」）が声をかけてくる。達成状況に応じてセリフが変わるが、何もしていない日も否定しない言葉を選ぶ。
- 達成でレベル・EXPが育つ。将来的に着せ替え・図鑑機能を追加予定（優先度は低め）。

### 2.6 地図塗り
- 訪問済みのエリアが地図上でコレクションのように塗られていく（可視化された継続の記録）。

### 2.7 日記（非公開）
- ミッションで見つけたものを、写真＋一言メモで記録する個人的な日記機能。
- **完全に非公開**。共有・いいね・コメント機能は実装しない（傷つくリスク・ストーカーリスクを構造的に避けるため）。
- 写真のEXIF位置情報の削除は将来対応でよい（非公開機能のため優先度は低い）。

## 3. 画面一覧（10画面＋α）

| # | 画面名 | 概要 |
|---|---|---|
| 1 | ログイン | メールまたはGoogle。匿名利用も想定。 |
| 2 | ホーム | 相棒が話しかけてくる起点画面。次のミッション時間も確認できる。 |
| 3 | 稼働時間設定 | 平日／休日の動ける時間帯を登録。 |
| 4 | ミッション一覧 | 最大4件。ジャンルと距離感だけを表示（詳細は伏せる）。 |
| 5 | 目的地まで移動中 | 距離・方角のみ表示。お題はまだ伏せたまま。地図とルートを表示。 |
| 5.5 | 行動確認（NEW） | 到着するとお題がはっきり判明。行動が要るものだけ「できた？」を確認。 |
| 6 | 達成報告 | ごほうび（EXP）と地図塗りの結果を表示。 |
| 7 | 相棒・記録 | 相棒の様子・累計移動距離・継続日数。 |
| 8 | 地図塗り | 訪問済みエリアのコレクション地図。 |
| 9 | 設定 | 検索範囲・到達判定の範囲（スライダー）、静かなモード、通知設定。 |
| 10 | 日記（NEW） | 見つけたものを写真＋一言で記録。非公開。 |

## 4. デザインシステム

RPGクエスト風。Canvaテンプレートの「空気感」だけを参考にし、素材はオリジナルで再構成（著作権配慮）。

- **色**：スカイブルー `#5B8DEF`（濃色 `#3E6FD8`）、紺 `#1E2A4A`（メッセージウィンドウ背景）、ゴールド `#F5B942`（ごほうび・強調）、グラス `#4CAF7D`（表紙の装飾ストリップ）、カード背景 `#F2F6FF`、強調カード背景 `#FFF3DE`。
- **フォント**：Yu Gothic（游ゴシック）で統一。
- **UIモチーフ**：紺地・白縁のRPGメッセージウィンドウ（相棒のセリフ用）、メニューカード（左上に番号タブ）、対人度の星評価。
- **色の使い方のルール**：カードの強調色は「新しく追加された・最も差別化になる機能／画面」を示す（現状：「到達判定＋行動確認」「日記」の機能カード、「5.5 行動確認」「10 日記」の画面カード）。デコレーションではなく意味のある強調にする。
- キャラクター（相棒）はCanva素材を使わず、丸・目・ほっぺの単純な図形で構成したオリジナルマスコット。実装時はFigma → Riveで作ったキャラクターに差し替える。

## 5. 技術スタック

| 分類 | 技術 | 補足 |
|---|---|---|
| 言語・UI | TypeScript / React / Tailwind CSS | |
| フレームワーク | Next.js（PWA） | ネイティブアプリ化はしない |
| 認証・DB | Supabase（Auth / PostgreSQL + PostGIS） | |
| 位置情報 | Geolocation API（`watchPosition`） | HTTPS必須。iOSは許可ダイアログがユーザー操作直後でないと出ないことがある |
| 地図描画 | MapLibre GL JS + 無料ベースマップ（CARTO / Stadia Maps / MapTiler） | Leafletから変更。Googleマップは規約上「Google以外の地図と組み合わせ禁止」のため不採用 |
| 周辺スポット検索 | Overpass API（OSM） | 無料。Next.jsのRoute Handler経由で呼び出し、CORS回避＋キャッシュのしやすさを両立 |
| ルート・所要時間 | OSRM（徒歩プロファイル） | 無料。router.project-osrm.org のデモサーバーで検証可 |
| 定期実行 | Supabase pg_cron | 稼働時間帯の判定・ミッション生成に使用 |
| 通知 | Web Push（VAPID）＋ Service Worker | ネイティブのFCM/APNsではなくブラウザ標準のWeb Push |
| 相棒アニメーション | Rive / Framer Motion | Figmaで作画→Riveでインポート・アニメ化・着せ替え切り替え |
| 日記の写真保存 | Supabase Storage | 非公開バケットで保存 |
| デプロイ・管理 | Vercel / Git / GitHub | |

### 技術的な注意点（決定事項）
- **iOS SafariはWebXR（immersive-ar）に対応していない。** カメラ越しのAR経路表示は実現不可。上からのMapLibre地図表示に統一する。
- **Googleの各API（Places / Directions / Routes）は「Google以外の地図と組み合わせて使用禁止」という規約がある。** 今の構成（MapLibre／OSM）を維持する限り、Google系の地理情報APIは採用しない。
- 到達判定は**クライアントの概算（Haversine）＋サーバーの最終確認（PostGIS `ST_DWithin`）**の二段構え。片方だけに頼らない。
- Overpass APIはレート制限のある無料の公共サーバーのため、`pois`テーブルへのキャッシュを必須とする。

## 6. データベース設計（9テーブル＋日記1テーブル）

```
users
  id uuid PK
  email text (NULL可、匿名利用時)
  display_name text
  companion_level integer
  companion_exp integer
  total_distance_m integer
  created_at timestamptz

user_settings（1:1 with users）
  id uuid PK
  user_id uuid FK -> users.id (UNIQUE)
  weekday_start / weekday_end time
  weekend_start / weekend_end time
  search_radius_m integer (default 800)
  arrival_radius_m integer (default 100)
  updated_at timestamptz

push_subscriptions（1:N with users）
  id uuid PK
  user_id uuid FK -> users.id
  endpoint text (UNIQUE)
  p256dh text
  auth text
  created_at timestamptz

pois（周辺スポットキャッシュ）
  id bigint PK (identity)
  source_id text (UNIQUE, OverpassのノードID)
  name text
  category text
  geom geography(Point,4326)
  cached_at timestamptz

quest_templates（お題テンプレート）
  id uuid PK
  category text
  title_template text
  description text
  action_type text ('gps_only' | 'self_report')
  social_level text ('solo' | 'social')

quests（1:N with users, pois, quest_templates）
  id uuid PK
  user_id uuid FK -> users.id
  poi_id bigint FK -> pois.id
  template_id uuid FK -> quest_templates.id
  batch_date date（1日4件の上限判定に使用）
  status text ('active' | 'done' | 'expired')
  radius_m integer (default 100)
  reward_exp integer
  completed_via text ('gps' | 'self_report')
  created_at / completed_at timestamptz

visit_logs（1:N with users, quests, pois）
  id uuid PK
  user_id uuid FK -> users.id
  quest_id uuid FK -> quests.id
  poi_id bigint FK -> pois.id
  visited_at timestamptz
  rating integer (1-5、NULL可)

daily_activity_stats（1:N with users）
  id uuid PK
  user_id uuid FK -> users.id
  activity_date date（UNIQUE with user_id）
  distance_m integer
  quests_completed integer

companion_items / user_companion_items（着せ替え。優先度低）
  companion_items: id uuid PK, slot text, name text, price integer, image_url text
  user_companion_items: id uuid PK, user_id FK, item_id FK, acquired_at timestamptz

point_transactions（1:N with users）
  id uuid PK
  user_id uuid FK -> users.id
  amount integer
  reason text
  related_id uuid (NULL可)
  created_at timestamptz

diary_entries（日記。新規・非公開）
  id uuid PK
  user_id uuid FK -> users.id
  quest_id uuid FK -> quests.id (NULL可、ミッションと紐付かない記録も許容)
  photo_url text (Supabase Storageのパス)
  note text
  created_at timestamptz
  ※ 共有・いいね・コメント機能は実装しない
```

## 7. 到達判定のRPC関数（サンプル）

```sql
create extension if not exists postgis;

create or replace function complete_quest(
  p_quest_id uuid,
  p_lat double precision,
  p_lng double precision
) returns boolean
language plpgsql
security definer
as $$
declare
  v_target geography;
  v_radius integer;
  v_ok boolean;
begin
  select p.geom, q.radius_m into v_target, v_radius
  from quests q
  join pois p on p.id = q.poi_id
  where q.id = p_quest_id;

  v_ok := ST_DWithin(
    v_target,
    ST_MakePoint(p_lng, p_lat)::geography,
    v_radius
  );

  if v_ok then
    update quests
    set status = 'done', completed_via = 'gps', completed_at = now()
    where id = p_quest_id;
  end if;

  return v_ok;
end;
$$;
```

## 8. 実装の推奨順序（MVPへの積み上げ）

1. 現在地を取得して画面に表示するだけ（Geolocation API）
2. 地図を表示し、現在地マーカーを置く（MapLibre GL JS）
3. Overpass APIで周辺スポットを取得し、ピンを置く
4. 取得したスポットをSupabaseの `pois` にキャッシュする
5. OSRMでルートを取得し、地図に線を描く
6. `watchPosition` で現在地を継続取得し、マーカーを追従させる
7. Haversineで現在地・目的地間の距離を計算する（クライアント側の概算表示用）
8. SupabaseでPostGISを有効化し、`complete_quest` のRPC関数を作る
9. 到達したと思われたタイミングでRPCを呼び、サーバー側で最終確認する
10. `quest_templates.action_type` を見て、`self_report` のお題だけ行動確認画面を挟む

### テストのコツ（現地に行かずに確認する）
- Chrome DevTools → 検証 → センサー → Location で緯度経度を偽装できる
- overpass-turbo.eu で先にOverpassクエリを試せる
- OSRMのデモサーバーURLに直接アクセスして応答を確認できる

## 9. 実装スコープ（3段階）

**最小構成（必ず届ける）**
現在地マップ／実在スポットのクエスト／到達判定（GPS・PostGIS）／行動確認（自己申告）／相棒（静止画）

**標準構成（余裕があれば）**
稼働時間帯の設定／時間帯通知（pg_cron + Web Push）／ミッション一覧（最大4件）／日記（写真つき非公開の記録）

**最大構成（完成形）**
行った場所の地図塗り／相棒の着せ替え・図鑑／静かなモード（対人度で絞り込み）／記録の週間グラフ

最小構成の時点では通知は無く、アプリを開いたときにマップで探す体験のみ。時間帯通知は標準構成から。

## 10. まだ決まっていない・確認が必要なこと

- 相棒の名前「ソラ」、利用者の表示名例「ユウキ」はプロトタイプ上の仮の名前。正式名称にするかは未確定。
- 遠い目的地ほど高報酬にする設計と、稼働時間の長さ（選べる距離の上限）を連動させるかどうかは未検討（「近場で十分なのに毎回遠くを選んでしまう」を防ぐ工夫として要検討）。
- 日記機能の写真EXIF位置情報の削除処理は未実装（非公開機能のため優先度低）。
- 着せ替え・図鑑・週間グラフは最大構成に位置付けているのみで、詳細仕様は未検討。

## 11. これまでの重要な議論・却下した案（実装時に蒸し返さないための記録）

- **出前ブロッカー機能**：初期アイデアだが、対象が特定的すぎるため削除済み。
- **AR経路表示（カメラ越しに矢印を表示する演出）**：iOS SafariがWebXRのimmersive-arに対応していないため断念。上からの地図表示のみを採用。
- **Googleマップ／Google Places APIでの候補地取得**：無料でない・地図をGoogleに揃える必要がある・キャッシュが30日制限、という3つの理由で不採用。Overpass APIを継続使用。
- **ミッションを目的地に着くまで完全に非公開にする案（サプライズ演出）**：一人用アプリとしては不安要素になりうるため、「ジャンルと距離感だけ見せて、具体的なお題は伏せる」という中間案に着地。
- **達成記録の共有・いいね機能**：対人プレッシャーや心理的リスクを避けるため不採用。日記は完全非公開。
