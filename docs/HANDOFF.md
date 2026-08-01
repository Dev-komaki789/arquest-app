# 開発引き継ぎメモ

別のPC、または別の作業セッションから続きを始めるための記録。
最終更新: 2026-08-01

---

## 1. いまどこまで進んでいるか

仕様書（[ARQUEST_PROJECT_BRIEF.md](./ARQUEST_PROJECT_BRIEF.md)）§8「実装の推奨順序」に対する進捗。

| # | 項目 | 状態 |
|---|---|---|
| ① | 現在地を取得して画面に表示 | ✅ 完了 |
| ② | 地図を表示し現在地マーカーを置く | ✅ 完了 |
| ③ | Overpass APIで周辺スポットを取得しピンを置く | ✅ 完了 |
| ④ | 取得したスポットをSupabaseの `pois` にキャッシュ | ✅ 完了（§5参照） |
| ⑤ | OSRMでルートを取得し地図に線を描く | ✅ 完了（OSRM→Valhallaに変更。§4-1参照） |
| ⑥ | `watchPosition` で現在地を継続取得し追従 | ✅ 完了 |
| ⑦ | Haversineで距離を計算 | ✅ 完了 |
| ⑧ | PostGISを有効化し `complete_quest` RPCを作る | ⬜ **次はここから**（§6参照） |
| ⑨ | 到達時にRPCを呼びサーバー側で最終確認 | ⬜ 未着手 |
| ⑩ | `self_report` のお題だけ行動確認画面を挟む | ⬜ 未着手 |

仕様書§9の最小構成のうち「現在地マップ／実在スポットのクエスト」まで到達。
残りは「到達判定（GPS・PostGIS）／行動確認（自己申告）／相棒（静止画）」。

---

## 2. 動く状態にするまで（新しいPCでの初回手順）

```bash
nvm use              # .nvmrc を読んで Node v24 に切り替わる
npm install          # postinstall で MapLibre のワーカーが public/ にコピーされる
npm run dev          # http://localhost:3000
```

Node.js は **v24 系**。`.nvmrc` に `24` を記録してあるので、`nvm use` だけで揃う。

**バージョンを揃える理由。** 自宅PCが v22（npm 10）、訓練校が v24（npm 11）だったとき、
`npm install` のたびに `package-lock.json` に38行の差分（`libc` フィールド）が出続けた。
壊れはしないが、本当に意味のある変更がノイズに埋もれる。

**`.env.local` は git に載らないので、PCを移ったら手で作り直す。** 中身は §5-5 参照。

### 動作確認の手順（現地に行かずに）

1. Chrome DevTools（`Cmd/Ctrl + Shift + I`）
2. `Cmd/Ctrl + Shift + P` → `sensors` → **Show Sensors**
3. Location → **その他/Other** → 緯度経度を入力

テスト用座標（OpenStreetMapの実データ）:

| 場所 | 緯度, 経度 |
|---|---|
| 阪神尼崎駅 | `34.718589, 135.417325` |
| 阪神出屋敷駅 | `34.718206, 135.404545` |
| 阪神大阪梅田駅 | `34.701410, 135.497147` |

※ 緯度と経度を別々に貼り替えると、その中間地点が一瞬「現在地」として記録され、
軌跡がL字に折れて距離が増える。値は `Cmd/Ctrl + A` で全選択してから貼り替えること。

### 検証コマンド

```bash
npx tsc --noEmit     # 型チェック
npx eslint src scripts
npm run build        # 本番ビルド
```

---

## 3. ファイル構成と役割

