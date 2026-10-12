// Provider registry — original code for MuseRouter.
// Prefix is what clients put before "/" in a model id, e.g. "muse/muse-spark".
// format: "openai" = upstream speaks OpenAI /chat/completions
//         "anthropic" = upstream speaks Anthropic /messages
export const PROVIDERS = {
  muse: {
    label: "Muse (qua muse2api)",
    prefix: "muse",
    format: "openai",
    // muse2api serves its API at the server root: {base}/v1/chat/completions
    defaultBaseUrl: "http://localhost:18610",
    baseHasV1: false,
    needsKey: true,
    tier: "subscription",
    capabilities: ["chat", "images", "videos"],
    models: [
      { id: "muse-spark", capabilities: ["chat"] },
      { id: "muse-image", capabilities: ["images"] },
      { id: "muse-video", capabilities: ["videos"] },
    ],
    envKey: "MUSE_API_KEY",
    envBase: "MUSE_BASE_URL",
    note: "Chạy muse2api riêng (port 18610), dán key của nó vào đây. Hỗ trợ chat + ảnh + video, xoay nhiều tài khoản ở phía muse2api.",
  },
  openai: {
    label: "OpenAI", prefix: "openai", format: "openai",
    defaultBaseUrl: "https://api.openai.com/v1", baseHasV1: true, needsKey: true, tier: "subscription",
    capabilities: ["chat", "images", "embeddings"],
    models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
    envKey: "OPENAI_API_KEY",
  },
  anthropic: {
    label: "Anthropic (Claude API)", prefix: "anthropic", format: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1", baseHasV1: true, needsKey: true, tier: "subscription",
    capabilities: ["chat"],
    models: [{ id: "claude-sonnet-4-5" }, { id: "claude-opus-4-1" }, { id: "claude-3-5-haiku-latest" }],
    envKey: "ANTHROPIC_API_KEY",
  },
  openrouter: {
    label: "OpenRouter", prefix: "openrouter", format: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "openai/gpt-4o-mini" }, { id: "anthropic/claude-sonnet-4.5" }, { id: "deepseek/deepseek-chat" }],
    envKey: "OPENROUTER_API_KEY",
  },
  deepseek: {
    label: "DeepSeek", prefix: "deepseek", format: "openai",
    defaultBaseUrl: "https://api.deepseek.com/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
    envKey: "DEEPSEEK_API_KEY",
  },
  glm: {
    label: "GLM (Zhipu)", prefix: "glm", format: "openai",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", baseHasV1: false, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "glm-4.7" }, { id: "glm-4.5" }],
    envKey: "GLM_API_KEY",
  },
  kimi: {
    label: "Kimi (Moonshot)", prefix: "kimi", format: "openai",
    defaultBaseUrl: "https://api.moonshot.ai/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "kimi-k2-0711-preview" }, { id: "moonshot-v1-32k" }],
    envKey: "KIMI_API_KEY",
  },
  minimax: {
    label: "MiniMax", prefix: "minimax", format: "openai",
    defaultBaseUrl: "https://api.minimax.io/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "MiniMax-M2" }],
    envKey: "MINIMAX_API_KEY",
  },
  gemini: {
    label: "Google Gemini (OpenAI-compat)", prefix: "gemini", format: "openai",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", baseHasV1: false, needsKey: true, tier: "free",
    capabilities: ["chat"],
    models: [{ id: "gemini-2.5-pro" }, { id: "gemini-2.5-flash" }],
    envKey: "GEMINI_API_KEY",
  },
  groq: {
    label: "Groq", prefix: "groq", format: "openai",
    defaultBaseUrl: "https://api.groq.com/openai/v1", baseHasV1: true, needsKey: true, tier: "free",
    capabilities: ["chat"],
    models: [{ id: "llama-3.3-70b-versatile" }],
    envKey: "GROQ_API_KEY",
  },
  mistral: {
    label: "Mistral", prefix: "mistral", format: "openai",
    defaultBaseUrl: "https://api.mistral.ai/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "mistral-large-latest" }, { id: "codestral-latest" }],
    envKey: "MISTRAL_API_KEY",
  },
  xai: {
    label: "xAI (Grok)", prefix: "xai", format: "openai",
    defaultBaseUrl: "https://api.x.ai/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "grok-4" }, { id: "grok-code-fast-1" }],
    envKey: "XAI_API_KEY",
  },
  together: {
    label: "Together AI", prefix: "together", format: "openai",
    defaultBaseUrl: "https://api.together.xyz/v1", baseHasV1: true, needsKey: true, tier: "cheap",
    capabilities: ["chat"],
    models: [{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo" }],
    envKey: "TOGETHER_API_KEY",
  },
  ollama: {
    label: "Ollama (local)", prefix: "ollama", format: "openai",
    defaultBaseUrl: "http://localhost:11434/v1", baseHasV1: true, needsKey: false, tier: "free",
    capabilities: ["chat", "embeddings"],
    models: [{ id: "llama3.1" }, { id: "qwen2.5-coder" }],
    envKey: null,
  },
  "custom-openai": {
    label: "Custom OpenAI-compatible", prefix: "custom", format: "openai",
    defaultBaseUrl: "", baseHasV1: true, needsKey: false, tier: "cheap",
    capabilities: ["chat"], models: [], envKey: null,
    note: "Bất kỳ endpoint nào nói chuẩn OpenAI: tự điền Base URL + model khi tạo kết nối.",
  },
  "custom-anthropic": {
    label: "Custom Anthropic-compatible", prefix: "customa", format: "anthropic",
    defaultBaseUrl: "", baseHasV1: true, needsKey: false, tier: "cheap",
    capabilities: ["chat"], models: [], envKey: null,
  },
};

export function providerByPrefix(prefix) {
  return Object.values(PROVIDERS).find((p) => p.prefix === prefix) || null;
}
export function joinUrl(base, path) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}
// Endpoint for a capability, given a connection.
// openai-format: {base}/chat/completions when baseHasV1, else {base}/v1/chat/completions
export function endpointFor(conn, capability) {
  const def = PROVIDERS[conn.provider];
  const base = (conn.baseUrl || def?.defaultBaseUrl || "").replace(/\/+$/, "");
  const v1 = def?.baseHasV1 ? "" : "/v1";
  if (!def) return base;
  if (def.format === "anthropic") {
    if (capability === "chat") return `${base}/messages`;
    return base;
  }
  switch (capability) {
    case "chat": return `${base}${v1}/chat/completions`;
    case "images": return `${base}${v1}/images/generations`;
    case "videos": return `${base}${v1}/videos`;
    case "embeddings": return `${base}${v1}/embeddings`;
    case "models": return `${base}${v1}/models`;
    case "health": return def.prefix === "muse" ? `${base}/healthz` : `${base}${v1}/models`;
    default: return base;
  }
}
