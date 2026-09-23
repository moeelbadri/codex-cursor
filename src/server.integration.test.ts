import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "./server.ts";

describe("POST /v1/chat/completions", () => {
  const server = startServer({
    host: "127.0.0.1",
    port: 0,
    defaultReasoningEffort: "medium",
    logLevel: "quiet",
    authPath: "/nonexistent/auth.json",
  });

  afterAll(() => {
    server.stop();
  });

  test("accepts Chat Completions messages bodies (not Responses-only 400)", async () => {
    const res = await fetch(`http://${server.hostname}:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (res.status === 400 && body.error?.message) {
      expect(body.error.message).not.toContain("only accepts OpenAI Responses-API");
    }
    // Without real auth we expect upstream/auth failure, not shape rejection.
    expect(res.status).not.toBe(400);
  });
});
