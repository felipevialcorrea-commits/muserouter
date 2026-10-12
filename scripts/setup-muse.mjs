// One-time setup for the built-in Muse engine (vendored muse2api):
// creates engine/muse2api/.venv and installs its Python requirements.
// Cross-platform (Windows/macOS/Linux). Run: npm run setup:muse
// A Chromium/Chrome install is also required by the engine at generation
// time; on Linux use your package manager, or use the Docker profile.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "engine", "muse2api");
const venvDir = path.join(engineDir, ".venv");
const venvPy = process.platform === "win32"
  ? path.join(venvDir, "Scripts", "python.exe")
  : path.join(venvDir, "bin", "python");

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`Lệnh trên thất bại (exit ${r.status}).`); process.exit(r.status || 1); }
}
function findPython() {
  for (const cand of process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"]) {
    const r = spawnSync(cand, ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
    if (r.status === 0) return cand;
  }
  return null;
}

const py = findPython();
if (!py) {
  console.error("Không thấy Python 3.10+. Cài Python từ https://www.python.org/downloads/ rồi chạy lại: npm run setup:muse");
  process.exit(1);
}
if (!fs.existsSync(venvPy)) run(py, ["-m", "venv", ".venv"], engineDir);
run(venvPy, ["-m", "pip", "install", "--upgrade", "pip"], engineDir);
run(venvPy, ["-m", "pip", "install", "-r", "requirements.txt"], engineDir);
console.log("✅ Engine Muse đã sẵn sàng. Chạy `npm start` rồi vào dashboard để đăng nhập Muse.");
