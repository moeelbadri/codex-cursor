import { describe, expect, test } from "bun:test";
import { FALLBACK_MODEL_IDS, parseModelsCacheJson } from "./models.ts";

describe("parseModelsCacheJson", () => {
  test("returns slugs sorted by priority", () => {
    const ids = parseModelsCacheJson(
      JSON.stringify({
        models: [
          { slug: "gpt-5.4", visibility: "list", priority: 1 },
          { slug: "gpt-5.5", visibility: "list", priority: 10 },
          { slug: "hidden-model", visibility: "hide" },
          { slug: "nope", supported_in_api: false },
        ],
      }),
    );
    expect(ids).toEqual(["gpt-5.5", "gpt-5.4"]);
  });

  test("invalid json yields empty list for caller fallback", () => {
    expect(parseModelsCacheJson("not-json")).toEqual([]);
    expect(FALLBACK_MODEL_IDS.length).toBeGreaterThan(0);
  });
});
