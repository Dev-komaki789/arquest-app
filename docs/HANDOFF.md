# 開発引き継ぎメモ

別のPC、または別の作業セッションから続きを始めるための記録。
最終更新: 2026-07-31

---

## 1. いまどこまで進んでいるか

仕様書（[ARQUEST_PROJECT_BRIEF.md](./ARQUEST_PROJECT_BRIEF.md)）§8「実装の推奨順序」に対する進捗。

| # | 項目 | 状態 |
|---|---|---|
| ① | 現在地を取得して画面に表示 | ✅ 完了 |
| ② | 地図を表示し現在地マーカーを置く | ✅ 完了 |
| ③ | Overpass APIで周辺スポットを取得しピンを置く | ✅ 完了 |
| ④ | 取得したスポットをSupabaseの `pois` にキャッシュ | ⬜ **次はここから** |
| ⑤ | OSRMでルートを取得し地図に線を描く | ✅ 完了（OSRM→Valhallaに変更。§5参照） |
| ⑥ | `watchPosition` で現在地を継続取得し追従 | ✅ 完了 |
| ⑦ | Haversineで距離を計算 | ✅ 完了 |
| ⑧ | PostGISを有効化し `complete_quest` RPCを作る | ⬜ 未着手 |
| ⑨ | 到達時にRPCを呼びサーバー側で最終確認 | ⬜ 未着手 |
| ⑩ | `self_report` のお題だけ行動確認画面を挟む | ⬜ 未着手 |

仕様書§9の最小構成のうち「現在地マップ／実在スポットのクエスト」まで到達。
残りは「到達判定（GPS・PostGIS）／行動確認（自己申告）／相棒（静止画）」。

---

## 2. 動く状態にするまで（新しいPCでの初回手順）

```bash
npm install          # postinstall で MapLibre のワーカーが public/ にコピーされる
npm run dev          # http://localhost:3000
```

Node.js は **v24 系**で開発した。

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
├── app/
│   ├── page.tsx                     画面。表示と操作をまとめる係
│   └── api/
│       ├── pois/route.ts            周辺スポット検索API（サーバー側）
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
    └── routing.ts                   経路サービスへの問い合わせ（サーバー専用）

scripts/copy-maplibre-worker.mjs     MapLibreのワーカーを public/ にコピー（postinstallで自動実行）
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
という判断は、この実測で裏付けられた。**現在はサーバーのメモリ上に10分間キャッシュしている
（初回11秒 → 2回目0.04秒）。④でSupabaseに永続化する。

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

### 4-6. その他

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

## 5. 次にやること — ④ Supabaseに `pois` をキャッシュ

### 5-1. アカウントとプロジェクト（ブラウザ操作）

1. https://supabase.com → **Continue with GitHub**（転職用アカウント `Dev-komaki789`）
2. **New project**
   - Name: `arquest`
   - Database Password: **必ず控える**（後から表示できない）
   - Region: **Northeast Asia (Tokyo)**
3. カード登録は不要。無料枠で完成まで到達できる。

### 5-2. テーブル作成（SQL Editor で実行）

```sql
create extension if not exists postgis;

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
```

### 5-3. 接続情報（`.env.local` を新規作成）

Project Settings → API から取得。

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

- **`NEXT_PUBLIC_` を付けないこと。** 付けるとブラウザに配信され鍵が公開される
- `.env.local` は `.gitignore` 済み。**PCを移ったら手で作り直す必要がある**
- 変更後は開発サーバーの再起動が必要

### 5-4. 実装の方針

`/api/pois` の流れを次のように変える。

```
現在: メモリキャッシュ → Overpass
変更: Supabase pois → 無ければ Overpass → 結果を pois に保存
```

- 検索は PostGIS の `ST_DWithin` で「半径◯m以内」を引く
- `source_id` が `unique` なので `upsert` で重複を防ぐ
- `cached_at` が古いものは取り直す

その後 ⑧⑨（`complete_quest` RPC・到達判定）へ進む。仕様書§7にSQLの雛形あり。

---

## 6. アカウントと環境のメモ

| 項目 | 内容 |
|---|---|
| GitHub（メイン） | `Dev-komaki789` — 転職活動用。ポートフォリオもこちら |
| リポジトリ | https://github.com/Dev-komaki789/arquest-app.git（**未push**） |
| コミットの著者 | `Dev-komaki789 <274962537+Dev-komaki789@users.noreply.github.com>` |
| 作業PC | 訓練校=Mac / 自宅=Windows の2台 |

### 2台で作業するときの注意

- **作業前に `git pull`、帰る前に `git push`。**
- `.env.local` と `node_modules` は同期されない。移った先で作り直す
- 改行コードは `.gitattributes` で LF に統一済み（設定不要）
- SSH鍵は**PCごとに作って、同じアカウントに複数登録する**。秘密鍵は持ち運ばない
- Windowsでpushするなら、HTTPS + ブラウザ認証が最も簡単
  （`git remote add origin https://github.com/Dev-komaki789/arquest-app.git` → `git push` でブラウザが開く）

---

## 7. 仕様書に反映すべき変更点

[ARQUEST_PROJECT_BRIEF.md](./ARQUEST_PROJECT_BRIEF.md) はまだ更新していない。次の2点を
§5（技術スタック）と§10（まだ決まっていないこと）に追記すると、判断の履歴が繋がる。

1. **経路サービスを OSRM → Valhalla（歩行者）に変更。** 理由は §4-1 の実測結果。
   OSRMを本番で使うなら自前運用が必要。
2. **Overpassは User-Agent 必須、回数制限あり。** §5のキャッシュ必須という判断の裏付けが取れた。

---

## 8. ポートフォリオとして公開するときの残作業

- **Vercelにデプロイ**してURLを作る（環境変数は管理画面に登録。`.env.local` はpushされない）
- **デモモードを付ける**。位置情報アプリは採用担当がその場で試せないため、
  固定座標で動かせるボタンを置く。開発ツールを開かせないことが重要
- **実際に歩いた操作の録画（GIF/動画）** をREADMEの先頭に置く
- README に「なぜ作ったか」と「§4の技術的判断」を書く。ここが一番の差別化になる
- 公開前チェック: `service_role` キーがコミットされていないか、
  地図の `© OpenStreetMap contributors` を消していないか
- 仕様書§2.2の「お題は到着まで伏せる」は未実装。現在は目的地名を表示している
