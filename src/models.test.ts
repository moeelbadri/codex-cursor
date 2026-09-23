import { describe, expect, test } from "bun:test";
import {
  FALLBACK_MODEL_IDS,
  mergeModelSlugLists,
  parseModelsCacheJson,
  readClientVersionFromCacheText,
} from "./models.ts";

describe("parseModelsCacheJson", () => {
  test("returns slugs sorted by priority", () => {
    const ids = parseModelsCacheJson(
      JSON.stringify({
        models: [
          { slug: "gpt-5.4", visibility: "list", priority: 1 },
          { slug: "gpt-5.5", visibility: "list", priority: 10 },
          { slug: "api-only", visibility: "hide" },
          { slug: "hidden-model", visibility: "none" },
          { slug: "nope", supported_in_api: false },
        ],
      }),
    );
    expect(ids).toEqual(["gpt-5.5", "gpt-5.4", "api-only"]);
  });

  test("readClientVersionFromCacheText", () => {
    expect(
      readClientVersionFromCacheText(JSON.stringify({ client_version: "0.144.4" })),
    ).toBe("0.144.4");
    expect(
      readClientVersionFromCacheText(JSON.stringify({ client_version: [0, 144, 4] })),
    ).toBe("0.144.4");
  });

  test("mergeModelSlugLists preserves order and dedupes", () => {
    expect(mergeModelSlugLists(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("invalid json yields empty list for caller fallback", () => {
    expect(parseModelsCacheJson("not-json")).toEqual([]);
    expect(FALLBACK_MODEL_IDS.length).toBeGreaterThan(0);
  });
});