```
src/
├── instrumentation.ts               サーバー起動時に1回だけ走る設定（§4-6）
├── app/
│   ├── page.tsx                     画面。表示と操作をまとめる係
│   └── api/
│       ├── pois/route.ts            周辺スポット検索API＋キャッシュ（サーバー側）
│       └── route/route.ts           道順取得API（サーバー側）
├── components/
│   └── CurrentLocationMap.tsx       地図の描画（MapLibre）
├── hooks/
│   ├── useGeolocation.ts            位置の取得と追従
│   ├── useWalkTrail.ts              歩いた軌跡と距離の記録（間引き）
│   ├── useNearbyPois.ts             周辺スポットの検索
│   └── useDestination.ts            目的地と道順の管理
└── lib/
    ├── geo.ts                       距離・方角・円・線の計算（純粋な関数）
    ├── poi.ts                       スポットの型とカテゴリ情報（サーバー/画面 共用）
    ├── overpass.ts                  Overpass APIへの問い合わせ（サーバー専用）
    ├── routing.ts                   経路サービスへの問い合わせ（サーバー専用）
    └── supabase.ts                  データベースへの接続（サーバー専用・鍵を持つ）

scripts/copy-maplibre-worker.mjs     MapLibreのワーカーを public/ にコピー（postinstallで自動実行）
.nvmrc                               Nodeのバージョン（24）
.env.local                           接続情報。git管理外。PCごとに手で作る
```

### 設計方針

- **取る係・記録する係・見せる係を分ける。** 画面が10個ある仕様なので、
  位置情報の処理を画面に書くと同じコードを何度も書くことになる。
- **外部APIはすべてRoute Handler（サーバー側）経由。** CORS回避、
  公共サーバーへの負荷集約、キャッシュのため。ブラウザから直接叩かない。
- **コードには初心者にも分かる日本語コメントを入れる。** 判断の理由まで書く。

---

## 4. 技術的な判断と、その根拠（実測にもとづく）

ポートフォリオのREADMEや面接で説明できるよう、根拠つきで残す。

### 4-1. 経路サービスを OSRM → Valhalla に変更した

仕様書§5では「OSRM（徒歩プロファイル）」としていたが、**公開デモサーバー
（router.project-osrm.org）は profile 指定を無視し、自動車の経路しか返さない**。
`foot` / `walking` / `driving` の3つで距離・時間・経路が完全に一致することを確認した。

自動車の経路は一方通行・進入禁止・歩行者専用道の制約を受けるため遠回りになる。
実測（阪神尼崎→出屋敷）:

| | 距離 |
|---|---|
| 直線距離 | 1.17 km |
| **徒歩ルート（Valhalla）** | **1.34 km** |
| OSRMデモ（実質は自動車） | 1.60 km |
| 自動車ルート（Valhalla） | 1.89 km |

→ FOSSGISが公開する **Valhalla**（`costing: "pedestrian"` が正しく機能）に変更。
OSRMはValhalla停止時の代替として残し、どちらを使ったかを `profile` で返している。
自動車で代替した場合は画面に注意書きが出る。

Valhallaは経路を **encoded polyline（精度6）** で返すため、デコード処理を自前で実装した
（[routing.ts](../src/lib/routing.ts)）。一般的な精度5と間違えると座標が10分の1になる。

### 4-2. Overpass API は User-Agent が必須

名乗らずにリクエストすると、`overpass-api.de` は **406**、`kumi.systems` は **429 +
「Please include a meaningful User-Agent string」** で拒否される。
OSMの利用規約でアプリの名乗りが求められているため。

また `overpass.osm.ch` は**スイス周辺のデータしか持たない地域限定サーバー**で、
日本の座標では **HTTP 200 で 0件** を返す。エラーにならないので気づきにくい。使わないこと。

Overpassはタイムアウト時にも **HTTP 200 で `remark` だけ返す**ことがあるため、
`remark` があれば失敗として扱っている。

回数制限も実際に食らった（429）。**仕様書§5の「poisテーブルへのキャッシュを必須とする」
という判断は、この実測で裏付けられた。**当初はサーバーのメモリ上に10分間置いていたが、
④でSupabaseに永続化した（§4-7）。

### 4-3. MapLibre v6 のワーカーがバンドル後に見つからない

MapLibreはタイルの取得・解析を Web Worker に任せているが、v6 は
`import.meta.url` を基準にワーカーのファイルを探しに行く。
Next.jsがコードをまとめ直すと、その場所にファイルが存在しない。

結果、**ワーカーが起動せず、タイルが永久に読み込まれず、エラーも出ないまま
「地図を読み込み中…」で固まる**。マーカーはHTML要素なので表示され、
「ピンは出るが地図が出ない」という紛らわしい状態になる。

