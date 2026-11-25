import { registerSW } from "virtual:pwa-register";

/**
 * PWA(ホーム画面/デスクトップにインストールして単独起動)として使っている場合、新しい
 * Service Workerの検知は既定でブラウザ自身の自動チェック(ページ遷移ごと、かつ最大24時間に
 * 1回まで間引かれる仕様)に依存してしまう — vite.config.tsのregisterType:"autoUpdate"で
 * skipWaiting/clientsClaimは設定済みだが、そもそも更新チェック自体が走らないと意味がない。
 * この間引きは「ブラウザが自発的に行う暗黙のチェック」に対してのものなので、
 * registration.update()を明示的に呼べば常にすぐチェックできる(頻繁にpushする運用のため、
 * 起動時とアプリがフォアグラウンドに戻るたびに明示チェックする)。新しいSWが見つかれば
 * registerType:"autoUpdate"により自動で再読み込みされる。
 */
export function setupPwaAutoUpdate(): void {
  if (!("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
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
