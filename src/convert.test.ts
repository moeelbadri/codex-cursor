import { describe, expect, test } from "bun:test";
import { chatCompletionsToResponses } from "./convert.ts";

describe("chatCompletionsToResponses", () => {
  test("maps user messages to Responses input", () => {
    const out = chatCompletionsToResponses({
      model: "gpt-5.4",
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(out["model"]).toBe("gpt-5.4");
    expect(out["stream"]).toBe(true);
    expect(out["input"]).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ]);
  });

  test("flattens Chat Completions tools and maps user id to prompt_cache_key", () => {
    const out = chatCompletionsToResponses({
      model: "gpt-5.4",
      user: "cursor-stable-user-abc",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      stream_options: { include_usage: true },
    });
    expect(out["prompt_cache_key"]).toBe("cursor-stable-user-abc");
    expect(out["tools"]).toEqual([
      {
        type: "function",
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: {} },
      },
    ]);
    expect("stream_options" in out).toBe(false);
  });

  test("maps assistant tool_calls and tool results", () => {
    const out = chatCompletionsToResponses({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "run tool" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: { name: "foo", arguments: '{"x":1}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_abc", content: '{"ok":true}' },
      ],
    });
    expect(out["input"]).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "run tool" }],
      },
      {
        type: "function_call",
        id: "call_abc",
        call_id: "call_abc",
        name: "foo",
        arguments: '{"x":1}',
        status: "completed",
      },
      {
        type: "function_call_output",
        call_id: "call_abc",
        output: '{"ok":true}',
      },
    ]);
  });
});
