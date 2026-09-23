// Translates OpenAI Chat Completions request bodies (as sent by some Cursor
// builds on `/v1/chat/completions`) into Responses-API shapes the upstream
// Codex backend accepts.

export function chatCompletionsToResponses(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const messages = raw["messages"];
  if (!Array.isArray(messages)) {
    throw new Error("chat completions body missing messages array");
  }

  const out: Record<string, unknown> = {};

  const copyKeys = [
    "model",
    "stream",
    "tool_choice",
    "parallel_tool_calls",
    "reasoning",
    "text",
    "include",
    "service_tier",
    "store",
    "instructions",
  ] as const;
  for (const key of copyKeys) {
    if (key in raw) out[key] = raw[key];
  }

  if (typeof raw["user"] === "string" && raw["user"].length > 0) {
    out["prompt_cache_key"] = raw["user"];
  }

  if (Array.isArray(raw["tools"])) {
    out["tools"] = (raw["tools"] as unknown[]).map(convertChatTool);
  }

  out["input"] = convertMessagesToInput(messages as unknown[]);
  return out;
}

export function isResponsesShapedBody(parsed: Record<string, unknown>): boolean {
  return Array.isArray(parsed["input"]);
}

export function isChatCompletionsShapedBody(parsed: Record<string, unknown>): boolean {
  return Array.isArray(parsed["messages"]);
}

function convertChatTool(tool: unknown): Record<string, unknown> {
  if (!tool || typeof tool !== "object") return {};
  const t = tool as Record<string, unknown>;
  if (t["type"] === "function" && t["function"] && typeof t["function"] === "object") {
    const fn = t["function"] as Record<string, unknown>;
    const flat: Record<string, unknown> = {
      type: "function",
      name: fn["name"],
    };
    if (fn["description"] !== undefined) flat["description"] = fn["description"];
    if (fn["parameters"] !== undefined) flat["parameters"] = fn["parameters"];
    if (fn["strict"] !== undefined) flat["strict"] = fn["strict"];
    return flat;
  }
  return { ...t };
}

function convertMessagesToInput(messages: unknown[]): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const role = m["role"];

    if (role === "tool") {
      const callId = typeof m["tool_call_id"] === "string" ? m["tool_call_id"] : "";
      const output = stringifyMessageContent(m["content"]);
      input.push({
        type: "function_call_output",
        call_id: callId,
        output,
      });
      continue;
    }

    if (role === "assistant") {
      const toolCalls = m["tool_calls"];
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const item = convertAssistantToolCall(tc);
          if (item) input.push(item);
        }
      }
      const text = stringifyMessageContent(m["content"]);
      if (text.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      continue;
    }

    if (role === "system" || role === "developer" || role === "user") {
      const text = stringifyMessageContent(m["content"]);
      const contentParts = messageContentToInputParts(m["content"], role as string);
      if (contentParts.length === 0 && text.length === 0) {
        input.push({
          type: "message",
          role,
          content: [{ type: "input_text", text: "" }],
        });
      } else if (contentParts.length > 0) {
        input.push({
          type: "message",
          role,
          content: contentParts,
        });
      } else {
        input.push({
          type: "message",
          role,
          content: [{ type: "input_text", text }],
        });
      }
      continue;
    }

    // Unknown role: forward as a generic message when possible.
    const fallbackText = stringifyMessageContent(m["content"]);
    if (fallbackText.length > 0) {
      input.push({
        type: "message",
        role: typeof role === "string" ? role : "user",
        content: [{ type: "input_text", text: fallbackText }],
      });
    }
  }
  return input;
}

/** Codex Responses `function_call` items require `id` to start with `fc`. */
export function responsesFunctionCallItemId(callId: string): string {
  if (callId.startsWith("fc")) return callId;
  const suffix = callId.startsWith("call_") ? callId.slice("call_".length) : callId;
  return `fc_${suffix}`;
}

function convertAssistantToolCall(tc: unknown): Record<string, unknown> | null {
  if (!tc || typeof tc !== "object") return null;
  const t = tc as Record<string, unknown>;
  const fn = t["function"] as Record<string, unknown> | undefined;
  const name = typeof fn?.["name"] === "string" ? fn["name"] : "";
  const args = typeof fn?.["arguments"] === "string" ? fn["arguments"] : "";
  const callId =
    typeof t["id"] === "string" ? t["id"] : `call_${crypto.randomUUID().replace(/-/g, "")}`;
  return {
    type: "function_call",
    id: responsesFunctionCallItemId(callId),
    call_id: callId,
    name,
    arguments: args,
    status: "completed",
  };
}

function messageContentToInputParts(
  content: unknown,
  role: string,
): Record<string, unknown>[] {
  if (typeof content === "string") {
    if (!content) return [];
    const partType = role === "assistant" ? "output_text" : "input_text";
    return [{ type: partType, text: content }];
  }
  if (!Array.isArray(content)) return [];
  const parts: Record<string, unknown>[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const ptype = p["type"];
    if (ptype === "text" && typeof p["text"] === "string") {
      parts.push({ type: "input_text", text: p["text"] });
    } else if (ptype === "input_text" || ptype === "output_text") {
      parts.push({ ...p });
    } else if (ptype === "image_url" && p["image_url"]) {
      // Responses uses input_image; best-effort mapping for multimodal turns.
      const url = (p["image_url"] as Record<string, unknown>)?.["url"];
      if (typeof url === "string") {
        parts.push({ type: "input_image", image_url: url, detail: "auto" });
      }
    }
  }
  return parts;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (typeof p["text"] === "string") parts.push(p["text"] as string);
  }
  return parts.join("");
}