対処: `scripts/copy-maplibre-worker.mjs` で `maplibre-gl-worker.mjs` と
`maplibre-gl-shared.mjs` を `public/maplibre/` にコピーし、`setWorkerUrl()` で場所を明示。
`postinstall` に登録してあるので `npm install` のたびに自動でコピーされる。
**2ファイルセットで必要**（ワーカー本体が同じフォルダの shared を読むため）。

### 4-4. GPSの点は間引かないと距離が水増しされる

`watchPosition` は静止していても1〜2秒ごとに位置を知らせ、GPS誤差で座標は常に揺れる。
全部足すと「座っているだけで距離が増える」。[useWalkTrail.ts](../src/hooks/useWalkTrail.ts) で2種類を捨てている。

| 条件 | 閾値 | 理由 |
|---|---|---|
| 精度が粗い点 | ±50mより粗い | 到達判定が半径100m。その半分を超える誤差の点で距離を足すと嘘になる |
| 動いていない点 | 前回から10m未満 | GPS誤差の揺れは数メートル。歩行なら10mは10秒足らずで進む |

**開発中（`npm run dev`）は精度の基準を±1000mに緩めている。** 開発ツールの偽装位置は
精度が粗い固定値で返るため、本番と同じ基準だとテスト用の位置が全部捨てられて動作確認できない。
本番ビルドでは±50mに戻る（`process.env.NODE_ENV` で自動切替）。

### 4-5. 位置情報のエラーは種類で扱いを分ける

`watchPosition` は1回失敗しても見張りは続く仕様。どんなエラーでも `clearWatch` すると、
トンネル・地下・ビル影で測位が途切れるたびに追従が止まってしまう。

| エラー | 扱い |
|---|---|
| code 1（許可されていない） | 追従を停止。設定を変えない限り絶対に成功しない |
| code 2（測位できない） | **追従を継続**。お知らせだけ出す |
| code 3（時間切れ） | **追従を継続**。お知らせだけ出す |

### 4-6. 同じコードでも、PCによって外部APIに繋がらないことがある

zip転送後、自宅PC（Windows/WSL）で `/api/pois` が **502で全滅**した。訓練校のMacでは動いていた。

切り分けると、**`curl` では成功するのにアプリ（Node）からだけ失敗**する。
さらに Valhalla・CARTO・GitHub には繋がり、**Overpassだけ**が落ちる。

原因は、ドメインが複数のIPを持つときの Node の接続方式にあった。
Nodeは全アドレスを少しずつずらして試し、**1つあたり250msで見切って次へ移る**。

| overpass-api.de の接続先 | 実測 | Nodeの制限 |
|---|---|---|
| 65.109.112.52 | 373ms | 250ms → 打ち切り |
| 162.55.144.139 | 315ms | 250ms → 打ち切り |

**あと少しで繋がるところで毎回打ち切られていた。** サーバーがドイツにあるので
往復300ms超は異常ではなく普通のこと。訓練校では回線が速く、たまたま間に合っていただけ。

Valhalla・CARTOが無事だったのは、IPアドレスが1組しかなく「次に移る先」が無かったため。
「一部のAPIだけ落ちる」という紛らわしい出方をしていた。

対処: [src/instrumentation.ts](../src/instrumentation.ts) で待ち時間を **250ms → 1000ms** に。
`instrumentation.ts` はNext.jsの決まりで、**サーバー起動時に1回だけ**走る（ファイルを作った後は再起動が要る）。

長くしすぎない理由は、IPv6が使えない環境（このWSLがそう）で
IPv4に切り替わるまでの待ちがそのまま伸びるため。実測最大373msに余裕を持たせて1秒にした。

### 4-7. キャッシュは「どの範囲を調べたか」を記録しないと静かに壊れる

④で `pois` にキャッシュするとき、素直に「半径内に1件でもあれば命中」と作ると壊れる。

```
1回目 尼崎駅で検索      → 30件を保存
2回目 800m東で検索      → 重なった部分の3件だけがヒット
                        → 「キャッシュにある」と誤判定してOverpassに行かない
                        → 東側の20件が永久に出てこない
```

**エラーが出ない。** 画面には3件だけ並び、利用者には「この辺には3つしかない」と見える。
しかも `pois` にデータが溜まるほど悪化する（どこで検索しても数件はヒットするようになるため）。

