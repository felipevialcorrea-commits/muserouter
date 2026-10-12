#!/usr/bin/env node
// MuseRouter CLI — install globally and run it like 9Router:
//   npm install -g muserouter        (hoặc: npm install -g github:<user>/muserouter)
//   muserouter                       -> starts the server + opens the dashboard
//   muserouter --port 21130          -> custom port
//   muserouter setup                 -> install the built-in Muse engine (one time)
//   muserouter --help
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
  console.log(`MuseRouter — AI router + Muse tích hợp (như 9Router, thêm Muse)

Cách dùng:
  muserouter                 Chạy server (mặc định port 21128) và mở dashboard
  muserouter --port <n>      Đổi port (mặc định 21128, tránh 9Router 20128)
  muserouter --host <addr>   Đổi địa chỉ bind (mặc định 0.0.0.0)
  muserouter --no-open       Không tự mở trình duyệt
  muserouter setup           Cài engine Muse tích hợp (1 lần, cần Python 3.10+)
  muserouter --version       Xem phiên bản

Dữ liệu (config, key, log) nằm ở ~/.muserouter/ — Windows: C:\\Users\\<tên>\\.muserouter\\`);
  process.exit(0);
}
if (args.includes("--version") || args[0] === "version") {
  const pkg = JSON.parse((await import("node:fs")).readFileSync(path.join(root, "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
if (args[0] === "setup") {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "setup-muse.mjs")], { stdio: "inherit" });
  process.exit(r.status || 0);
}

const portIdx = args.findIndex((a) => a === "--port" || a === "-p");
if (portIdx >= 0 && args[portIdx + 1]) process.env.PORT = args[portIdx + 1];
const hostIdx = args.findIndex((a) => a === "--host");
if (hostIdx >= 0 && args[hostIdx + 1]) process.env.HOST = args[hostIdx + 1];

const { startServer, PORT } = await import("./src/server.js");
startServer();

if (!args.includes("--no-open")) {
  const url = `http://localhost:${PORT}/dashboard`;
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  setTimeout(() => {
    try { spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" }).unref(); } catch {}
  }, 900);
}
