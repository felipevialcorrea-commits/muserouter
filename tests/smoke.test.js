// Smoke tests with a local mock upstream — no real API keys, no network.
// Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muserouter-test-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.PORT = "21199";
process.env.ROUTER_API_KEY = "mr_testkey";

// --- mock "muse2api" upstream: fails chat for model muse-spark, ok for others ---
let mock;
let mockPort;
let router;
before(async () => {
  mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url.endsWith("/healthz")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true })); }
      if (req.url.endsWith("/v1/chat/completions")) {
        const b = JSON.parse(raw || "{}");
        if (b.model === "fail-me") { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "rate limited" } })); }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: b.model, choices: [{ index: 0, message: { role: "assistant", content: "mock-ok:" + b.model }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
      }
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  mockPort = mock.address().port;
  // seed config pointing at the mock as a Muse connection + a combo that must fall back
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.DATA_DIR, "config.json"), JSON.stringify({
    apiKey: "mr_testkey", rtkEnabled: true,
    connections: [
      { id: "c1", name: "Mock Muse A", provider: "muse", baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: "k1", enabled: true, priority: 1 },
      { id: "c2", name: "Mock Muse B", provider: "muse", baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: "k2", enabled: true, priority: 2 },
    ],
    combos: [{ name: "fallback-demo", models: ["muse/fail-me", "muse/muse-spark"] }],
  }));
  const { createServer } = await import("../src/server.js");
  router = createServer();
  await new Promise((r) => router.listen(21199, "127.0.0.1", r));
});
after(() => { router?.closeAllConnections?.(); router?.close(); mock?.closeAllConnections?.(); mock?.close(); });

const H = { authorization: "Bearer mr_testkey", "content-type": "application/json" };
const BASE = "http://127.0.0.1:21199";

test("healthz does not need auth and reports the new port", async () => {
  const r = await fetch(`${BASE}/healthz`);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.port, 21199);
});

test("/v1 requires the router key", async () => {
  const r = await fetch(`${BASE}/v1/models`);
  assert.equal(r.status, 401);
});

test("/v1/models lists muse models + combos", async () => {
  const r = await fetch(`${BASE}/v1/models`, { headers: H });
  const j = await r.json();
  const ids = j.data.map((m) => m.id);
  assert.ok(ids.includes("muse/muse-spark"));
  assert.ok(ids.includes("fallback-demo"));
});

test("chat routes to the Muse connection", async () => {
  const r = await fetch(`${BASE}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "muse/muse-spark", messages: [{ role: "user", content: "hi" }] }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.choices[0].message.content, "mock-ok:muse-spark");
});

test("combo falls back when the first model is rate-limited", async () => {
  const r = await fetch(`${BASE}/v1/chat/completions`, { method: "POST", headers: H, body: JSON.stringify({ model: "fallback-demo", messages: [{ role: "user", content: "hi" }] }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.choices[0].message.content, "mock-ok:muse-spark");
});

test("Anthropic inbound /v1/messages is translated", async () => {
  const r = await fetch(`${BASE}/v1/messages`, { method: "POST", headers: H, body: JSON.stringify({ model: "muse/muse-spark", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.type, "message");
  assert.equal(j.content[0].text, "mock-ok:muse-spark");
});

test("built-in Muse engine status + login shortcut", async () => {
  const r = await fetch(`${BASE}/api/muse/status`, { headers: H });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.port, 18611); // embedded engine port, not standalone muse2api 18610
  assert.equal(typeof j.depsReady, "boolean");
  const noKey = await fetch(`${BASE}/muse/login`, { redirect: "manual" });
  assert.equal(noKey.status, 401);
  const withKey = await fetch(`${BASE}/muse/login?key=mr_testkey`, { redirect: "manual" });
  assert.equal(withKey.status, 302);
  assert.ok((withKey.headers.get("location") || "").includes(":18611/admin"));
});

test("dashboard html is served", async () => {
  const r = await fetch(`${BASE}/dashboard`);
  const t = await r.text();
  assert.ok(t.includes("MuseRouter"));
});
