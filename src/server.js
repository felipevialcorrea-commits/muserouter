import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS, providerByPrefix, endpointFor } from "./providers.js";
import { applyRtk } from "./rtk.js";
import { openaiToAnthropic, anthropicToOpenaiResponse, anthropicToOpenaiRequest, openaiToAnthropicResponse } from "./translate.js";
import { loadConfig, saveConfig, logRequest, loadUsage, recentLogs, newId, redact } from "./store.js";
import { museStatus, startEngine, stopEngine, startSetup, setupStatus, findPython, depsReady, engineBaseUrl, engineKey, engineAdminUrl, ENGINE_PORT } from "./museEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NEW port on purpose: 9Router uses 20128 (dev 20127), muse2api uses 18610 / CDP 19210.
// MuseRouter defaults to 21128 so all three can run side by side on one machine.
export const PORT = Number(process.env.PORT || 21128);
export const HOST = process.env.HOST || "0.0.0.0";

let config = loadConfig();
const cooldownUntil = new Map(); // connId -> timestamp (after 429/5xx)
const rrCursor = new Map();      // provider -> round-robin cursor

// ---------- helpers ----------
function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}
function openaiError(res, status, message) {
  sendJson(res, status, { error: { message, type: "muserouter_error", code: status } });
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}
function authed(req) {
  const h = req.headers.authorization || "";
  const key = h.startsWith("Bearer ") ? h.slice(7) : (req.headers["x-api-key"] || "");
  return key && key === config.apiKey;
}
function pickConnections(providerKey) {
  const now = Date.now();
  const all = (config.connections || [])
    .filter((c) => c.provider === providerKey && c.enabled !== false)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  const ready = all.filter((c) => (cooldownUntil.get(c.id) || 0) <= now);
  const list = ready.length ? ready : all; // cooldown is a preference, never a hard dead-end
  if (list.length > 1) { // round-robin within the same priority group
    const cur = rrCursor.get(providerKey) || 0;
    rrCursor.set(providerKey, cur + 1);
    const head = list.filter((c) => (c.priority || 99) === (list[0].priority || 99));
    if (head.length > 1) {
      const first = head[cur % head.length];
      return [first, ...list.filter((c) => c.id !== first.id)];
    }
  }
  return list;
}

// Resolve a requested model id into an ordered list of attempts.
// - "combo-name"            -> the combo's member models, in order (fallback chain)
// - "prefix/upstream-model" -> that provider (all of its connections, round-robin)
// - "bare-model"            -> every enabled connection that lists/serves it, then any openai-format provider
export function resolveAttempts(modelId) {
  const combo = (config.combos || []).find((c) => c.name === modelId);
  if (combo) {
    const attempts = [];
    for (const m of combo.models) attempts.push(...resolveAttempts(m));
    return attempts;
  }
  const attempts = [];
  const slash = (modelId || "").indexOf("/");
  if (slash > 0) {
    const prefix = modelId.slice(0, slash);
    const upstream = modelId.slice(slash + 1);
    // openrouter-style nested ids: openrouter/openai/gpt-4o -> upstream keeps its slash
    const def = providerByPrefix(prefix);
    const providerKey = def ? Object.keys(PROVIDERS).find((k) => PROVIDERS[k].prefix === prefix) : null;
    if (providerKey) {
      for (const conn of pickConnections(providerKey)) attempts.push({ conn, def, upstreamModel: upstream, requestedModel: modelId });
      return attempts;
    }
  }
  // bare model: prefer a provider whose static catalog contains it
  for (const [key, def] of Object.entries(PROVIDERS)) {
    if ((def.models || []).some((m) => m.id === modelId)) {
      for (const conn of pickConnections(key)) attempts.push({ conn, def, upstreamModel: modelId, requestedModel: modelId });
    }
  }
  if (!attempts.length) { // last resort: first enabled openai-format connection
    for (const [key, def] of Object.entries(PROVIDERS)) {
      if (def.format !== "openai") continue;
      for (const conn of pickConnections(key)) { attempts.push({ conn, def, upstreamModel: modelId, requestedModel: modelId }); break; }
      if (attempts.length) break;
    }
  }
  return attempts;
}

// Keep a first-class connection pointing at the built-in Muse engine.
// Priority 0 = tried before any external muse2api connection the user added.
export function ensureBuiltinMuseConnection() {
  if (process.env.MUSE_ENGINE === "off") return;
  const id = "conn_muse_builtin";
  const existing = (config.connections || []).find((c) => c.id === id);
  const want = { id, name: "Muse tích hợp (built-in)", provider: "muse", baseUrl: engineBaseUrl(), apiKey: engineKey(), enabled: true, priority: 0 };
  if (existing) Object.assign(existing, want);
  else config.connections.unshift(want);
  saveConfig(config);
}

