#!/usr/bin/env node
// TapTap 官方小游戏 MCP(@taptap/instant-games-open-mcp)的极简 stdio 驱动。
// 用途:在 ZCode 会话内(未注册 MCP 工具时)直接调用其工具,如 upload_h5_game。
// 用法:
//   node scripts/taptap-mcp.mjs list
//   node scripts/taptap-mcp.mjs call <toolName> '{"json":"args"}'
// 说明:MCP stdio = 每行一个 JSON-RPC 消息;OAuth token 由服务端持久化在
//       ~/.config/taptap-minigame/,跨进程调用不丢。
import { spawn } from "node:child_process";

const mode = process.argv[2];
const toolName = process.argv[3];
const argsJson = process.argv[4] ?? "{}";
if (mode !== "list" && mode !== "call" && mode !== "oauth") {
  console.error("usage: taptap-mcp.mjs list | call <tool> '{...}' | oauth");
  process.exit(2);
}

const child = spawn("cmd", ["/c", "npx", "-y", "@taptap/instant-games-open-mcp@latest"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, TAPTAP_MCP_WORKSPACE_ROOT: process.cwd() },
});

let buf = "";
const pending = new Map();
let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }  // 非 JSON 横幅行跳过
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
child.on("exit", (code) => {
  if (pending.size) {
    for (const [, fn] of pending) fn({ error: { message: "server exited, code=" + code } });
    pending.clear();
  }
});
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
  send({ jsonrpc: "2.0", id, method, params });
});
const hardTimeout = setTimeout(() => { console.error("[driver] timeout"); child.kill(); process.exit(1); }, 240_000);

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "abyss-driver", version: "1.0" },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });

if (mode === "list") {
  const res = await rpc("tools/list", {});
  console.log(JSON.stringify(res.tools.map((t) => ({
    name: t.name, inputSchema: t.inputSchema,
  })), null, 1));
} else if (mode === "oauth") {
  // 设备码流程必须单进程内闭环:start 生成码(存盘供展示)→ 每 5s 轮询 complete,
  // 用户扫码授权后同进程拿到 token 并由服务端持久化(跨进程无状态,拆开必丢)。
  const { writeFileSync } = await import("node:fs");
  const res = await rpc("tools/call", { name: "start_oauth_authorization", arguments: {} });
  const text = res.content.find((c) => c.type === "text")?.text ?? "";
  const img = res.content.find((c) => c.type === "image")?.data;
  const link = (text.match(/https:\/\/www\.taptap\.cn\/tap-qrcode[^\)\s]*/) ?? [])[0] ?? "";
  if (img) writeFileSync(".zcode/oauth-qr.png", Buffer.from(img, "base64"));
  writeFileSync(".zcode/oauth-link.txt", link);
  console.log("QR_READY " + link);
  for (let i = 0; i < 22; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const done = await rpc("tools/call", { name: "complete_oauth_authorization", arguments: {} });
      console.log("OAUTH_DONE " + JSON.stringify(done).slice(0, 300));
      break;
    } catch { /* 尚未授权,继续轮询 */ }
  }
} else {
  const res = await rpc("tools/call", { name: toolName, arguments: JSON.parse(argsJson) });
  console.log(JSON.stringify(res, null, 1));
}
clearTimeout(hardTimeout);
child.kill();
process.exit(0);