原因は、`pois` が「スポットの位置」しか知らず「どの範囲を調べ終わったか」を知らないこと。
そこで **`poi_searches`（中心・半径・検索日時）** を追加し、
「今回の円が過去の円に完全に収まるか」＝ `中心間の距離 + 今回の半径 ≦ 記録した半径` で判定する。

**ただしこれだけだと、今度はキャッシュがほぼ効かない。**
同じ半径800mで検索し続けると `1 + 800 > 800` となり、1mでも動けば必ず外れる。
実測でも100m・300m・800mすべて命中しなかった。歩いて使うアプリでは致命的。

対処: **Overpassには要求の2倍（1600m）で取りに行き、その範囲を記録する。**
返すのは要求どおり800m以内だけ。広く取るのは保存のためであって表示のためではない。

| | 時間 |
|---|---|
| 初回（Overpassへ） | 9.5秒 |
| 同じ地点で再検索 | 0.28秒（34倍速） |
| **500m移動して再検索** | **0.28秒（命中）** |

面積が4倍になるので1回の問い合わせは重くなるが、**問い合わせ回数そのものが激減する**。
Overpassは回数制限のある無料サーバーなので、この取引は有利。

### 4-8. 位置情報のエラー案内はOSごとに変える

Macで開発したため「Macのシステム設定を確認してください」と決め打ちしていた。
Windowsにその画面は存在せず、実際に原因究明を妨げた（真因はWindowsの位置情報サービスがOFF）。

仕様書§2.1のとおり、このアプリはiPhone・AndroidにPWAとして入れて使う。
**利用者のOSはMacでないほうが普通**なので、`navigator.userAgent` を見て案内先を出し分けている。

位置情報は「ブラウザの許可」と「OS本体の許可」の二段階で、どちらが切れていても失敗する。
両方に触れる文面にしてある。

### 4-9. その他

- **2種類の距離を使い分ける。** 直線距離（ハバーサイン・通信不要・即座に更新）は
  「あと◯m」と到達判定に使う。道なりの距離（通信あり・目的地決定時に1回）は見た目の案内のみ。
  到達判定に道なりを使わないのは、遅く、失敗もするため。
- **徒歩の所要時間は自前で計算。** 80m/分（日本の不動産広告の標準・時速4.8km）。
  Valhallaの歩行時間（17分）とも一致した。
- **地図のスタイルは voyager（色つき）。** 当初のpositronは白背景に細い灰色の線だけで、
  「地図が出ていない」のか「淡くて見えない」のか区別できなかった。
- **ポップアップは `textContent` で組み立てる。** スポット名はOSMの投稿データ（他人が書いた文字列）。
  HTML文字列として埋め込むとクロスサイトスクリプティングの余地が生まれる。
- **`useEffect` の中で state を更新しない。** Next.js 16のESLintに止められる。
  位置が届くのは「出来事」なので、`useGeolocation` の `onPosition` で届いたその場で処理する。

---

## 5. Supabaseの構成（④で作ったもの）

### 5-1. プロジェクト

| 項目 | 値 |
|---|---|
| アカウント | GitHubの `Dev-komaki789` でログイン |
| プロジェクト名 | `arquest` |
| リージョン | Northeast Asia (Tokyo) |
| Project URL | `https://zjgvhspzwhcuuitmylcv.supabase.co` |
| 料金プラン | Free（カード登録なし） |

Database Password は控えてあること。**後から表示できない。**

### 5-2. 作成時に選んだ安全側の設定

| 設定 | 選択 | 理由 |
|---|---|---|
| Enable Data API | ON | `supabase-js` がこのAPI経由で読み書きするため |
| Automatically expose new tables | **OFF** | 新しい表が作った瞬間に外へ公開されないように |
| Enable automatic RLS | ON | RLSの付け忘れを仕組みで防ぐ |

2番目をOFFにしたので、**表を作るたびに権限を自分で付ける**必要がある。

```sql
grant all on table 表名 to service_role;
```

これから作る `visit_logs`（訪問履歴）や `diary_entries`（非公開の日記）が
作った瞬間に外へ開かれないようにするための設定。仕様書§2.7の「完全に非公開」を設定レベルで守る。

