-- ============================================================================
-- アルクエスト — データベース定義（確定版・2枚カード方式）
--
-- 使い方: Supabase の SQL Editor にこのファイルの中身を貼って実行する。
--         何度実行しても同じ結果になるように書いてある（if not exists / on conflict）。
--
-- 前提（先に画面から設定しておくこと）:
--   1. Database → Extensions → postgis を有効化
--      （SQLで直に入れると public スキーマに入り、あとで警告される）
--   2. Authentication → Sign In / Providers → Anonymous sign-ins を ON
--      （このアプリはログイン画面を作らず、匿名ログインだけで使う）
--
-- 仕様書: ARQUEST_PROJECT_BRIEF.md §6
-- カード: CARDS.md（ここに投入する92枚の出どころ）
--
-- ----------------------------------------------------------------------------
-- ⚠ 2026-08-26 追記 — アプリから使われなくなった表がある
--
-- 2026-08-22 に位置情報を全廃した（HANDOFF.md §1.4）。
-- 表と過去のデータはそのまま残してあるが、次のものはもう読み書きされない。
--
--   pois / poi_searches       スポットのキャッシュ（§1・§2）
--   quest_trajectories        歩いた軌跡（§4）
--   visited_cells             塗った地図のマス（§4）
--   users.total_distance_m    通算の距離
--   daily_activity_stats      日ごとの集計（距離のぶん）
--   pois_within / poi_search_covered   位置情報用の関数（§5）
--
-- 消していないのは、消すのが戻せない操作だからである。
-- 整理するなら、通知（段階6）まで進めて全体像が固まってからでよい。
--
-- complete_quest は使い続けている。距離と座標の引数に既定値があるので、
-- 渡さなければ「距離0・地図を塗らない」として動く。関数側は変更していない。
-- その結果、EXPは「できた20／まだ10」の固定になった。
-- ----------------------------------------------------------------------------
-- ============================================================================


-- ============================================================================
-- 0. 拡張
-- ============================================================================

-- 位置情報を扱うための拡張。上記のとおり画面から入れるのが本筋だが、
-- 入っていない環境でも動くように書いておく。
create extension if not exists postgis;


-- ============================================================================
-- 1. スポットのキャッシュ（仕様書§2.4「通り道のスポット」専用）
--
-- クエストの行き先ではない。移動カードは座標を持たないので、
-- ここのデータが無くてもクエストは成立する。
-- ============================================================================

create table if not exists pois (
  id bigint generated always as identity primary key,
  source_id text not null unique,        -- OSM上のID（例: "node/123456"）
  name text not null,
  category text not null,                -- explore / nature / meet / errand
  geom geography(Point, 4326) not null,  -- 地球が丸いことを考慮して距離を測れる型
  cached_at timestamptz not null default now()
);

-- gist は位置情報専用の索引。普通の索引は大小の並び順で探すので、
-- 「この円の中にあるか」という2次元の問いには使えない。
create index if not exists pois_geom_idx on pois using gist (geom);
create index if not exists pois_cached_at_idx on pois (cached_at);

-- 「どの範囲を調べ終わったか」の記録。
-- これが無いと「半径内に1件でもあればキャッシュ命中」と誤判定し、
-- 少し移動しただけで欠けた結果を返し続ける（HANDOFF.md §4-7）。
create table if not exists poi_searches (
  id bigint generated always as identity primary key,
  center geography(Point, 4326) not null,
  radius_m integer not null,
  searched_at timestamptz not null default now()
);

create index if not exists poi_searches_center_idx on poi_searches using gist (center);
create index if not exists poi_searches_searched_at_idx on poi_searches (searched_at);


-- ----------------------------------------------------------------------------
-- 1-1. スポット検索の関数（PostgRESTでは書けない空間条件をSQL側に置く）
-- ----------------------------------------------------------------------------

-- この範囲は最近調べたか？
--
-- 判定は「今回の円が、過去の円の中に完全に収まるか」。
--   中心間の距離 + 今回の半径 <= 記録した半径
-- 「1件でもあるか」で判定してはいけない理由は HANDOFF.md §4-7 を参照。
create or replace function poi_search_covered(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_max_age_minutes integer
) returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from poi_searches s
    where s.searched_at > now() - make_interval(mins => p_max_age_minutes)
      and ST_Distance(s.center, ST_MakePoint(p_lng, p_lat)::geography) + p_radius_m
          <= s.radius_m
  );