// ---------- upstream chat ----------
async function callUpstream(attempt, body, { stream }) {
  const { conn, def, upstreamModel } = attempt;
  const isAnthropic = def.format === "anthropic";
  const url = endpointFor(conn, "chat");
  const payload = isAnthropic ? openaiToAnthropic({ ...body, stream }, upstreamModel) : { ...body, model: upstreamModel, stream };
  const headers = { "content-type": "application/json" };
  if (isAnthropic) {
    if (conn.apiKey) headers["x-api-key"] = conn.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (conn.apiKey) {
    headers.authorization = `Bearer ${conn.apiKey}`;
  }
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  return { resp, isAnthropic };
}

async function handleChat(req, res, rawBody, { anthropicInbound = false } = {}) {
  let body = rawBody;
  if (anthropicInbound) body = anthropicToOpenaiRequest(rawBody);
  if (!body || !Array.isArray(body.messages)) return openaiError(res, 400, "Thiếu 'messages' (array).");
  const requestedModel = body.model || "muse/muse-spark";
  body.model = requestedModel;

  // RTK token saver (skip with header X-MuseRouter-Token-Saver: off, or X-9Router-Token-Saver: off)
  let rtkSavedTokens = 0;
  const saverOff = (req.headers["x-muserouter-token-saver"] || req.headers["x-9router-token-saver"]) === "off";
  if (config.rtkEnabled && !saverOff) {
    const r = applyRtk(body); body = r.body; rtkSavedTokens = r.savedTokensEst;
  }

  const stream = !!body.stream && !anthropicInbound;
  const attempts = resolveAttempts(requestedModel);
  if (!attempts.length) {
    return openaiError(res, 503, `Chưa có kết nối nào bật cho model "${requestedModel}". Mở dashboard http://localhost:${PORT} để thêm kết nối (Muse / OpenAI / …) hoặc kiểm tra combo.`);
  }

  const errors = [];
  for (const attempt of attempts) {
    const started = Date.now();
    try {
      const { resp, isAnthropic } = await callUpstream(attempt, body, { stream });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        errors.push(`${attempt.def.prefix}: HTTP ${resp.status} ${txt.slice(0, 200)}`);
        if (resp.status === 429 || resp.status >= 500) cooldownUntil.set(attempt.conn.id, Date.now() + 60_000);
        continue; // fallback to next attempt
      }
      if (stream && !isAnthropic) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const reader = resp.body.getReader();
        let promptTokens = 0, completionTokens = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
        logRequest({ kind: "chat", model: requestedModel, upstream: `${attempt.def.prefix}/${attempt.upstreamModel}`, conn: attempt.conn.name, ms: Date.now() - started, stream: true, promptTokens, completionTokens, rtkSavedTokens, status: 200 });
        return;
      }
      const data = await resp.json();
      const out = isAnthropic ? anthropicToOpenaiResponse(data, requestedModel) : { ...data, model: requestedModel };
      logRequest({ kind: "chat", model: requestedModel, upstream: `${attempt.def.prefix}/${attempt.upstreamModel}`, conn: attempt.conn.name, ms: Date.now() - started, stream: false, promptTokens: out.usage?.prompt_tokens || 0, completionTokens: out.usage?.completion_tokens || 0, rtkSavedTokens, status: 200 });
      if (anthropicInbound) return sendJson(res, 200, openaiToAnthropicResponse(out, requestedModel));
      return sendJson(res, 200, out);
    } catch (e) {
      errors.push(`${attempt.def.prefix}: ${e.message}`);
      cooldownUntil.set(attempt.conn.id, Date.now() + 30_000);
    }
  }
  return openaiError(res, 502, `Tất cả provider đều lỗi cho model "${requestedModel}": ${errors.join(" | ")}`);
}

// Generic passthrough for images / videos / embeddings to the first matching provider.
async function handlePassthrough(req, res, capability, body, taskId) {
  const modelId = body?.model || (capability === "videos" ? "muse/muse-video" : capability === "images" ? "muse/muse-image" : "");
  const attempts = resolveAttempts(modelId).filter((a) => (a.def.capabilities || []).includes(capability));
  const fallbackAttempts = attempts.length ? attempts : resolveAttempts(modelId);
  for (const attempt of fallbackAttempts) {
    try {
      let url = endpointFor(attempt.conn, capability);
      if (taskId) url = `${url}/${taskId}`;
      const headers = { "content-type": "application/json" };
      if (attempt.conn.apiKey) headers.authorization = `Bearer ${attempt.conn.apiKey}`;
      const resp = await fetch(url, taskId ? { headers } : { method: "POST", headers, body: JSON.stringify({ ...body, model: attempt.upstreamModel }) });
      const text = await resp.text();
      if (!resp.ok) continue;
      logRequest({ kind: capability, model: modelId, upstream: `${attempt.def.prefix}/${attempt.upstreamModel}`, conn: attempt.conn.name, status: resp.status });
      res.writeHead(resp.status, { "content-type": resp.headers.get("content-type") || "application/json" });
      return res.end(text);
    } catch {}
  }
  return openaiError(res, 502, `Không provider nào xử lý được ${capability} cho model "${modelId}". Ảnh/video cần kết nối Muse (muse2api) hoặc OpenAI.`);
}