**PostGISは画面から入れる**（Database → Extensions → `postgis`）。
SQLで直に入れると `public` スキーマに入り、あとでSupabaseの検査機能に警告される。

### 5-3. 作ったテーブル

```sql
-- スポットのキャッシュ（仕様書§6のとおり）
create table if not exists pois (
  id bigint generated always as identity primary key,
  source_id text not null unique,        -- OSM上のID（例: "node/123456"）
  name text not null,
  category text not null,
  geom geography(Point, 4326) not null,  -- 地球が丸いことを考慮して距離計算できる型
  cached_at timestamptz not null default now()
);

create index if not exists pois_geom_idx on pois using gist (geom);
create index if not exists pois_cached_at_idx on pois (cached_at);

alter table pois enable row level security;
create policy "pois_select_all" on pois for select using (true);
grant all on table pois to service_role;

-- 「どの範囲を調べ終わったか」の記録（仕様書§6に無い。§4-7の理由で追加）
create table if not exists poi_searches (
  id bigint generated always as identity primary key,
  center geography(Point, 4326) not null,
  radius_m integer not null,
  searched_at timestamptz not null default now()
);

create index if not exists poi_searches_center_idx on poi_searches using gist (center);
create index if not exists poi_searches_searched_at_idx on poi_searches (searched_at);

alter table poi_searches enable row level security;
grant all on table poi_searches to service_role;
```

`source_id` の `unique` が重要。これがあるから `upsert` で重複が防げる。

`gist` は**位置情報専用の索引**。普通の索引は大小の並び順で探すので
「この円の中にあるか」という2次元の問いには使えない。

### 5-4. 作った関数（RPC）

PostgRESTは `.select()` を自動でSQLに翻訳してくれるが、
**「半径◯m以内」のような空間の条件は表現できない**。そのためSQL側に関数を置いて呼ぶ。

| 関数 | 役割 |
|---|---|
| `poi_search_covered(緯度, 経度, 半径, 何分以内)` | この範囲は最近調べたかを真偽で返す |
| `pois_within(緯度, 経度, 半径)` | 半径内のスポットを近い順・距離つきで返す |

定義は [src/app/api/pois/route.ts](../src/app/api/pois/route.ts) の説明と対応している。

**関数を作った直後はAPIから見えないことがある。** Supabaseが持つ一覧のキャッシュが古いため。
SQL Editorで次を実行すると読み直される。

```sql
notify pgrst, 'reload schema';
```

### 5-5. 接続情報（`.env.local`）

Project Settings → API Keys から取得。**git管理外なので、PCを移ったら手で作り直す。**

```
SUPABASE_URL=https://zjgvhspzwhcuuitmylcv.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

- キーの表記は世代で違う。**旧 `service_role`（`eyJ...`）／新 `secret`（`sb_secret_...`）**。
  どちらも同じ「サーバー専用の秘密キー」。公開用の `anon` / `publishable` ではないので注意
- **`NEXT_PUBLIC_` を絶対に付けない。** 付けるとブラウザに配信される。
  このキーはRLSを素通りしてDBを全操作でき、**リポジトリは公開設定**なので致命的
- 変更後は開発サーバーの再起動が必要

---

## 6. 次にやること — ⑧⑨ 到達判定

### 6-1. 仕様書§8の順序には飛びがある

⑧の `complete_quest`（仕様書§7に雛形あり）は、こう始まる。

```sql
complete_quest(p_quest_id uuid, ...)
  select p.geom, q.radius_m from quests q      -- quests テーブルが要る
  join pois p on p.id = q.poi_id
```

**`quests` が必要で、`quests` は `users` と `quest_templates` を参照する。**
仕様書§8の順序は、この3テーブルとログイン機能（画面1）を飛ばしている。
そのまま⑧に着手すると、先に作るものが芋づる式に出てくる。

### 6-2. 進め方は2つ

| | 内容 |
|---|---|
| 土台を先に作る | ログイン（画面1）→ `users` → `quest_templates` → `quests` → ⑧。正攻法だが着手までが長い |
| **仕組みを先に確かめる（推奨）** | まず「スポットIDと半径」だけでPostGISの到達判定を動かし、動くと分かってから `quests` を被せる |

推奨は後者。①〜⑦と④が「小さく動かしてから本実装」で進んでうまくいっているので、同じ形にできる。
④でも「まずSupabaseに繋がるか確かめる」→「それから実装」の順で、詰まりどころが早く見つかった。

### 6-3. 訪問済みスポットを候補から外す件（設計メモ）

仕様書§6の `visit_logs`（誰が・どのスポットに・いつ行ったか）でそのまま実現できる。

```sql
select * from pois p
where ST_DWithin(p.geom, 現在地, 検索半径)
  and not exists (
    select 1 from visit_logs v
    where v.poi_id = p.id and v.user_id = ログイン中の人
  )
