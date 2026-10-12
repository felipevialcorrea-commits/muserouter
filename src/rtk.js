// RTK-style token saver (original, simplified):
// compresses long tool / tool_result contents BEFORE they are sent upstream.
// Safe by design: if compression fails or would make the text bigger, the
// original text is kept untouched.
const ANSI = /\x1b\[[0-9;]*m/g;

export function compressText(text) {
  if (typeof text !== "string" || text.length < 2000) return { text, saved: 0 };
  try {
    let out = text.replace(ANSI, "");
    const lines = out.split("\n");
    // 1) collapse 3+ blank lines to 1
    const collapsed = [];
    let blanks = 0;
    for (const l of lines) {
      if (l.trim() === "") { blanks++; if (blanks > 1) continue; }
      else blanks = 0;
      collapsed.push(l);
    }
    // 2) dedupe consecutive identical lines (log spam, repeated diff context)
    const deduped = [];
    let prev = null, repeat = 0;
    for (const l of collapsed) {
      if (l === prev) { repeat++; continue; }
      if (repeat > 0) deduped.push(`… (dòng trên lặp ×${repeat + 1})`);
      prev = l; repeat = 0; deduped.push(l);
    }
    if (repeat > 0) deduped.push(`… (dòng trên lặp ×${repeat + 1})`);
    out = deduped.join("\n");
    // 3) smart truncate: keep head 60% + tail 40% of an 8000-char budget
    if (out.length > 8000) {
      const head = out.slice(0, 4800), tail = out.slice(-3200);
      out = `${head}\n… [rtk: đã cắt ${out.length - 8000} ký tự ở giữa] …\n${tail}`;
    }
    if (out.length >= text.length) return { text, saved: 0 };
    return { text: out, saved: text.length - out.length };
  } catch {
    return { text, saved: 0 };
  }
}

// Walk OpenAI-format messages, compress tool outputs in place (on a copy).
export function applyRtk(body) {
  const clone = JSON.parse(JSON.stringify(body));
  let savedChars = 0;
  for (const msg of clone.messages || []) {
    if (msg.role === "tool" && typeof msg.content === "string") {
      const r = compressText(msg.content); msg.content = r.text; savedChars += r.saved;
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ((part.type === "tool_result" || part.type === "text") && typeof part.content === "string" && msg.role === "tool") {
          const r = compressText(part.content); part.content = r.text; savedChars += r.saved;
        }
        if (part.type === "tool_result" && Array.isArray(part.content)) {
          for (const sub of part.content) {
            if (sub.type === "text" && typeof sub.text === "string") {
              const r = compressText(sub.text); sub.text = r.text; savedChars += r.saved;
            }
          }
        }
      }
    }
  }
  return { body: clone, savedChars, savedTokensEst: Math.round(savedChars / 4) };
}
