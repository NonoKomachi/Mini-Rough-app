import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Artifact公開やElectronのfile://読み込みなど、ドメイン直下以外(サブパス/file://)に置かれても
  // 動くよう常に相対パスで参照する(既定の"/"だとルート直下以外ではアセットが404してアプリが
  // 真っ白になる — まさにArtifact公開後に発生した不具合)。
  base: "./",
  resolve: {
    alias: {
      "@mini-rough/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@mini-rough/clip-io": path.resolve(__dirname, "../clip-io/src/index.ts")
    }
  },
  server: {
    // PORTが指定されていれば優先する(同時に複数の開発サーバーを立てる場合など)。
    port: Number(process.env.PORT) || 5173,
    strictPort: false
  },
  plugins: [
    VitePWA({
      // 頻繁にpushする運用なので、Service Workerの更新確認は「次回アクセス時に自動で最新へ
      // 切り替え」(ユーザー操作不要)にする — 古いキャッシュのまま固定されてしまう事故を防ぐ。
      registerType: "autoUpdate",
      workbox: {
        // 本体バンドル(libclipのWASMモジュールを埋め込み済みで約2MB)がWorkboxの既定上限
        // (2MiB)ぎりぎりのため、余裕を持って引き上げておく。
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024
      },
      manifest: {
        lang: "ja",
        name: "ミニラフ小町",
        short_name: "ミニラフ小町",
        description: "CLIP STUDIO PAINT風のお絵描きツール",
        start_url: ".",
        display: "standalone",
        background_color: "#2b2b2b",
        theme_color: "#2b2b2b",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ]
});
