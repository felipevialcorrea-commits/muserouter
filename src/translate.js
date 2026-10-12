// Minimal OpenAI <-> Anthropic format translation (chat only).
// Text + tool_use/tool_result basics; anything exotic is passed as text.

export function openaiToAnthropic(body, upstreamModel) {
  const systemParts = [];
  const messages = [];
  for (const m of body.messages || []) {
    if (m.role === "system") { systemParts.push(textOf(m.content)); continue; }
    if (m.role === "tool") {
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id || "tool", content: textOf(m.content) }] });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const content = [];
      if (m.content) content.push({ type: "text", text: textOf(m.content) });
      for (const tc of m.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || "{}"); } catch {}
        content.push({ type: "tool_use", id: tc.id || "call", name: tc.function?.name || "tool", input });
      }
      messages.push({ role: "assistant", content });
      continue;
    }
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: textOf(m.content) });
  }
  const out = {
    model: upstreamModel,
    messages,
    max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
    stream: !!body.stream,
  };
  if (systemParts.length) out.system = systemParts.join("\n\n");
  if (body.temperature != null) out.temperature = body.temperature;
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((t) => ({
      name: t.function?.name || t.name,
      description: t.function?.description || t.description || "",
      input_schema: t.function?.parameters || t.input_schema || { type: "object", properties: {} },
    }));
  }
  return out;
}

export function anthropicToOpenaiResponse(a, requestedModel) {
  let text = "";
  const toolCalls = [];
  for (const block of a.content || []) {
    if (block.type === "text") text += block.text || "";
    if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
    }
  }
  const msg = { role: "assistant", content: text || null };
  if (toolCalls.length) msg.tool_calls = toolCalls;
  return {
    id: a.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [{ index: 0, message: msg, finish_reason: toolCalls.length ? "tool_calls" : mapStop(a.stop_reason) }],
    usage: {
      prompt_tokens: a.usage?.input_tokens || 0,
      completion_tokens: a.usage?.output_tokens || 0,
      total_tokens: (a.usage?.input_tokens || 0) + (a.usage?.output_tokens || 0),
    },
  };
}

// Inbound Anthropic request (POST /v1/messages) -> OpenAI body
export function anthropicToOpenaiRequest(body) {
  const messages = [];
  if (body.system) messages.push({ role: "system", content: typeof body.system === "string" ? body.system : body.system.map((s) => s.text || "").join("\n") });
  for (const m of body.messages || []) {
    if (typeof m.content === "string") { messages.push({ role: m.role, content: m.content }); continue; }
    let text = "";
    for (const block of m.content || []) {
      if (block.type === "text") text += block.text || "";
      else if (block.type === "tool_result") messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: typeof block.content === "string" ? block.content : (block.content || []).map((c) => c.text || "").join("") });
      else if (block.type === "tool_use") {
        messages.push({ role: "assistant", content: null, tool_calls: [{ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } }] });
      }
    }
    if (text) messages.push({ role: m.role, content: text });
  }
  const out = { model: body.model, messages, stream: false };
  if (body.max_tokens) out.max_tokens = body.max_tokens;
  if (body.temperature != null) out.temperature = body.temperature;
  if (Array.isArray(body.tools)) {
    out.tools = body.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object", properties: {} } } }));
  }
  return out;
}

export function openaiToAnthropicResponse(o, requestedModel) {
  const choice = o.choices?.[0] || {};
  const content = [];
  if (choice.message?.content) content.push({ type: "text", text: choice.message.content });
  for (const tc of choice.message?.tool_calls || []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || "{}"); } catch {}
    content.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
  }
  return {
    id: o.id || `msg_${Date.now()}`,
    type: "message", role: "assistant", model: requestedModel,
    content: content.length ? content : [{ type: "text", text: "" }],
    stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: o.usage?.prompt_tokens || 0, output_tokens: o.usage?.completion_tokens || 0 },
  };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p.text || p.content || "").join("");
  return content == null ? "" : String(content);
}
function mapStop(s) { return s === "max_tokens" ? "length" : "stop"; }