```

**`pois` に「訪問済み」の列を足してはいけない。** `pois` は全利用者で共有するキャッシュなので、
Aさんが行った瞬間にBさんの候補からも消える。訪問済みは「利用者 × スポット」に紐づく情報。

そのため `/api/pois` の戻り値には既に `poiId`（`pois.id`）を含めてある。

**未解決の論点: 候補が枯渇する。** 近所のスポットは有限なので、除外し続けるといつかゼロになる。
仕様書§1で「自己肯定感や気分が上がることを優先する」と決めた相手に
「今日は行くところがありません」と出すのは、このアプリが最もやってはいけないこと。
続けている人ほど早くその状態に到達する。

| 案 | 内容 |
|---|---|
| 期間で復活 | 90日経ったら候補に戻す。「久しぶりに行く」は散歩として自然 |
| **優先度を下げる（推奨）** | 完全除外せず未訪問を優先。尽きたら訪問済みも出す |
| 半径を広げる | 近所が尽きたら自動で範囲を広げる（`user_settings.search_radius_m`） |

「優先度を下げる ＋ 期間で復活」の組み合わせなら、候補ゼロが構造的に起きない。
決めるのは `visit_logs` を作る段階で間に合う。

### 6-4. カテゴリの偏り（観察）

④で保存された120件の内訳。尼崎駅・梅田で検索した結果。

```
ちいさな用事 (errand)  64件
たんけん   (explore)  29件
であい     (meet)     24件
しぜん     (nature)    3件  ← 極端に少ない
```

都市部では**「しぜん」のお題がほぼ出せない**。仕様書§2.2で4カテゴリを掲げている以上、
ミッション生成を作る段階で対象を広げる（街路樹・河川敷・神社の境内など）か、
場所に応じて出現比率を変えるかの判断が要る。

---

## 7. アカウントと環境のメモ

| 項目 | 内容 |
|---|---|
| GitHub（メイン） | `Dev-komaki789` — 転職活動用。ポートフォリオもこちら |
| リポジトリ | https://github.com/Dev-komaki789/arquest-app （**公開設定**） |
| コミットの著者 | `Dev-komaki789 <274962537+Dev-komaki789@users.noreply.github.com>` |
| 作業PC | 訓練校=Mac / 自宅=Windows(WSL) の2台 |

**リポジトリは公開設定。** APIキーをコミットすると、自動巡回botに数分で拾われる。
`.env.local` は `.gitignore` 済みだが、意識しておくこと。

### 認証の状況（2026-08-01時点）

| PC | 状態 |
|---|---|
| **自宅Windows(WSL)** | ✅ SSH鍵あり（2026-05-10作成）・remote設定済み・push確認済み |
| **訓練校Mac** | ⬜ 未設定。`git remote add` と認証手段の用意が要る |

**押さえておくこと。** pushに必要なのは「認証手段」であって、SSH鍵はその一択ではない。

| 認証手段 | 手元に置くもの | 性質 |
|---|---|---|
| SSH鍵 | 秘密鍵ファイル | 無期限・**アカウントの全リポジトリ**に有効 |
| HTTPS + fine-grained PAT | トークン文字列 | 期限付き・**リポジトリを限定できる** |

**訓練校のMacでは PAT を使う。** 自分の管理下にないPCに、無期限・全リポジトリ有効の
秘密鍵を置かないため。トークンなら、もうそのMacに触れなくなっても遠隔で失効できる。

設定: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- Repository access: **Only select repositories** → `arquest-app` のみ
- Permissions: **Contents = Read and write**
- Expiration: 訓練の修了日あたり

```bash
git remote add origin https://github.com/Dev-komaki789/arquest-app.git
git pull    # 既存フォルダで実行。履歴が同一なので衝突しない
```

**pullが成功するまで訓練校側のフォルダは消さないこと。**

訓練校を離れる日: トークンを失効 → Keychainから削除 → ブラウザからサインアウト → 作業フォルダ削除。

### 訓練校で最初に確認すること（ネットワーク制限の有無）

学校のネットワークは通信が絞られていることがある。**22番ポート（SSH）が塞がれているのはよくある**
（PAT + HTTPS なら443番だけで済むので、これも PAT を勧める理由）。

```bash
node -v                                                           # 無ければ nvm を検討
git ls-remote https://github.com/Dev-komaki789/arquest-app.git    # GitHub
curl -sI https://registry.npmjs.org | head -1                     # npm
curl -sI https://overpass-api.de/api/interpreter | head -1        # スポット検索
curl -sI https://valhalla1.openstreetmap.de/status | head -1      # ルート
curl -sI https://basemaps.cartocdn.com | head -1                  # 地図タイル
```

Overpass や Valhalla は知名度の低いドメインなので、カテゴリ分類型のフィルタに
引っかかる可能性がある。無反応・タイムアウトなら、そこがフィルタ。

Node.js の導入に管理者権限が要る場合は、**nvm ならホームディレクトリ内で完結**する。

### 2台で作業するときの注意

- **作業前に `git pull`、帰る前に `git push`。**
- `.env.local` と `node_modules` は同期されない。移った先で作り直す
- **zipで運ばない。** 一度やったが、`:Zone.Identifier` が197個（うち158個は `.git` の中）
  発生し、`git fsck` がエラーを出す状態になった。`.gitignore` で除外済みだが、そもそも運ばない
- 改行コードは `.gitattributes` で LF に統一済み（設定不要）
- Node は `.nvmrc` で v24 に固定。移った先で `nvm use`
- **秘密鍵は持ち運ばない。** PCごとに用意する（上表のとおり、訓練校はPATを使う）
- **`SUPABASE_SECRET_KEY` を訓練校のPCに置くことの是非。** このキーはRLSを素通りして
  DBを全操作できる。自分の管理下にないPCに置くなら、**訓練校用に別のSupabaseプロジェクトを
  作って分ける**のが安全（無料枠で複数持てる）。「開発環境と本番環境を分離した」と説明もできる

---

## 8. 仕様書に反映すべき変更点

**2026-08-01 に反映済み。** [ARQUEST_PROJECT_BRIEF.md](./ARQUEST_PROJECT_BRIEF.md) に次の3点を追記した。

1. **§5 — 経路サービスを OSRM → Valhalla（歩行者）に変更。** 理由は §4-1 の実測結果。
   OSRMを本番で使うなら自前運用が必要。
2. **§5 — Overpassは User-Agent 必須、回数制限あり。** キャッシュ必須という判断の裏付けが取れた。
3. **§6 — `poi_searches` テーブルを追加。** 理由は §4-7。

### まだ仕様書に反映していないこと

- **⑧⑨に着手するとき、§8の実装順序に飛びがある**（§6-1 参照）。
  順序を直すか、注釈を入れるか判断が要る。
- **訪問済みスポットの扱い**（§6-3）。候補が枯渇する問題への方針が§2.2に無い。
  方針を決めたら§2.2か§10に追記する。

---

## 9. ポートフォリオとして公開するときの残作業

- **Vercelにデプロイ**してURLを作る（環境変数は管理画面に登録。`.env.local` はpushされない）
- **デモモードを付ける**。位置情報アプリは採用担当がその場で試せないため、
  固定座標で動かせるボタンを置く。開発ツールを開かせないことが重要
- **実際に歩いた操作の録画（GIF/動画）** をREADMEの先頭に置く
- README に「なぜ作ったか」と「§4の技術的判断」を書く。ここが一番の差別化になる
- 公開前チェック: `service_role` キーがコミットされていないか、
  地図の `© OpenStreetMap contributors` を消していないか
- 仕様書§2.2の「お題は到着まで伏せる」は未実装。現在は目的地名を表示している
