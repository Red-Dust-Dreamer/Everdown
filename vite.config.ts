import { defineConfig, type Connect, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

// 部署到 GitHub Pages 项目页(/Everdown/ 子路径)时:
//   VITE_BASE=/Everdown/ npx vite build --outDir dist-gh
// 本地 dev/preview 保持根路径(base=/)不变。
// MPA 第二入口:src/web/admin/ 本地管理面板(docs/admin-panel.md)。

const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------- dev 桥
// adminDevBridge:仅 dev server 生效(apply:"serve"),把仓库根 save.json /
// overrides.json 通过 HTTP 白名单端点暴露给管理面板,写回前自动时间戳备份。
// 端点契约见 docs/admin-panel.md §7.C;不新增任何 npm 依赖。
const EXACT_FILES = new Set(["save.json", "overrides.json"]);
const BAK_RE = /^(save|overrides)\.json\.bak-\d{8}-\d{6}$/;
const BODY_LIMIT = 32 * 1024 * 1024;   // 32MB

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function bad(res: ServerResponse, msg: string): void {
  send(res, 400, { ok: false, error: msg });
}

function readBody(req: Connect.IncomingMessage, res: ServerResponse):
  Promise<Buffer | null> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > BODY_LIMIT) {
        done = true;
        bad(res, "body too large (limit 32MB)");
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", () => {
      if (!done) { done = true; bad(res, "read body error"); resolve(null); }
    });
  });
}

async function handleAdmin(req: Connect.IncomingMessage, res: ServerResponse,
                           url: URL): Promise<void> {
  const name = url.searchParams.get("name") ?? "";
  const route = url.pathname;
  if (req.method === "GET" && route === "/__admin/health") {
    send(res, 200, { ok: true, bridge: "v1" });
    return;
  }
  if (req.method === "GET" && route === "/__admin/backups") {
    let names: string[] = [];
    try { names = readdirSync(REPO_ROOT).filter(n => n.includes(".bak-")); }
    catch { /* 根目录不可读按空处理 */ }
    names.sort().reverse();
    send(res, 200, { ok: true, names: names.slice(0, 50) });
    return;
  }
  if (route === "/__admin/file") {
    if (req.method === "GET") {
      if (!EXACT_FILES.has(name) && !BAK_RE.test(name)) {
        bad(res, "name not allowed (save.json / overrides.json / their .bak-<ts>)");
        return;
      }
      const fp = REPO_ROOT + name;
      if (!existsSync(fp)) { send(res, 200, { ok: true, exists: false, content: null }); return; }
      send(res, 200, { ok: true, exists: true, content: readFileSync(fp, "utf8") });
      return;
    }
    if (req.method === "POST") {
      if (!EXACT_FILES.has(name)) { bad(res, "POST only accepts save.json / overrides.json"); return; }
      const body = await readBody(req, res);
      if (body === null) return;   // 已应答(超限/读错)
      const fp = REPO_ROOT + name;
      let backup: string | null = null;
      if (existsSync(fp)) {
        backup = `${name}.bak-${stamp()}`;
        copyFileSync(fp, REPO_ROOT + backup);
      }
      writeFileSync(fp, body);
      send(res, 200, { ok: true, bytes: body.length, backup });
      return;
    }
  }
  bad(res, `unknown route ${req.method} ${route}`);
}

function adminDevBridge(): Plugin {
  return {
    name: "abyss-admin-dev-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let url: URL;
        try {
          url = new URL(req.url ?? "/", "http://localhost");
        } catch {
          next();
          return;
        }
        if (!url.pathname.startsWith("/__admin/")) { next(); return; }
        handleAdmin(req, res, url).catch(err => {
          send(res, 500, { ok: false, error: String(err) });
        });
      });
    },
  };
}

export default defineConfig({
  root: "src/web",
  base: process.env.VITE_BASE ?? "/",
  publicDir: "public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./src/web/index.html", import.meta.url)),
        admin: fileURLToPath(new URL("./src/web/admin/index.html", import.meta.url)),
      },
    },
  },
  server: {
    port: 8614,
  },
  plugins: [adminDevBridge()],
});