async function listModels(res) {
  const data = [];
  const seen = new Set();
  for (const c of config.connections || []) {
    if (c.enabled === false) continue;
    const def = PROVIDERS[c.provider]; if (!def) continue;
    for (const m of def.models || []) {
      const id = `${def.prefix}/${m.id}`;
      if (!seen.has(id)) { seen.add(id); data.push({ id, object: "model", owned_by: def.prefix }); }
    }
    for (const m of c.models || []) {
      const id = m.includes("/") ? m : `${def.prefix}/${m}`;
      if (!seen.has(id)) { seen.add(id); data.push({ id, object: "model", owned_by: def.prefix }); }
    }
  }
  for (const combo of config.combos || []) {
    if (!seen.has(combo.name)) { seen.add(combo.name); data.push({ id: combo.name, object: "model", owned_by: "combo" }); }
  }
  sendJson(res, 200, { object: "list", data });
}

// ---------- server ----------
export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const p = url.pathname.replace(/\/+$/, "") || "/";

    if (p === "/healthz") return sendJson(res, 200, { ok: true, name: "muserouter", port: PORT, connections: (config.connections || []).filter((c) => c.enabled !== false).length });

    // Dashboard (static page; data comes from /api/* which requires the key)
    if (p === "/" || p === "/dashboard") {
      const html = fs.readFileSync(path.join(__dirname, "dashboard.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // Muse login shortcut: /muse/login?key=<router-key> -> engine admin (auth) page
    if (p === "/muse/login") {
      if (!authed(req) && url.searchParams.get("key") !== config.apiKey) return openaiError(res, 401, "Cần key của router: /muse/login?key=<ROUTER_API_KEY>");
      res.writeHead(302, { location: engineAdminUrl(req.headers.host) });
      return res.end();
    }

    // ----- admin API (dashboard) -----
    if (p.startsWith("/api/")) {
      if (!authed(req)) return openaiError(res, 401, "Sai hoặc thiếu API key.");
      if (p === "/api/muse/status" && req.method === "GET") return sendJson(res, 200, { ...(await museStatus()), setup: setupStatus(), python: findPython(), loginUrl: "/muse/login" });
      if (p === "/api/muse/setup" && req.method === "POST") return sendJson(res, 200, startSetup());
      if (p === "/api/muse/start" && req.method === "POST") {
        const r = await startEngine();
        if (r.started || r.reason === "already-running") ensureBuiltinMuseConnection();
        return sendJson(res, 200, { ...r, status: await museStatus() });
      }
      if (p === "/api/muse/stop" && req.method === "POST") return sendJson(res, 200, stopEngine());
      if (p === "/api/config" && req.method === "GET") return sendJson(res, 200, redact(config));
      if (p === "/api/providers" && req.method === "GET") return sendJson(res, 200, PROVIDERS);
      if (p === "/api/stats" && req.method === "GET") return sendJson(res, 200, { usage: loadUsage(), logs: recentLogs(50), port: PORT });
      if (p === "/api/connections" && req.method === "POST") {
        const b = await readBody(req);
        const def = PROVIDERS[b.provider];
        if (!def) return openaiError(res, 400, "Provider không hợp lệ.");
        const conn = { id: newId("conn"), name: b.name || def.label, provider: b.provider, baseUrl: b.baseUrl || def.defaultBaseUrl, apiKey: b.apiKey || "", enabled: true, priority: Number(b.priority) || 1, models: Array.isArray(b.models) ? b.models : [] };
        config.connections.push(conn); saveConfig(config);
        return sendJson(res, 201, redact({ ...config, connections: [conn] }).connections[0]);
      }
      const del = p.match(/^\/api\/connections\/([\w-]+)$/);
      if (del && req.method === "DELETE") {
        config.connections = config.connections.filter((c) => c.id !== del[1]); saveConfig(config);
        return sendJson(res, 200, { deleted: true });
      }
      const test = p.match(/^\/api\/connections\/([\w-]+)\/test$/);
      if (test && req.method === "POST") {
        const conn = config.connections.find((c) => c.id === test[1]);
        if (!conn) return openaiError(res, 404, "Không thấy kết nối.");
        try {
          const headers = {};
          if (conn.apiKey) headers.authorization = `Bearer ${conn.apiKey}`;
          const r = await fetch(endpointFor(conn, "health"), { headers, signal: AbortSignal.timeout(10000) });
          return sendJson(res, 200, { ok: r.ok, status: r.status, url: endpointFor(conn, "health") });
        } catch (e) { return sendJson(res, 200, { ok: false, error: e.message, url: endpointFor(conn, "health") }); }
      }
      if (p === "/api/combos" && req.method === "POST") {
        const b = await readBody(req);
        if (!b.name || !Array.isArray(b.models) || !b.models.length) return openaiError(res, 400, "Combo cần name + models[].");
        config.combos = (config.combos || []).filter((c) => c.name !== b.name);
        config.combos.push({ name: b.name, models: b.models }); saveConfig(config);
        return sendJson(res, 201, { name: b.name, models: b.models });
      }
      const delCombo = p.match(/^\/api\/combos\/([\w-]+)$/);
      if (delCombo && req.method === "DELETE") {
        config.combos = (config.combos || []).filter((c) => c.name !== delCombo[1]); saveConfig(config);
        return sendJson(res, 200, { deleted: true });
      }
      if (p === "/api/settings" && req.method === "POST") {
        const b = await readBody(req);
        if (typeof b.rtkEnabled === "boolean") config.rtkEnabled = b.rtkEnabled;
        saveConfig(config); return sendJson(res, 200, redact(config));
      }
      return openaiError(res, 404, "API route không tồn tại.");
    }

    // ----- OpenAI / Anthropic compatible API -----
    if (p.startsWith("/v1/")) {
      if (!authed(req)) return openaiError(res, 401, "Sai hoặc thiếu API key (Authorization: Bearer <ROUTER_API_KEY>).");
      if (p === "/v1/models" && req.method === "GET") return listModels(res);
      if (p === "/v1/chat/completions" && req.method === "POST") {
        const b = await readBody(req); if (b === null) return openaiError(res, 400, "JSON không hợp lệ.");
        return handleChat(req, res, b);
      }
      if (p === "/v1/messages" && req.method === "POST") { // Anthropic inbound (Claude Code)
        const b = await readBody(req); if (b === null) return openaiError(res, 400, "JSON không hợp lệ.");
        return handleChat(req, res, b, { anthropicInbound: true });
      }
      if (p === "/v1/images/generations" && req.method === "POST") return handlePassthrough(req, res, "images", await readBody(req));
      if (p === "/v1/videos" && req.method === "POST") return handlePassthrough(req, res, "videos", await readBody(req));
      const vid = p.match(/^\/v1\/videos\/([\w-]+)$/);
      if (vid && req.method === "GET") return handlePassthrough(req, res, "videos", { model: "muse/muse-video" }, vid[1]);
      if (p === "/v1/embeddings" && req.method === "POST") return handlePassthrough(req, res, "embeddings", await readBody(req));
      return openaiError(res, 404, "Route không tồn tại.");
    }

    return openaiError(res, 404, "Không tìm thấy.");
  });
}

