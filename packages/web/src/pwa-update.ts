import { registerSW } from "virtual:pwa-register";

/** main.ts側が登録する、更新を適用する直前に行うべき処理(現在の未保存の編集を自動保存
 * キャッシュ/Firebaseへ確実に書き出す等)。登録が無い場合はそのまま更新を適用する。 */
let beforeReloadFlush: (() => Promise<void>) | null = null;

export function setBeforeReloadFlush(flush: () => Promise<void>): void {
  beforeReloadFlush = flush;
}

/**
 * PWA(ホーム画面/デスクトップにインストールして単独起動)として使っている場合、新しい
 * Service Workerの検知は既定でブラウザ自身の自動チェック(ページ遷移ごと、かつ最大24時間に
 * 1回まで間引かれる仕様)に依存してしまう — そもそも更新チェック自体が走らないと意味がない。
 * この間引きは「ブラウザが自発的に行う暗黙のチェック」に対してのものなので、
 * registration.update()を明示的に呼べば常にすぐチェックできる(頻繁にpushする運用のため、
 * 起動時とアプリがフォアグラウンドに戻るたびに明示チェックする)。
 *
 * vite.config.tsのregisterType:"prompt"により、新しいSWが見つかってもすぐには
 * skipWaiting/reloadしない — ここ(onNeedRefresh)で、まずbeforeReloadFlush(あれば)を
 * 待ってから更新を適用する。これが無いと、PWAとして開いている最中に未保存の編集がある
 * 状態で突然リロードされ、次に開いた時に「編集していない古い画面」に見えてしまう事故が
 * あった(自動保存キャッシュ/Firebaseへの反映より早くリロードが起きてしまうため)。
 */
export function setupPwaAutoUpdate(): void {
  if (!("serviceWorker" in navigator)) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void (async () => {
        try {
          await beforeReloadFlush?.();
        } catch (err) {
          console.error(err);
        }
        void updateSW(true);
      })();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = (): void => void registration.update();
      setInterval(checkForUpdate, 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    }
  });
}
