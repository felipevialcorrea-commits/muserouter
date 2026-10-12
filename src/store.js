import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PROVIDERS } from "./providers.js";

// tiny .env loader (no dependency): real environment variables win.
// Looks at ./.env first (dev from source), then ~/.muserouter/.env (global install).
import os from "node:os";
export const HOME_DATA_DIR = path.join(os.homedir(), ".muserouter");
try {
  for (const envPath of [path.join(process.cwd(), ".env"), path.join(HOME_DATA_DIR, ".env")]) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const [k, ...rest] = s.split("=");
      const key = k.trim();
      if (key && !(key in process.env)) process.env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {}

// Like 9Router, runtime data lives in the user's home dir (~/.muserouter),
// so a global `muserouter` command works from any folder. DATA_DIR overrides.
export const DATA_DIR = process.env.DATA_DIR || HOME_DATA_DIR;
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const LOG_FILE = path.join(DATA_DIR, "logs.jsonl");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function seedFromEnv() {
  const connections = [];
  for (const [key, def] of Object.entries(PROVIDERS)) {
    const apiKey = def.envKey ? (process.env[def.envKey] || "") : "";
    const base = def.envBase ? (process.env[def.envBase] || "") : "";
    if (key === "muse") {
      // Always seed a Muse connection so the Muse integration works out of the box
      // once the user pastes their muse2api key (dashboard or .env).
      connections.push({
        id: "conn_muse_default", name: "Muse (muse2api local)", provider: "muse",
        baseUrl: base || def.defaultBaseUrl, apiKey, enabled: true, priority: 1,
      });
      continue;
    }
    if (apiKey) {
      connections.push({
        id: `conn_${key}_env`, name: `${def.label} (từ .env)`, provider: key,
        baseUrl: def.defaultBaseUrl, apiKey, enabled: true, priority: 2,
      });
    }
  }
  return connections;
}

export function loadConfig() {
  ensureDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
  }
  const cfg = {
    apiKey: process.env.ROUTER_API_KEY || `mr_${crypto.randomBytes(18).toString("hex")}`,
    rtkEnabled: process.env.RTK_ENABLED !== "0",
    connections: seedFromEnv(),
    combos: [
      { name: "muse-first", models: ["muse/muse-spark", "deepseek/deepseek-chat", "gemini/gemini-2.5-flash"] },
      { name: "coding", models: ["muse/muse-spark", "openai/gpt-4o", "deepseek/deepseek-chat"] },
    ],
  };
  saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function logRequest(entry) {
  try {
    ensureDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
  try {
    const usage = loadUsage();
    usage.totalRequests++;
    usage.promptTokens += entry.promptTokens || 0;
    usage.completionTokens += entry.completionTokens || 0;
    usage.rtkSavedTokens += entry.rtkSavedTokens || 0;
    const k = entry.model || "unknown";
    usage.byModel[k] = (usage.byModel[k] || 0) + 1;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch {}
}

export function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); }
  catch { return { totalRequests: 0, promptTokens: 0, completionTokens: 0, rtkSavedTokens: 0, byModel: {} }; }
}

export function recentLogs(limit = 50) {
  try {
    const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function newId(prefix) { return `${prefix}_${crypto.randomBytes(6).toString("hex")}`; }
export function redact(cfg) {
  const clone = JSON.parse(JSON.stringify(cfg));
  clone.apiKeyHint = cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : "";
  delete clone.apiKey;
  for (const c of clone.connections || []) {
    c.hasKey = !!c.apiKey;
    c.keyHint = c.apiKey ? `…${c.apiKey.slice(-4)}` : "";
    delete c.apiKey;
  }
  return clone;
}
