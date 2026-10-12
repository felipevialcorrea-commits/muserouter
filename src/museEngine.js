// Built-in Muse engine manager.
// MuseRouter vendors muse2api (MIT, see engine/NOTICE.md) and runs it as a
// managed child process, the way 9Router manages its providers internally:
// the user never installs or starts muse2api by hand.
//
// Ports (all NEW, chosen to avoid every neighbouring tool):
//   MuseRouter dashboard/API  21128
//   9Router                     20128 / dev 20127
//   standalone muse2api         18610, CDP 19210
//   -> embedded Muse engine     18611, CDP 19211
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.join(__dirname, "..", "engine", "muse2api");
export const ENGINE_PORT = Number(process.env.MUSE_ENGINE_PORT || 18611);
export const ENGINE_CDP_PORT = Number(process.env.MUSE_ENGINE_CDP_PORT || 19211);
import os from "node:os";
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), ".muserouter");
const STATE_FILE = path.join(DATA_DIR, "muse-engine.json");
const LOG_FILE = path.join(DATA_DIR, "muse-engine.log");
const VENV_DIR = path.join(ENGINE_DIR, ".venv");

let child = null;
let starting = null;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
  const state = { apiKey: `m2a_${crypto.randomBytes(18).toString("hex")}`, port: ENGINE_PORT };
  saveState(state);
  return state;
}
function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
export function engineKey() { return loadState().apiKey; }
export function engineBaseUrl() { return `http://127.0.0.1:${ENGINE_PORT}`; }
export function engineAdminUrl(hostHeader) {
  const host = (hostHeader || "localhost").split(":")[0];
  return `http://${host}:${ENGINE_PORT}/admin?key=${engineKey()}`;
}

function pythonBin() {
  const venvPy = process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
  if (fs.existsSync(venvPy)) return venvPy;
  return null;
}
export function depsReady() { return !!pythonBin(); }

export function setupStatus() {
  const flag = path.join(DATA_DIR, "muse-engine.setup.log");
  let tail = "";
  try { tail = fs.readFileSync(flag, "utf8").slice(-2000); } catch {}
  return { ready: depsReady(), logTail: tail };
}

// Create .venv inside engine/muse2api and pip-install its requirements.
// Runs detached; poll setupStatus() / museStatus().
export function startSetup() {
  if (depsReady()) return { started: false, reason: "already-ready" };
  if (setupRunning) return { started: false, reason: "already-running" };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(DATA_DIR, "muse-engine.setup.log"), "a");
  const script = path.join(__dirname, "..", "scripts", "setup-muse.mjs");
  const p = spawn(process.execPath, [script], { detached: true, stdio: ["ignore", log, log] });
  setupRunning = p;
  p.on("exit", () => { setupRunning = null; });
  p.unref();
  return { started: true };
}
let setupRunning = null;

async function engineFetch(pathname, opts = {}) {
  const r = await fetch(`${engineBaseUrl()}${pathname}`, {
    ...opts,
    headers: { authorization: `Bearer ${engineKey()}`, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 8000),
  });
  return r;
}

export async function museStatus() {
  const st = { enabled: process.env.MUSE_ENGINE !== "off", port: ENGINE_PORT, cdpPort: ENGINE_CDP_PORT, depsReady: depsReady(), running: false, accounts: null, adminUrl: null };
  try {
    const r = await engineFetch("/healthz", { timeout: 2500 });
    st.running = r.ok;
  } catch {}
  if (st.running) {
    st.adminUrl = `/muse/login`;
    try {
      const r = await engineFetch("/admin/accounts");
      if (r.ok) {
        const j = await r.json();
        st.accounts = {
          total: (j.accounts || []).length,
          list: (j.accounts || []).map((a) => ({ id: a.id, label: a.label, enabled: a.enabled !== false, essentialOk: a.essential_ok, expiresAt: a.expires_at || null })),
          stats: j.stats || null,
        };
      }
    } catch {}
  }
  return st;
}

export async function startEngine({ waitMs = 25000 } = {}) {
  if (process.env.MUSE_ENGINE === "off") return { started: false, reason: "disabled-by-env" };
  const st = await museStatus();
  if (st.running) return { started: false, reason: "already-running" };
  const py = pythonBin();
  if (!py) return { started: false, reason: "deps-missing" };
  if (starting) return starting;
  starting = (async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = fs.openSync(LOG_FILE, "a");
    child = spawn(py, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(ENGINE_PORT)], {
      cwd: ENGINE_DIR,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        MUSE2API_KEY: engineKey(),
        MUSE2API_HOST: "127.0.0.1",
        MUSE2API_PORT: String(ENGINE_PORT),
        MUSE2API_CDP_PORT: String(ENGINE_CDP_PORT),
        MUSE2API_HOME: ENGINE_DIR,
        PYTHONUNBUFFERED: "1",
      },
    });
    child.unref();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      try { const r = await engineFetch("/healthz", { timeout: 2000 }); if (r.ok) return { started: true }; } catch {}
    }
    return { started: false, reason: "health-timeout", log: LOG_FILE };
  })().finally(() => { starting = null; });
  return starting;
}

export function stopEngine() {
  // The child was spawned detached; kill by recorded process if still ours,
  // otherwise report that the engine keeps running (it is a separate process).
  if (child && !child.killed) { try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} } child = null; return { stopped: true }; }
  return { stopped: false, reason: "not-started-by-this-process" };
}

export function findPython() {
  for (const cand of ["python3", "python"]) {
    const r = spawnSync(cand, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return { bin: cand, version: (r.stdout || r.stderr).trim() };
  }
  return null;
}