$$;

-- 半径内のスポットを、近い順・距離つきで返す。
create or replace function pois_within(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer
) returns table (
  id bigint,
  source_id text,
  name text,
  category text,
  lat double precision,
  lng double precision,
  distance_m double precision
)
language sql
stable
as $$
  -- 列に別名（as lat など）を付けていないのは、
  -- returns table で宣言した名前と衝突して「あいまいだ」と怒られるのを避けるため。
  -- 返る列の名前は returns table の宣言のほうから決まる。
  select
    p.id,
    p.source_id,
    p.name,
    p.category,
    ST_Y(p.geom::geometry),
    ST_X(p.geom::geometry),
    ST_Distance(p.geom, ST_MakePoint(p_lng, p_lat)::geography)
  from pois p
  where ST_DWithin(p.geom, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by ST_Distance(p.geom, ST_MakePoint(p_lng, p_lat)::geography);
$$;


-- ============================================================================
-- 2. 利用者
--
-- 認証そのものは Supabase の auth.users が持つ。ここはアプリ側の情報だけ。
-- 匿名ログインでも auth.users に行ができるので、同じ仕組みで動く。
-- ============================================================================

create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,                                  -- 匿名利用のときは null
  display_name text not null default 'ぼうけんしゃ',
  companion_level integer not null default 1,
  companion_exp integer not null default 0,
  total_distance_m integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  weekday_start time not null default '18:00',
  weekday_end time not null default '21:00',
  weekend_start time not null default '10:00',
  weekend_end time not null default '18:00',
  -- 移動中に距離・通り道のスポット・ルートを表示するか（仕様書§2.4）。
  -- 既定は false。オンにすると移動中も位置情報が動く。
  show_walking_info boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 新しく登録された人に、users と user_settings の行を自動で作る。
--
-- 匿名ログインは「アプリを開いた瞬間」に起きるので、
-- 画面側から2つの表に行を作らせると、失敗したときに中途半端な状態が残る。
-- 登録の副作用としてデータベース側で作ってしまうほうが確実。
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ============================================================================
-- 3. カード（仕様書§2.2・§2.3／中身は CARDS.md）
--
-- 1行 = 1枚の文面。骨格と変数には分けていない（確定版のテーブルが label 1列のため）。
-- ============================================================================

create table if not exists movement_cards (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  -- walk_only … 平日・休日どちらでも引く
  -- transit_ok … 休日だけ引く（電車・バスを使う指示）
  transport_mode text not null check (transport_mode in ('walk_only', 'transit_ok')),
  -- 気に入らないカードを止めるための列。仕様書§6には無い（下記「仕様書への追加」参照）
  is_active boolean not null default true
);

create table if not exists action_cards (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  -- お金を使うお題か（仕様書§1。金額の上限は設けない）
  involves_spending boolean not null default false,
  -- 写真を撮るお題か。達成後に日記の投稿へ進む導線を出し分けるのに使う
  requires_photo boolean not null default false,
  is_active boolean not null default true
);


-- ============================================================================
-- 4. クエスト（1回分の遊び）
-- ============================================================================

create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  movement_card_id uuid not null references movement_cards(id),
  -- 行動カードは到着後に引くので、それまでは null
  action_card_id uuid references action_cards(id),
  -- 行動カードの引き直し回数。上限2（仕様書§2.3）
  action_redraw_count integer not null default 0 check (action_redraw_count <= 2),
  -- moving … 移動中（位置情報は使わない）
  -- acting … 行動カードを引いた後（ここから軌跡を記録する）
  -- done   … 終了
  status text not null default 'moving' check (status in ('moving', 'acting', 'done')),
  -- できた / まだ の自己申告（仕様書§2.5）。まだ終わっていない間は null。
  -- 「まだ」でも来たことは記録されるので、status は done になる
  action_result text check (action_result in ('done', 'not_yet')),
  action_started_at timestamptz,   -- 行動カードを引いた瞬間＝軌跡記録の開始点
  completed_at timestamptz,
  completion_lat double precision, -- 完了時の位置。地図塗りに使う
  completion_lng double precision,
  photo_url text,
  completed_via text not null default 'self_report',
  batch_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 「進行中のクエストがあるか」を毎回引くので索引を張る（仕様書§2.6の復帰処理）
create index if not exists quests_user_status_idx on quests (user_id, status);
create index if not exists quests_user_created_idx on quests (user_id, created_at desc);

-- 進行中のクエストは1人1件までにする。
-- 二重に引けてしまうと、どちらに「着いた」を押したのか分からなくなる。
create unique index if not exists quests_one_active_per_user
  on quests (user_id)
  where status in ('moving', 'acting');

create table if not exists quest_trajectories (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references quests(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null
);

create index if not exists quest_trajectories_quest_idx
  on quest_trajectories (quest_id, recorded_at);


-- ============================================================================
-- 5. 地図塗り（方式B：訪れたマスだけを塗る／仕様書§2.8・§7）
-- ============================================================================

create table if not exists visited_cells (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  cell_x integer not null,   -- 経度 ÷ グリッドの大きさ
  cell_y integer not null,   -- 緯度 ÷ グリッドの大きさ
  first_visited_at timestamptz not null default now(),
  visit_count integer not null default 1,
  unique (user_id, cell_x, cell_y)
);

-- グリッドの大きさ（度）。0.001度は緯度でおよそ111m、
-- 日本の緯度では経度でおよそ91m。ほぼ100m四方のマスになる。
--
-- 仕様書§7のとおり「1マスが何mか」は未確定。ここを変えると
-- 過去に塗ったマスと番号が合わなくなるので、変えるなら visited_cells を作り直すこと。
create or replace function grid_cell(p_value double precision)
returns integer
language sql
immutable
as $$
  select floor(p_value / 0.001)::integer;
$$;

-- 完了地点のマスを塗る。すでに塗ってあれば訪問回数を足すだけ。
create or replace function paint_visited_cell(
  p_user_id uuid,
  p_lat double precision,
  p_lng double precision
) returns void
language sql
as $$
  insert into visited_cells (user_id, cell_x, cell_y)
  values (p_user_id, grid_cell(p_lng), grid_cell(p_lat))
  on conflict (user_id, cell_x, cell_y)
  do update set visit_count = visited_cells.visit_count + 1;
$$;


-- ----------------------------------------------------------------------------
-- 5-1. クエストを終える（ごほうび・地図塗り・日ごとの記録をまとめて行う）
--
-- ■ なぜ1つの関数にまとめるのか
--   終了時にやることが4つある（クエストの更新／EXP／マスを塗る／日ごとの集計）。
--   画面から4回に分けて頼むと、途中で通信が切れたときに
--   「クエストは終わったのにEXPが増えていない」という半端な状態が残る。
--   1回の呼び出しにまとめれば、途中で失敗しても全部なかったことになる。
--
-- ■ security invoker（既定）のままにしている
--   呼んだ人の権限で動くので、RLSがそのまま効く。
--   他人のクエストを終わらせようとしても、更新対象が見つからずエラーになる。
-- ----------------------------------------------------------------------------

-- 先に消してから作り直す。
--
-- `create or replace` は**戻り値の形を変えられない**（列の名前や型を変えると
-- 「cannot change return type of existing function」で止まる）。
-- このファイルは何度でも貼り直せることが大事なので、先に drop しておく。
-- 権限（grant）も一緒に消えるが、§7で付け直しているので問題ない。
drop function if exists complete_quest(
  uuid, text, integer, double precision, double precision
);

create function complete_quest(
  p_quest_id uuid,
  p_result text,
  p_distance_m integer default 0,
  p_lat double precision default null,
  p_lng double precision default null
) returns table (
  -- 戻り値の名前は、テーブルの列名と重ならないものにしてある。
  -- companion_exp や distance_m のように同じ名前にすると、
  -- 関数の中で「どちらを指しているのか分からない」とエラーになる
  -- （column reference "companion_exp" is ambiguous）。
  exp_gained integer,
  total_exp integer,
  level_now integer,
  walked_m integer,
  new_cell boolean
)
language plpgsql
as $$
declare
  v_user uuid;
  v_gain integer;
  v_exp integer;
  v_level integer;
  v_new_cell boolean := false;
begin
  -- ① クエストを終わりにする
  update quests q
  set status = 'done',
      action_result = p_result,
      completed_at = now(),
      completion_lat = p_lat,
      completion_lng = p_lng
  where q.id = p_quest_id
    and q.status <> 'done'
  returning q.user_id into v_user;

  if v_user is null then
    raise exception 'クエストが見つからないか、すでに終わっています';
  end if;

  -- ② ごほうび
  --
  -- できた 20 ／ まだ 10。**「まだ」でも0にはしない。**
  -- できなかったことを咎めない設計なので、来たこと自体にごほうびを出す（仕様書§2.5）。
  -- そこに歩いた距離 100mごとに1を足す。
  v_gain := (case when p_result = 'done' then 20 else 10 end)
            + floor(coalesce(p_distance_m, 0) / 100.0)::integer;

  update users u
  set companion_exp = u.companion_exp + v_gain,
      total_distance_m = u.total_distance_m + coalesce(p_distance_m, 0)
  where u.id = v_user
  returning u.companion_exp into v_exp;

  -- レベルは持ち回さず、EXPから計算し直す。
  -- 二重に足す事故が起きないし、必要な数を変えたら過去のぶんも揃う。
  v_level := greatest(1, floor(v_exp / 500.0)::integer + 1);
  update users u set companion_level = v_level where u.id = v_user;

  -- ③ 地図を塗る（完了地点のマスだけ。仕様書§2.8）
  if p_lat is not null and p_lng is not null then
    select not exists (
      select 1 from visited_cells
      where user_id = v_user
        and cell_x = grid_cell(p_lng)
        and cell_y = grid_cell(p_lat)
    ) into v_new_cell;

    perform paint_visited_cell(v_user, p_lat, p_lng);
  end if;

  -- ④ 日ごとの記録
  insert into daily_activity_stats as d (user_id, activity_date, distance_m, quests_completed)
  values (v_user, current_date, coalesce(p_distance_m, 0), 1)
  on conflict (user_id, activity_date) do update
    set distance_m = d.distance_m + excluded.distance_m,
        quests_completed = d.quests_completed + 1;

  return query
    select v_gain, v_exp, v_level, coalesce(p_distance_m, 0), v_new_cell;
end;
$$;


-- ============================================================================
-- 6. 日記（非公開）と、日ごとの記録
-- ============================================================================

create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  quest_id uuid references quests(id) on delete set null,
  photo_url text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists diary_entries_user_idx
  on diary_entries (user_id, created_at desc);

create table if not exists daily_activity_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  activity_date date not null,
  distance_m integer not null default 0,
  quests_completed integer not null default 0,
  unique (user_id, activity_date)
);


-- ----------------------------------------------------------------------------
-- 6-1. 日記の写真を置く場所（Supabase Storage）
--
-- ■ 非公開バケットにする
--   public を false にすると、URLを知っていても中身は取れない。
--   写真を見るときは、その都度**期限つきのURL**を発行して読む。
--   仕様書§2.10の「完全に非公開」を、置き場所のレベルで守る。
--
-- ■ 置き場所の決まり
--   diary/<利用者のID>/<ファイル名> という形にする。
--   フォルダ名が利用者のIDなので、「自分のフォルダの中だけ触れる」という
--   規則を下のポリシーで書ける。
--
-- ■ 大きさと種類を制限する
--   スマホの写真はそのままだと5MBを超えることがある。
--   アップロード前に縮小しているが（EXIF削除も兼ねる。src/lib/diary.ts）、
--   壊れた画像や別の形式が来たときのために、こちら側でも上限を決めておく。
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('diary', 'diary', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 自分のフォルダの中だけ、読み書きできる。
-- storage.foldername(name) はパスをフォルダごとに分けた配列を返すので、
-- その1つ目（＝利用者のID）が自分と一致するかを見る。
drop policy if exists diary_photos_select on storage.objects;
create policy diary_photos_select on storage.objects for select
  using (
    bucket_id = 'diary'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists diary_photos_insert on storage.objects;
create policy diary_photos_insert on storage.objects for insert
  with check (
    bucket_id = 'diary'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists diary_photos_delete on storage.objects;
create policy diary_photos_delete on storage.objects for delete
  using (
    bucket_id = 'diary'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ============================================================================
-- 7. 権限とRLS
--
-- このプロジェクトは「新しい表を自動で公開しない」設定にしてあるので、
-- 表を作るたびにここで権限を付ける必要がある。
--
-- 匿名ログインの利用者も役割は authenticated になる。
-- 「自分の行だけ読み書きできる」を auth.uid() で表す。
-- ============================================================================

alter table pois                 enable row level security;
alter table poi_searches         enable row level security;
alter table users                enable row level security;
alter table user_settings        enable row level security;
alter table movement_cards       enable row level security;
alter table action_cards         enable row level security;
alter table quests               enable row level security;
alter table quest_trajectories   enable row level security;
alter table visited_cells        enable row level security;
alter table diary_entries        enable row level security;
alter table daily_activity_stats enable row level security;

-- サーバー（Route Handler）は秘密キーで動くのでRLSを素通りする。
grant all on table pois, poi_searches to service_role;
grant all on table users, user_settings to service_role;
grant all on table movement_cards, action_cards to service_role;
grant all on table quests, quest_trajectories to service_role;
grant all on table visited_cells, diary_entries, daily_activity_stats to service_role;

-- 画面（ブラウザ）から触る表。RLSで守るので、権限は素直に渡してよい。
grant select on table movement_cards, action_cards to authenticated;

-- **pois は画面から読ませない。**
--
-- スポットの中身そのものはOSMの公開データだが、
-- この表は全利用者で共有するキャッシュなので、**中身を全部見ると
-- 「誰かがどのあたりを検索したか」が分かる**。利用者が1人なら、
-- それはそのまま「その人がどのあたりを歩いたか」になる。
--
-- 画面は /api/pois（サーバー）経由でしか読んでいないので、
-- ここを閉じても動作は変わらない。
revoke select on table pois from authenticated;
revoke select on table pois from anon;
grant select, insert, update on table users, user_settings to authenticated;
-- クエストは delete を渡していない。
-- 「やめる」は行を消さず、状態を done にして結果を空のままにする（src/lib/quest.ts）。
-- 消す権限を渡さずに済むほうが、間違って消える余地が無い。
grant select, insert, update on table quests to authenticated;
grant select, insert on table quest_trajectories to authenticated;
grant select, insert, update on table visited_cells to authenticated;
grant select, insert, update, delete on table diary_entries to authenticated;
grant select, insert, update on table daily_activity_stats to authenticated;

-- クエストを終える関数は画面から呼ぶ（§5-1）。
-- 関数の中身は呼んだ人の権限で動くので、他人のクエストは終わらせられない。
grant execute on function complete_quest(
  uuid, text, integer, double precision, double precision
) to authenticated;

-- 移動カードだけは、ログインしていない状態（anon）でも読めるようにする。
--
-- 無料プランは1週間ほど使わないとプロジェクトが一時停止するため、
-- GitHub Actions から毎日1回このテーブルを読んで「使っている」ことを示す
-- （.github/workflows/keep-alive.yml）。そのリクエストはログインしていないので anon になる。
--
-- カードの文面は CARDS.md として公開リポジトリに載せているものなので、
-- 読めて困る情報ではない。利用者のデータ（quests など）は一切開けていない。
grant select on table movement_cards to anon;

-- スポットとカードは全員が読む。書き込みはサーバーだけ。
drop policy if exists pois_select_all on pois;
create policy pois_select_all on pois for select using (true);

drop policy if exists movement_cards_select_all on movement_cards;
create policy movement_cards_select_all on movement_cards for select using (true);

drop policy if exists action_cards_select_all on action_cards;
create policy action_cards_select_all on action_cards for select using (true);

-- 自分の行だけ、を1つずつ書く。
drop policy if exists users_own on users;
create policy users_own on users
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists user_settings_own on user_settings;
create policy user_settings_own on user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists quests_own on quests;
create policy quests_own on quests
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 軌跡は quest 経由で持ち主を確かめる（quest_trajectories 自体に user_id が無いため）
drop policy if exists quest_trajectories_own on quest_trajectories;
create policy quest_trajectories_own on quest_trajectories
  for all using (
    exists (
      select 1 from quests q
      where q.id = quest_trajectories.quest_id and q.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from quests q
      where q.id = quest_trajectories.quest_id and q.user_id = auth.uid()
    )
  );

drop policy if exists visited_cells_own on visited_cells;
create policy visited_cells_own on visited_cells
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists diary_entries_own on diary_entries;
create policy diary_entries_own on diary_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists daily_activity_stats_own on daily_activity_stats;
create policy daily_activity_stats_own on daily_activity_stats
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ============================================================================
-- 8. カードの投入（CARDS.md の92枚）
--
-- on conflict (label) do update にしてあるので、
-- このファイルを貼り直せば文面の修正もそのまま反映される。
-- ============================================================================

-- 移動カード：徒歩のみ（平日・休日ともに引く）— 20枚
insert into movement_cards (label, transport_mode) values
  ('15分、てきとうに歩こう', 'walk_only'),
  ('30分、てきとうに歩こう', 'walk_only'),
  ('45分、てきとうに歩こう', 'walk_only'),
  ('1km、歩こう', 'walk_only'),
  ('2km、歩こう', 'walk_only'),
  ('行ったことない道を歩こう', 'walk_only'),
  ('いつもと逆の方向へ、20分歩こう', 'walk_only'),
  ('分かれ道では、いつも右を選ぼう', 'walk_only'),
  ('分かれ道では、いつも左を選ぼう', 'walk_only'),
  ('サイコロの目のぶんだけ、角を曲がろう', 'walk_only'),
  ('交差点を5つこえたところで、とまろう', 'walk_only'),
  ('最初に見えた赤いものの方向へ歩こう', 'walk_only'),
  ('最初に見えた青いものの方向へ歩こう', 'walk_only'),
  ('いちばん静かなほうへ歩こう', 'walk_only'),
  ('まっすぐ歩けるところまで、まっすぐ歩こう', 'walk_only'),
  ('上り坂を見つけたら、のぼりきってみよう', 'walk_only'),
  ('大きな木が見えたら、そこまで歩こう', 'walk_only'),
  ('知らないバス停を見つけるまで歩こう', 'walk_only'),
  ('名前の読めない建物を見つけるまで歩こう', 'walk_only'),
  ('いちばん細い道を選んで、10分歩こう', 'walk_only')
on conflict (label) do update set transport_mode = excluded.transport_mode;

-- 移動カード：交通機関あり（休日だけ引く）— 12枚
insert into movement_cards (label, transport_mode) values
  ('3駅先で降りて、そこから歩こう', 'transit_ok'),
  ('4駅先で降りて、そこから歩こう', 'transit_ok'),
  ('降りたことない駅で、降りてみよう', 'transit_ok'),
  ('降りたことないバス停で、降りてみよう', 'transit_ok'),
  ('次に来た電車に乗って、3つ目で降りよう', 'transit_ok'),
  ('各駅停車に10分だけ乗って、降りよう', 'transit_ok'),
  ('乗り換えを1回だけして、着いたところで降りよう', 'transit_ok'),
  ('反対方向のホームから、5駅先へ行こう', 'transit_ok'),
  ('バスに乗って、名前が気になった停留所で降りよう', 'transit_ok'),
  ('路線図を見て、行ったことない駅をひとつ選ぼう', 'transit_ok'),
  ('快速が止まらない駅で、降りてみよう', 'transit_ok'),
  ('終点のひとつ手前で、降りよう', 'transit_ok')
on conflict (label) do update set transport_mode = excluded.transport_mode;

-- 行動カード：さがす — 21枚
insert into action_cards (label) values
  ('用途がわからないものを見つけよう'),
  ('ぱ行の名前のものを見つけよう'),
  ('いちばん古そうなものを見つけよう'),
  ('南米っぽいものを見つけよう'),
  ('名前が読めないものを見つけよう'),
  ('まっすぐでないものを見つけよう'),
  ('音がしそうなものを見つけよう'),
  ('さわると冷たそうなものを見つけよう'),
  ('去年からずっとありそうなものを見つけよう'),
  ('だれも見ていないものを見つけよう'),
  ('高いところにある看板を見つけよう'),
  ('赤いものを3つ見つけよう'),
  ('青いものを3つ見つけよう'),
  ('黄色いものを3つ見つけよう'),
  ('同じものが2つ以上ならんでいるところを見つけよう'),
  ('ここで一番背の高いものを見つけよう'),
  ('つかわれていなさそうなものを見つけよう'),
  ('いばっているものを見つけよう'),
  ('つかれていそうなものを見つけよう'),
  ('しあわせそうなものを見つけよう'),
  ('だれかに似ているものを見つけよう')
on conflict (label) do nothing;

-- 行動カード：見くらべる・えらぶ — 12枚
insert into action_cards (label) values
  ('階段を3つ見くらべて、優勝を決めよう'),
  ('自動販売機を3つ見くらべて、優勝を決めよう'),
  ('室外機を3つ見くらべて、優勝を決めよう'),
  ('電柱を3つ見くらべて、優勝を決めよう'),
  ('マンホールを3つ見くらべて、優勝を決めよう'),
  ('いちばん遠くに見えるものまで、目だけで行ってみよう'),
  ('ここで一番いい席を決めよう（すわらなくていい）'),
  ('持って帰れないものの中から、持って帰りたいものを1つ選ぼう'),
  ('恩師への手土産を見つくろおう（買わなくていい）'),
  ('昔の自分への手土産を見つくろおう（買わなくていい）'),
  ('猫への手土産を見つくろおう（買わなくていい）'),
  ('宇宙人への手土産を見つくろおう（買わなくていい）')
on conflict (label) do nothing;

-- 行動カード：ことばにする — 7枚
insert into action_cards (label) values
  ('この場所に、新しい名前をつけよう'),
  ('100年後の人に、ここを一文で説明しよう'),
  ('宇宙人に、ここを一文で説明しよう'),
  ('まだ会ったことのない友だちに、ここを一文で説明しよう'),
  ('いま見えている景色に、字幕を1行つけよう'),
  ('ここで川柳を1つ詠もう'),
  ('この道に、キャッチコピーをつけよう')
on conflict (label) do nothing;

-- 行動カード：からだ — 4枚
insert into action_cards (label) values
  ('目を閉じて、聞こえる音を3つ数えよう'),
  ('しゃがんで、さっきと見え方がどう違うか確かめよう'),
  ('手のひらで、風の向きを確かめよう'),
  ('深呼吸を3回して、においを言葉にしよう')
on conflict (label) do nothing;

-- 行動カード：記録・写真 — 6枚（撮影に進むので requires_photo を立てる）
insert into action_cards (label, requires_photo) values
  ('まったく映えない写真を1枚撮ろう', true),
  ('きょういちばんの1枚を撮ろう', true),
  ('足元の写真を1枚撮ろう', true),
  ('空の写真を1枚撮ろう', true),
  ('影の写真を1枚撮ろう', true),
  ('三角のものの写真を1枚撮ろう', true)
on conflict (label) do update set requires_photo = excluded.requires_photo;

-- 行動カード：お金をつかう — 10枚
insert into action_cards (label, involves_spending) values
  ('いちばんいらないものを買おう', true),
  ('名前がいちばん長いおかしを買おう', true),
  ('見たことないパッケージの飲みものを買おう', true),
  ('自動販売機で、いちばん右下のボタンを押そう', true),
  ('いつもは通りすぎる棚から、1つ選ぼう', true),
  ('買ったことない味を1つ買おう', true),
  ('いちばん小さいものを買おう', true),
  ('だれかへのおみやげのつもりで、1つ買おう（渡さなくていい）', true),
  ('ガチャガチャを1回まわそう', true),
  ('パッケージの色だけで、1つ選ぼう', true)
on conflict (label) do update set involves_spending = excluded.involves_spending;


-- ============================================================================
-- 9. 確認用
-- ============================================================================

-- 投入されたか（移動32枚・行動60枚になるはず）
--   select transport_mode, count(*) from movement_cards group by transport_mode;
--   select involves_spending, requires_photo, count(*) from action_cards
--     group by involves_spending, requires_photo;

-- 平日に引ける移動カードを1枚（抽選のしかたの確認）
--   select label from movement_cards
--   where is_active and transport_mode = 'walk_only'
--   order by random() limit 1;
