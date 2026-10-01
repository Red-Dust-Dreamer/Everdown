import { defineConfig } from "vite";

// 部署到 GitHub Pages 项目页(/Everdown/ 子路径)时:
//   VITE_BASE=/Everdown/ npx vite build --outDir dist-gh
// 本地 dev/preview 保持根路径(base=/)不变。
export default defineConfig({
  root: "src/web",
  base: process.env.VITE_BASE ?? "/",
  publicDir: "public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 8614,
  },
});
