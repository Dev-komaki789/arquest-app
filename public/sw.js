/**
 * ============================================================
 * Service Worker（サービスワーカー）
 * ============================================================
 *
 * ■ これは何？
 *   ブラウザがページとは別に動かしておく、小さな常駐プログラム。
 *   通信を横取りできるので、電波が切れたときの受け皿になる。
 *   段階6で入れる通知（Web Push）も、この仕組みの上で動く。
 *
 * ■ 何をしているか
 *   ふつうは何もせず、そのままネットワークに通す（network first）。
 *   通信に失敗したときだけ、以前に取っておいた内容を返す。
 *
 * ■ なぜ「先にキャッシュ」にしないのか
 *   このアプリの中身（カード・クエストの状態）は毎回変わる。
 *   古い内容を先に見せると「引いたはずのカードが出てこない」ことが起きる。
 *   速さより、**表示が正しいこと**を優先する。
 *
 * ■ オフラインでできること・できないこと
 *   電波が無いと、カードを引くことも記録することもできない（サーバーが要る）。
 *   ここで防げるのは「真っ白な画面が出る」ことだけ。
 *   歩いている最中に地下へ入っても、アプリの見た目は保たれる。
 */

const CACHE = "arquest-v1";

// 入れた直後から有効にする。
// これが無いと、いま開いているページが閉じられるまで新しい版が使われない。
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// 古い版のキャッシュを片付ける
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 読み取り以外（記録の保存など）は横取りしない。
  // 途中で握ると、書き込みが二重になったり失われたりする。
  if (request.method !== "GET") return;

  // Supabaseなど別のサーバーへの通信も、そのまま通す。
  // 認証の情報が絡むので、こちらで保存すべきではない。
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);

        // うまくいったぶんだけ、次の「圏外」に備えて control しておく
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // 通信できなかった。取ってあれば、それを返す
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("オフラインで、取っておいた内容もありません");
      }
    })(),
  );
});
