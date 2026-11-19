import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  }
});