export function reloadConfig() { config = loadConfig(); return config; }

export function startServer() {
  const server = createServer();
  server.listen(PORT, HOST, async () => {
    console.log(`MuseRouter đang chạy: http://localhost:${PORT}  (dashboard: http://localhost:${PORT}/dashboard)`);
    console.log(`API key: ${config.apiKey.slice(0, 7)}…${config.apiKey.slice(-4)}  (xem đầy đủ trong ~/.muserouter/config.json)`);
    console.log(`Port này khác 9Router (20128) và muse2api (18610) nên chạy song song được.`);
    // Built-in Muse engine: start it like 9Router starts its providers —
    // the user only opens the dashboard and clicks "Đăng nhập Muse".
    if (process.env.MUSE_ENGINE !== "off") {
      if (depsReady()) {
        const r = await startEngine();
        if (r.started || r.reason === "already-running") {
          ensureBuiltinMuseConnection();
          console.log(`Engine Muse tích hợp: http://localhost:${ENGINE_PORT} (đăng nhập qua dashboard, mục Kết nối Muse)`);
        } else console.log(`Engine Muse chưa chạy (${r.reason}). Xem log: ~/.muserouter/muse-engine.log`);
      } else {
        console.log(`Engine Muse tích hợp chưa cài: chạy "muserouter setup" 1 lần (hoặc bấm nút Cài engine trong dashboard).`);
      }
    }
  });
  return server;
}

// Cross-platform main check. NOTE: the naive `import.meta.url === "file://" + argv[1]`
// comparison NEVER matches on Windows (backslashes + drive letter), which made
// `npm start` exit silently there — fixed by comparing resolved file paths.
const isMain = (() => {
  try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (isMain) startServer();
